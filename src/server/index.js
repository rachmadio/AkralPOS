const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./env");
const sheets = require("./googleSheets");
const appsScript = require("./appsScript");
const { AKRAL_PRODUCTS, PRODUCT_HEADERS, ORDER_HEADERS, ANALYTICS_HEADERS } = require("../shared/menu");

loadEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const PRODUCTS_RANGE = process.env.GOOGLE_SHEETS_PRODUCTS_RANGE || "Products!A2:E";
const ORDERS_RANGE = process.env.GOOGLE_SHEETS_ORDERS_RANGE || "Orders!A2:L";
const ANALYTICS_RANGE = process.env.GOOGLE_SHEETS_ANALYTICS_RANGE || "Analytics!A2:D";
const ALLOW_LOCAL_MENU_FALLBACK = process.env.ALLOW_LOCAL_MENU_FALLBACK === "true";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeProduct(row) {
  const [id, name, category, price, imageURL] = row;
  const seeded = AKRAL_PRODUCTS.find((product) => product.id === id || product.name === name);
  return {
    id,
    name,
    category,
    price: price === "variable" || price === "" ? null : Number(price),
    imageURL: imageURL || "/assets/akral-cup.jpg",
    variablePrice: price === "variable",
    color: seeded ? seeded.color : "#9b6b43"
  };
}

function normalizeProductObject(product) {
  const seeded = AKRAL_PRODUCTS.find((item) => item.id === product.id || item.name === product.name);
  const variablePrice = product.variablePrice || product.price === "variable" || product.price === null || product.price === "";
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: variablePrice ? null : Number(product.price),
    imageURL: product.imageURL || "/assets/akral-cup.jpg",
    variablePrice,
    color: product.color || (seeded ? seeded.color : "#9b6b43")
  };
}

async function loadProducts() {
  if (appsScript.hasAppsScriptConfig()) {
    const products = await appsScript.getProducts();
    return products.filter((product) => product.id && product.name).map(normalizeProductObject);
  }
  const rows = await sheets.getRows(PRODUCTS_RANGE);
  return rows.filter((row) => row[0] && row[1]).map(normalizeProduct);
}

function formatOrderItems(items) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      price: item.price,
      notes: item.notes || "",
      bean: item.bean || ""
    }))
  );
}

function calculateOrder(payload, products) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const items = (payload.items || []).map((item) => {
    const product = productMap.get(item.id);
    if (!product) throw new Error(`Unknown product: ${item.id}`);
    const price = product.variablePrice ? Number(item.price) : Number(product.price);
    const quantity = Number(item.quantity || 1);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`${product.name} needs a valid price.`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`${product.name} needs a valid quantity.`);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      price,
      quantity,
      notes: String(item.notes || "").slice(0, 240),
      bean: String(item.bean || "").slice(0, 120)
    };
  });

  if (!items.length) throw new Error("Order has no items.");
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountType = payload.discountType === "fixed" ? "fixed" : "percentage";
  const discountValue = Math.max(0, Number(payload.discountValue || 0));
  const discount = discountType === "percentage" ? Math.round(subtotal * Math.min(discountValue, 100) / 100) : Math.min(discountValue, subtotal);
  const taxable = Math.max(0, subtotal - discount);
  const tax = payload.taxEnabled ? Math.round(taxable * 0.11) : 0;
  const total = taxable + tax;

  return { items, subtotal, discount, discountType, tax, total };
}

async function appendAnalytics(order) {
  const dateKey = new Date(order.date).toISOString().slice(0, 10);
  const seller = order.items.reduce((winner, item) => (item.quantity > winner.quantity ? item : winner), order.items[0]);
  await sheets.appendRows(ANALYTICS_RANGE, [[dateKey, order.total, 1, seller.name]]);
}

function formatSheetDateTime(isoDate) {
  const value = new Date(isoDate);
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = value.getFullYear();
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  return {
    date: `${day}-${month}-${year}`,
    time: `${hours}:${minutes}:${seconds}`
  };
}

function parseSheetDateTime(date, time) {
  const dateText = String(date || "");
  const timeText = String(time || "00:00:00").replace(/\./g, ":");
  if (/^\d{1,2}[-:/]\d{1,2}[-:/]\d{4}/.test(dateText)) {
    const [day, month, year] = dateText.split(/[-:/]/);
    const [hours = "00", minutes = "00", seconds = "00"] = timeText.split(":");
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)).toISOString();
  }
  return dateText;
}

function sheetDiscountType(discountType) {
  if (discountType === "percentage" || discountType === "%") return "%";
  if (discountType === "fixed" || discountType === "Rp") return "Rp";
  return "";
}

function normalizeOrderObject(order) {
  return {
    orderID: order.orderID,
    date: normalizeOrderDate(order.date || parseSheetDateTime(order.sheetDate, order.time), order.time),
    time: order.time || "",
    items: Array.isArray(order.items) ? order.items : order.items ? JSON.parse(order.items) : [],
    subtotal: numericValue(order.subtotal),
    discount: numericValue(order.discount),
    discountType: order.discountType || "",
    tax: numericValue(order.tax),
    total: numericValue(order.total),
    paymentMethod: order.paymentMethod,
    customerName: order.customerName || "",
    status: order.status || "Pending"
  };
}

function normalizeOrderDate(date, time) {
  return parseSheetDateTime(date, time) || date;
}

