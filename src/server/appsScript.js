const https = require("https");
const { URL } = require("url");

const MAX_REDIRECTS = 5;

function hasAppsScriptConfig() {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_URL);
}

function requestJson(url, options = {}, payload, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = payload ? JSON.stringify(payload) : null;
    const requestOptions = {
      method: options.method || "GET",
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "text/plain;charset=utf-8", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    };

    const req = https.request(requestOptions, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error("Apps Script redirect limit reached."));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        const nextMethod = [301, 302, 303].includes(res.statusCode) ? "GET" : requestOptions.method;
        resolve(requestJson(nextUrl, { ...options, method: nextMethod }, nextMethod === "GET" ? null : payload, redirectCount + 1));
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsedData = {};
        try {
          parsedData = data ? JSON.parse(data) : {};
        } catch (error) {
          if (data.includes("accounts.google.com") || data.includes("ServiceLogin")) {
            reject(new Error("Apps Script is asking for Google sign-in. Redeploy the Web App with access set to Anyone with the link."));
            return;
          }
          reject(new Error(`Apps Script returned non-JSON response: ${data.slice(0, 160)}`));
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && !parsedData.error) {
          resolve(parsedData);
        } else {
          reject(new Error(parsedData.error || `Apps Script HTTP ${res.statusCode}`));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function appsScriptUrl(action) {
  const url = new URL(process.env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set("action", action);
  return url.toString();
}

async function getProducts() {
  const response = await requestJson(appsScriptUrl("products"));
  return response.products || response;
}

async function getOrders() {
  const response = await requestJson(appsScriptUrl("orders"));
  return response.orders || response;
}

async function createOrder(order) {
  return requestJson(
    process.env.GOOGLE_APPS_SCRIPT_URL,
    { method: "POST" },
    {
      action: "createOrder",
      order
    }
  );
}

async function updateOrderStatus(orderID, status) {
  return requestJson(
    process.env.GOOGLE_APPS_SCRIPT_URL,
    { method: "POST" },
    {
      action: "updateOrderStatus",
      orderID,
      status
    }
  );
}

async function syncProducts(products, headers) {
  return requestJson(
    process.env.GOOGLE_APPS_SCRIPT_URL,
    { method: "POST" },
    {
      action: "syncProducts",
      products,
      headers
    }
  );
}

module.exports = {
  hasAppsScriptConfig,
  getProducts,
  getOrders,
  createOrder,
  updateOrderStatus,
  syncProducts
};