function normalizeOrderRow(row) {
  const hasSplitDateTime = looksLikeItems(row[3]) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(row[2] || ""));
  if (hasSplitDateTime) {
    const [orderID, sheetDate, time, items, subtotal, discount, discountType, tax, total, paymentMethod, customerOrStatus, statusValue] = row;
    const hasCustomerName = !isOrderStatus(customerOrStatus);
    return {
      orderID,
      date: parseSheetDateTime(sheetDate, time),
      time,
      items: items ? JSON.parse(items) : [],
      subtotal: numericValue(subtotal),
      discount: numericValue(discount),
      discountType,
      tax: numericValue(tax),
      total: numericValue(total),
      paymentMethod,
      customerName: hasCustomerName ? customerOrStatus || "" : "",
      status: hasCustomerName ? statusValue || "Pending" : customerOrStatus || "Pending"
    };
  }

  const [orderID, date, items, subtotal, discount, tax, total, paymentMethod, customerName, status] = row;
  return {
    orderID,
    date,
    time: "",
    items: items ? JSON.parse(items) : [],
    subtotal: numericValue(subtotal),
    discount: numericValue(discount),
    discountType: "",
    tax: numericValue(tax),
    total: numericValue(total),
    paymentMethod,
    customerName: customerName || "",
    status: status || "Pending"
  };
}

function looksLikeItems(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") || text.startsWith("{");
}

function isOrderStatus(value) {
  return value === "Done" || value === "Pending";
}

function numericValue(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^\d.-]/g, "");
  return Number(cleaned || 0);
}

async function loadOrders() {
  if (appsScript.hasAppsScriptConfig()) {
    const orders = await appsScript.getOrders();
    return orders.filter((order) => order.orderID).map(normalizeOrderObject);
  }

  const rows = await sheets.getRows(ORDERS_RANGE);
  return rows
    .filter((row) => row[0])
    .map(normalizeOrderRow)
    .reverse();
}

async function saveOrder(order) {
  if (appsScript.hasAppsScriptConfig()) {
    await appsScript.createOrder(order);
    return;
  }

  const sheetDateTime = formatSheetDateTime(order.date);
  await sheets.appendRows(ORDERS_RANGE, [[
    order.orderID,
    sheetDateTime.date,
    sheetDateTime.time,
    formatOrderItems(order.items),
    order.subtotal,
    order.discount,
    sheetDiscountType(order.discountType),
    order.tax,
    order.total,
    order.paymentMethod,
    order.customerName || "",
    order.status || "Pending"
  ]]);
  await appendAnalytics(order);
}

async function updateOrderStatus(orderID, status) {
  const normalizedStatus = status === "Done" ? "Done" : "Pending";

  if (appsScript.hasAppsScriptConfig()) {
    await appsScript.updateOrderStatus(orderID, normalizedStatus);
    return { orderID, status: normalizedStatus };
  }

  const rows = await sheets.getRows(ORDERS_RANGE);
  const rowIndex = rows.findIndex((row) => row[0] === orderID);
  if (rowIndex === -1) throw new Error("Order not found.");
  await sheets.updateRows(`Orders!L${rowIndex + 2}`, [[normalizedStatus]]);
  return { orderID, status: normalizedStatus };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        databaseMode: appsScript.hasAppsScriptConfig() ? "apps-script" : "google-sheets-api",
        appsScriptConfigured: appsScript.hasAppsScriptConfig(),
        sheetsConfigured: sheets.hasSheetsConfig()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      try {
        const products = await loadProducts();
        sendJson(res, 200, { products, source: appsScript.hasAppsScriptConfig() ? "apps-script" : "google-sheets" });
      } catch (error) {
        if (ALLOW_LOCAL_MENU_FALLBACK) {
          sendJson(res, 200, { products: AKRAL_PRODUCTS, source: "local-menu", warning: error.message });
        } else {
          sendJson(res, 503, { error: error.message, hint: "Configure .env and sync products to Google Sheets." });
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/setup/sync-products") {
      if (appsScript.hasAppsScriptConfig()) {
        await appsScript.syncProducts(AKRAL_PRODUCTS, {
          products: PRODUCT_HEADERS,
          orders: ORDER_HEADERS,
          analytics: ANALYTICS_HEADERS
        });
        sendJson(res, 200, { ok: true, mode: "apps-script", products: AKRAL_PRODUCTS.length });
        return;
      }

      await sheets.clearRange("Products!A1:E");
      await sheets.updateRows("Products!A1:E", [
        PRODUCT_HEADERS,
        ...AKRAL_PRODUCTS.map((product) => [product.id, product.name, product.category, product.variablePrice ? "variable" : product.price, product.imageURL])
      ]);
      await sheets.updateRows("Orders!A1:L", [ORDER_HEADERS]);
      sendJson(res, 200, { ok: true, products: AKRAL_PRODUCTS.length });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      const orders = await loadOrders();
      sendJson(res, 200, { orders });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const payload = await readBody(req);
      const products = await loadProducts();
      const calculated = calculateOrder(payload, products);
      const orderID = `AKR-${Date.now().toString(36).toUpperCase()}`;
      const date = new Date().toISOString();
      const paymentMethod = ["Cash", "QRIS", "Transfer"].includes(payload.paymentMethod) ? payload.paymentMethod : "Cash";
      const customerName = String(payload.customerName || "").trim().slice(0, 80);
      const order = { orderID, date, paymentMethod, customerName, status: "Pending", ...calculated };

      await saveOrder(order);
      sendJson(res, 201, { order });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders/status") {
      const payload = await readBody(req);
      if (!payload.orderID) throw new Error("OrderID is required.");
      const result = await updateOrderStatus(payload.orderID, payload.status);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallback);
      });
      return;
    }
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Akral POS running on http://${HOST}:${PORT}`);
});
