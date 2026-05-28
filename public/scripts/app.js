const state = {
  products: [],
  cart: [],
  orders: [],
  activeCategory: "All",
  paymentMethod: "Cash",
  pendingManualProduct: null,
  isCheckingOut: false,
  dashboardPage: 1,
  dashboardPageSize: 20,
  dashboardSort: "date-desc",
  dashboardLoading: false,
  dashboardDatesInitialized: false,
  historyDatesInitialized: false,
  dashboardDayMap: new Map(),
  dashboardOrderRows: []
};

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

function formatIDR(value) {
  return rupiah.format(Number(value || 0)).replace(/\s/g, "");
}

function dateKey(date) {
  const value = parseAppDate(date);
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseAppDate(date) {
  if (date instanceof Date) return date;
  const text = String(date || "");
  const splitDate = text.match(/^(\d{1,2})[-:\/](\d{1,2})[-:\/](\d{4})(?:[,\sT]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/);
  if (splitDate) {
    return new Date(
      Number(splitDate[3]),
      Number(splitDate[2]) - 1,
      Number(splitDate[1]),
      Number(splitDate[4] || 0),
      Number(splitDate[5] || 0),
      Number(splitDate[6] || 0)
    );
  }
  return new Date(text);
}

function formatChartDate(key) {
  if (!key) return "-";
  const date = new Date(`${key}T00:00:00`);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function startOfCurrentMonthKey() {
  const now = new Date();
  return dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
}

function todayKey() {
  return dateKey(new Date());
}

function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => $("#toast").classList.add("hidden"), 3800);
}

function initializeDashboardDates() {
  if (state.dashboardDatesInitialized) return;
  $("#dashboardStartDate").value = startOfCurrentMonthKey();
  $("#dashboardEndDate").value = todayKey();
  state.dashboardDatesInitialized = true;
}

function initializeHistoryDates() {
  if (state.historyDatesInitialized) return;
  $("#historyStartDate").value = startOfCurrentMonthKey();
  $("#historyEndDate").value = todayKey();
  state.historyDatesInitialized = true;
}

function setDashboardLoading(isLoading) {
  state.dashboardLoading = isLoading;
  $("#dashboardLoading").classList.toggle("hidden", !isLoading);
  $("#dashboardMetrics").classList.toggle("hidden", isLoading);
}

function setCheckoutLoading(isLoading) {
  state.isCheckingOut = isLoading;
  const checkoutButton = $("#checkoutButton");
  checkoutButton.disabled = isLoading || !state.cart.length;
  checkoutButton.classList.toggle("is-loading", isLoading);
  $("#checkoutButtonText").textContent = isLoading ? "Saving order..." : "Confirm order";
  $(".cart-pane").classList.toggle("is-saving", isLoading);
  $("#clearCartButton").disabled = isLoading;
  $$(".payment").forEach((button) => {
    button.disabled = isLoading;
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.hint || "Request failed.");
  return data;
}

function productPrice(product) {
  return product.variablePrice ? "Custom" : formatIDR(product.price);
}

function productCartQuantity(productId) {
  return state.cart
    .filter((item) => item.id === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function renderProducts() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const products = state.products.filter((product) => {
    const matchesCategory = state.activeCategory === "All" || product.category === state.activeCategory;
    const matchesSearch = !query || product.name.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  $("#menuGrid").innerHTML = products
    .map(
      (product) => {
        const quantity = productCartQuantity(product.id);
        return `
        <button class="product-card ${quantity ? "in-cart" : ""}" data-product-id="${product.id}" style="--drink-color: ${product.color || "#9b6b43"}">
          <div class="product-image">
            <img src="${escapeHTML(product.imageURL || "/assets/akral-cup.jpg")}" alt="${escapeHTML(product.name)}">
            ${quantity ? `<span class="product-count">${quantity}</span>` : ""}
            <span class="drink-tint"></span>
            <span class="drink-glow"></span>
          </div>
          <span class="product-body">
            <strong>${escapeHTML(product.name)}</strong>
            <span class="product-meta">
              <span>${escapeHTML(product.category)}</span>
              <b>${productPrice(product)}</b>
            </span>
          </span>
        </button>
      `;
      }
    )
    .join("");
}

function findProduct(id) {
  return state.products.find((product) => product.id === id);
}

function addToCart(product, overrides = {}) {
  const price = product.variablePrice ? Number(overrides.price) : Number(product.price);
  const cartId = product.variablePrice ? `${product.id}-${Date.now()}` : product.id;
  const existing = product.variablePrice ? null : state.cart.find((item) => item.cartId === cartId);

  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      cartId,
      id: product.id,
      name: product.name,
      category: product.category,
      price,
      quantity: 1,
      notes: overrides.notes || "",
      bean: overrides.bean || ""
    });
  }
  renderCart();
}

function totals() {
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountType = $("#discountType").value;
  const discountValue = Math.max(0, Number($("#discountValue").value || 0));
  const discount = discountType === "percentage" ? Math.round(subtotal * Math.min(discountValue, 100) / 100) : Math.min(discountValue, subtotal);
  const taxable = Math.max(0, subtotal - discount);
  const tax = $("#taxToggle").checked ? Math.round(taxable * 0.11) : 0;
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}

function renderCart() {
  $("#cartTitle").textContent = state.cart.length ? `${state.cart.reduce((sum, item) => sum + item.quantity, 0)} items` : "New order";

  $("#cartItems").innerHTML = state.cart.length
    ? state.cart
        .map(
          (item) => `
            <article class="cart-item">
              <div class="cart-item-top">
                <div class="cart-item-title">
                  <strong>${escapeHTML(item.name)}</strong>
                  <span>${formatIDR(item.price)}${item.bean ? ` · ${escapeHTML(item.bean)}` : ""}</span>
                </div>
                <strong>${formatIDR(item.price * item.quantity)}</strong>
              </div>
              <div class="qty-row">
                <div class="qty-controls">
                  <button data-qty="-1" data-cart-id="${item.cartId}" aria-label="Decrease ${item.name}">-</button>
                  <span>${item.quantity}</span>
                  <button data-qty="1" data-cart-id="${item.cartId}" aria-label="Increase ${item.name}">+</button>
                </div>
                <input class="item-note" data-note-id="${item.cartId}" value="${escapeHTML(item.notes || "")}" placeholder="Notes">
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-cart">Tap a drink to start</div>`;

  const currentTotals = totals();
  $("#subtotalText").textContent = formatIDR(currentTotals.subtotal);
  $("#discountText").textContent = formatIDR(currentTotals.discount);
  $("#taxText").textContent = formatIDR(currentTotals.tax);
  $("#totalText").textContent = formatIDR(currentTotals.total);
  updateChange();
  setCheckoutLoading(state.isCheckingOut);
  renderProducts();
}

function updateChange() {
  const cash = Number($("#cashReceived").value || 0);
  const change = Math.max(0, cash - totals().total);
  $("#changeLine").textContent = `Change ${formatIDR(change)}`;
}

function openManualBrew(product) {
  state.pendingManualProduct = product;
  $("#manualPrice").value = "";
  $("#manualBean").value = "";
  $("#manualNotes").value = "";
  $("#manualBrewModal").showModal();
  setTimeout(() => $("#manualPrice").focus(), 80);
}

function setView(view) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $$(".view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  if (view === "history" || view === "dashboard") loadOrders();
}

function resetOrder() {
  state.cart = [];
  $("#discountValue").value = "";
  $("#taxToggle").checked = false;
  $("#cashReceived").value = "";
  state.paymentMethod = "Cash";
  $$(".payment").forEach((button) => button.classList.toggle("active", button.dataset.payment === "Cash"));
  $("#cashField").classList.remove("hidden");
  $("#changeLine").classList.remove("hidden");
  $("#showQrisButton").classList.add("hidden");
  renderCart();
}

async function checkout() {
  if (state.isCheckingOut) return;
  if (!state.cart.length) return;
  const currentTotals = totals();
  if (state.paymentMethod === "Cash" && Number($("#cashReceived").value || 0) < currentTotals.total) {
    $("#cashReceived").focus();
    return;
  }

  setCheckoutLoading(true);
  try {
    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: state.cart,
        discountType: $("#discountType").value,
        discountValue: Number($("#discountValue").value || 0),
        taxEnabled: $("#taxToggle").checked,
        paymentMethod: state.paymentMethod
      })
    });

    $("#confirmText").textContent = `${data.order.orderID} · ${formatIDR(data.order.total)} · ${data.order.paymentMethod}`;
    $("#confirmModal").showModal();
    resetOrder();
    loadOrders();
  } finally {
    setCheckoutLoading(false);
  }
}

function orderDate(order) {
  return parseAppDate(order.date);
}

function filteredOrders() {
  const search = $("#historySearch").value.trim().toLowerCase();
  const start = $("#historyStartDate").value || startOfCurrentMonthKey();
  const end = $("#historyEndDate").value || todayKey();
  const startValue = start <= end ? start : end;
  const endValue = start <= end ? end : start;
  return state.orders.filter((order) => {
    const orderItemsText = order.items.map((item) => item.name).join(" ").toLowerCase();
    const orderKey = dateKey(order.date);
    const matchesSearch = !search || order.orderID.toLowerCase().includes(search) || orderItemsText.includes(search);
    const matchesDate = orderKey >= startValue && orderKey <= endValue;
    return matchesSearch && matchesDate;
  });
}

function renderHistory() {
  initializeHistoryDates();
  const orders = filteredOrders();
  $("#ordersList").innerHTML = orders.length
    ? orders
        .map(
          (order) => {
            const isDone = order.status === "Done";
            const hasDiscount = Number(order.discount || 0) > 0;
            const hasTax = Number(order.tax || 0) > 0;
            return `
            <article class="order-row ${isDone ? "is-done" : ""}">
              <div>
                <div class="history-order-title">
                  <strong>${escapeHTML(order.orderID)}</strong>
                  <span class="status-pill ${isDone ? "done" : "pending"}">${isDone ? "Done" : "Pending"}</span>
                </div>
                <p>${orderDate(order).toLocaleString("id-ID")} · ${order.paymentMethod}</p>
                <p>${order.items.map((item) => `${item.quantity}x ${escapeHTML(item.name)}`).join(", ")}</p>
                <div class="history-badges">
                  ${hasDiscount ? `<span>Discount ${formatIDR(order.discount)}</span>` : ""}
                  ${hasTax ? `<span>Tax ${formatIDR(order.tax)}</span>` : ""}
                  ${!hasDiscount && !hasTax ? `<span>No discount/tax</span>` : ""}
                </div>
              </div>
              <div class="history-order-actions">
                <strong>${formatIDR(order.total)}</strong>
                <button class="ghost-button done-toggle" data-done-order-id="${escapeHTML(order.orderID)}">${isDone ? "Mark pending" : "Mark done"}</button>
              </div>
            </article>
          `;
          }
        )
        .join("")
    : `<div class="empty-cart">No orders found</div>`;

  renderSummaries();
}

function renderSummaries() {
  const currentTodayKey = todayKey();
  const monthKey = currentTodayKey.slice(0, 7);
  const todayOrders = state.orders.filter((order) => dateKey(order.date) === currentTodayKey);
  const monthlyOrders = state.orders.filter((order) => dateKey(order.date).slice(0, 7) === monthKey);
  const todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const monthlySales = monthlyOrders.reduce((sum, order) => sum + order.total, 0);

  $("#dailySales").textContent = formatIDR(todaySales);
  $("#monthlySales").textContent = formatIDR(monthlySales);
  $("#dailyOrders").textContent = todayOrders.length;
  renderDashboard();
}

function normalizeCategory(category) {
  const value = String(category || "").trim().toLowerCase().replace(/[-_]+/g, " ");
  if (value === "non coffee" || value === "noncoffee") return "Non Coffee";
  if (value === "food") return "Food";
  return "Coffee";
}

function selectedDashboardOrders() {
  const start = $("#dashboardStartDate").value || startOfCurrentMonthKey();
  const end = $("#dashboardEndDate").value || todayKey();
  const startValue = start <= end ? start : end;
  const endValue = start <= end ? end : start;
  return state.orders.filter((order) => {
    const key = dateKey(order.date);
    return key >= startValue && key <= endValue;
  });
}

function orderItems(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function splitAmountByLine(total, lineTotals) {
  const amount = Math.round(Number(total || 0));
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  if (!amount || !subtotal || !lineTotals.length) return lineTotals.map(() => 0);

  const raw = lineTotals.map((value) => (amount * value) / subtotal);
  const split = raw.map(Math.floor);
  let remainder = amount - split.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder <= 0) return;
      split[index] += 1;
      remainder -= 1;
    });
  return split;
}

function buildDashboardData(orders) {
  const days = new Map();
  const items = new Map();
  const categories = new Map([
    ["Coffee", { quantity: 0, revenue: 0 }],
    ["Non Coffee", { quantity: 0, revenue: 0 }],
    ["Food", { quantity: 0, revenue: 0 }]
  ]);
  const rows = [];

  orders.forEach((order) => {
    const key = dateKey(order.date);
    if (!days.has(key)) {
      days.set(key, {
        dateKey: key,
        totalRevenue: 0,
        orders: 0,
        items: 0,
        categories: { Coffee: 0, "Non Coffee": 0, Food: 0 }
      });
    }

    const day = days.get(key);
    day.totalRevenue += Number(order.total || 0);
    day.orders += 1;
    const preparedItems = orderItems(order).map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      lineTotal: Number(item.price || 0) * Number(item.quantity || 0)
    }));
    const lineTotals = preparedItems.map((item) => item.lineTotal);
    const splitDiscounts = splitAmountByLine(order.discount, lineTotals);
    const splitTaxes = splitAmountByLine(order.tax, lineTotals);

    preparedItems.forEach((item, index) => {
      const category = normalizeCategory(item.category);
      const quantity = item.quantity;
      const lineDiscount = splitDiscounts[index];
      const lineTax = splitTaxes[index];
      const netPrice = Math.max(0, item.lineTotal - lineDiscount + lineTax);
      day.items += quantity;
      day.categories[category] += netPrice;

      const categoryStats = categories.get(category) || { quantity: 0, revenue: 0 };
      categoryStats.quantity += quantity;
      categoryStats.revenue += netPrice;
      categories.set(category, categoryStats);

      const itemStats = items.get(item.name) || { name: item.name, quantity: 0 };
      itemStats.quantity += quantity;
      items.set(item.name, itemStats);

      rows.push({
        orderID: order.orderID,
        date: order.date,
        itemName: item.name,
        quantity,
        discount: lineDiscount,
        tax: lineTax,
        price: netPrice,
        category
      });
    });
  });

  return {
    days: Array.from(days.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    items: Array.from(items.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
    categories,
    rows
  };
}

function renderDashboard() {
  if (!$("#dashboardView")) return;
  initializeDashboardDates();
  const orders = selectedDashboardOrders();
  const data = buildDashboardData(orders);
  state.dashboardDayMap = new Map(data.days.map((day) => [day.dateKey, day]));
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const itemSales = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const bestSeller = data.items[0];
  const topCategory = Array.from(data.categories.entries()).sort((a, b) => b[1].quantity - a[1].quantity)[0];

  $("#salesMetric").textContent = formatIDR(totalSales);
  $("#orderMetric").textContent = orders.length;
  $("#cupSalesMetric").textContent = `${itemSales} items`;
  $("#bestSellerMetric").textContent = bestSeller ? `${bestSeller.name} - ${bestSeller.quantity}` : "-";
  $("#topCategoryMetric").textContent = topCategory && topCategory[1].quantity ? topCategory[0] : "-";
  $("#dashboardRangeLabel").textContent = `${formatChartDate($("#dashboardStartDate").value)} - ${formatChartDate($("#dashboardEndDate").value)}`;

  renderRevenueChart(data.days);
  renderCategoryChart(data.categories);
  renderMenuSoldCount(data.items, itemSales);
  renderOrderLog(data.rows);
}

function renderRevenueChart(days) {
  const categories = ["Coffee", "Non Coffee", "Food"];
  const maxRevenue = Math.max(
    1,
    ...days.map((day) => Math.max(day.totalRevenue, categories.reduce((sum, category) => sum + day.categories[category], 0)))
  );
  const ticks = [maxRevenue, maxRevenue * 0.75, maxRevenue * 0.5, maxRevenue * 0.25, 0].map((value) => Math.round(value / 1000) * 1000);
  const chartColumns = Math.max(days.length, 1);

  $("#revenueYAxis").innerHTML = ticks.map((tick) => `<span>${formatIDR(tick)}</span>`).join("");
  $("#revenueChart").style.gridTemplateColumns = `repeat(${chartColumns}, minmax(26px, 1fr))`;
  $("#revenueXAxis").style.gridTemplateColumns = `repeat(${chartColumns}, minmax(26px, 1fr))`;

  if (!days.length) {
    $("#revenueChart").innerHTML = `<div class="empty-cart" style="grid-column:1 / -1">No revenue in this range</div>`;
    $("#revenueXAxis").innerHTML = `<span>-</span>`;
    return;
  }

  $("#revenueChart").innerHTML = days
    .map((day) => {
      const stackTotal = categories.reduce((sum, category) => sum + day.categories[category], 0);
      const height = Math.max(6, (Math.max(day.totalRevenue, stackTotal) / maxRevenue) * 100);
      const segments = categories
        .map((category) => {
          const value = day.categories[category];
          const percent = stackTotal ? (value / stackTotal) * 100 : 0;
          return `<span class="stack-segment stack-${category.toLowerCase().replace(/\s/g, "")}" style="height:${percent}%"></span>`;
        })
        .join("");
      return `
        <button class="stacked-bar" data-day="${escapeHTML(day.dateKey)}" style="height:${height}%" aria-label="${escapeHTML(day.dateKey)} revenue">
          ${segments}
        </button>
      `;
    })
    .join("");
  $("#revenueXAxis").innerHTML = days.map((day) => `<span>${formatChartDate(day.dateKey)}</span>`).join("");
}

function showChartTooltip(event, day) {
  const tooltip = $("#chartTooltip");
  tooltip.innerHTML = `
    <strong>${formatChartDate(day.dateKey)}</strong>
    <div><span>Total revenue</span><b>${formatIDR(day.totalRevenue)}</b></div>
    <div><span>Coffee revenue</span><b>${formatIDR(day.categories.Coffee)}</b></div>
    <div><span>Non Coffee revenue</span><b>${formatIDR(day.categories["Non Coffee"])}</b></div>
    <div><span>Food revenue</span><b>${formatIDR(day.categories.Food)}</b></div>
    <div><span>Orders</span><b>${day.orders}</b></div>
    <div><span>Items sold</span><b>${day.items}</b></div>
  `;
  const left = Math.min(event.clientX, window.innerWidth - 260);
  const top = Math.min(event.clientY, window.innerHeight - 230);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
  tooltip.classList.remove("hidden");
}

function hideChartTooltip() {
  $("#chartTooltip").classList.add("hidden");
}

function renderCategoryChart(categoryStats) {
  const entries = ["Coffee", "Non Coffee", "Food"].map((category) => [category, categoryStats.get(category) || { quantity: 0, revenue: 0 }]);
  const max = Math.max(1, ...entries.map((entry) => entry[1].quantity));
  $("#categoryChart").innerHTML = entries
    .map(
      ([category, stats]) => `
        <div class="category-line">
          <span>${escapeHTML(category)} · ${stats.quantity} items · ${formatIDR(stats.revenue)}</span>
          <div><i style="width:${(stats.quantity / max) * 100}%"></i></div>
        </div>
      `
    )
    .join("");
}

function renderMenuSoldCount(items, totalItems) {
  $("#menuSoldTotal").textContent = `${totalItems} items`;
  if (!items.length) {
    $("#menuSoldList").innerHTML = `<div class="empty-cart">No menu sold in this range</div>`;
    return;
  }
  const max = Math.max(1, items[0].quantity);
  $("#menuSoldList").innerHTML = items
    .map(
      (item, index) => `
        <div class="menu-sold-row ${index === 0 ? "top-seller" : ""}">
          <strong>${escapeHTML(item.name)}</strong>
          <div class="menu-progress"><i style="width:${(item.quantity / max) * 100}%"></i></div>
          <span>${item.quantity}</span>
        </div>
      `
    )
    .join("");
}

function filteredOrderRows(rows) {
  const query = $("#dashboardOrderSearch").value.trim().toLowerCase();
  const filtered = query
    ? rows.filter((row) => `${row.orderID} ${row.itemName} ${row.category}`.toLowerCase().includes(query))
    : rows.slice();
  const sort = state.dashboardSort;
  filtered.sort((a, b) => {
    if (sort === "date-asc") return new Date(a.date) - new Date(b.date);
    if (sort === "date-desc") return new Date(b.date) - new Date(a.date);
    if (sort === "order-asc") return a.orderID.localeCompare(b.orderID);
    if (sort === "order-desc") return b.orderID.localeCompare(a.orderID);
    if (sort === "price-asc") return a.price - b.price;
    if (sort === "price-desc") return b.price - a.price;
    return 0;
  });
  return filtered;
}

function renderOrderLog(rows) {
  const filtered = filteredOrderRows(rows);
  state.dashboardOrderRows = filtered;
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.dashboardPageSize));
  state.dashboardPage = Math.min(state.dashboardPage, totalPages);
  const start = (state.dashboardPage - 1) * state.dashboardPageSize;
  const pageRows = filtered.slice(start, start + state.dashboardPageSize);

  $("#orderLogCount").textContent = `${filtered.length} records`;
  $("#orderLogPage").textContent = `Page ${state.dashboardPage} of ${totalPages}`;
  $("#orderLogPrev").disabled = state.dashboardPage <= 1;
  $("#orderLogNext").disabled = state.dashboardPage >= totalPages;
  $("#orderLogBody").innerHTML = pageRows.length
    ? pageRows
        .map(
          (row) => `
            <tr>
              <td data-label="Order ID">${escapeHTML(row.orderID)}</td>
              <td data-label="Date">${orderDate(row).toLocaleDateString("id-ID")}</td>
              <td data-label="Items">${escapeHTML(row.itemName)}</td>
              <td data-label="Quantity">${row.quantity}</td>
              <td data-label="Discount">${formatIDR(row.discount)}</td>
              <td data-label="Tax">${formatIDR(row.tax)}</td>
              <td data-label="Price">${formatIDR(row.price)}</td>
              <td data-label="Category">${escapeHTML(row.category)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="8">No order records in this range</td></tr>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadOrderLogCsv() {
  const rows = state.dashboardOrderRows || [];
  const headers = ["Order ID", "Date", "Items", "Quantity", "Discount", "Tax", "Price", "Category"];
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.orderID,
        orderDate(row).toLocaleDateString("id-ID"),
        row.itemName,
        row.quantity,
        row.discount,
        row.tax,
        row.price,
        row.category
      ]
        .map(csvCell)
        .join(",")
    )
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `akral-order-log-${$("#dashboardStartDate").value || "start"}-${$("#dashboardEndDate").value || "end"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadOrders() {
  setDashboardLoading(true);
  try {
    const data = await api("/api/orders");
    state.orders = data.orders || [];
    $("#setupWarning").classList.add("hidden");
  } catch (error) {
    state.orders = [];
    $("#setupWarning").textContent = `Could not load orders: ${error.message}`;
    $("#setupWarning").classList.remove("hidden");
  } finally {
    setDashboardLoading(false);
  }
  renderHistory();
}

async function loadProducts() {
  try {
    const data = await api("/api/products");
    state.products = data.products || [];
    if (data.source === "local-menu") {
      $("#setupWarning").textContent = `Preview mode: ${data.warning}`;
      $("#setupWarning").classList.remove("hidden");
    }
  } catch (error) {
    $("#setupWarning").textContent = `${error.message} Open README.md for setup, then run the product sync endpoint.`;
    $("#setupWarning").classList.remove("hidden");
    state.products = [];
  }
  renderProducts();
}

function bindEvents() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.activeCategory = chip.dataset.category;
      $$(".chip").forEach((button) => button.classList.toggle("active", button === chip));
      renderProducts();
    });
  });

  $("#searchInput").addEventListener("input", renderProducts);
  $("#menuGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".product-card");
    if (!card) return;
    const product = findProduct(card.dataset.productId);
    if (!product) return;
    if (product.variablePrice) openManualBrew(product);
    else addToCart(product);
  });

  $("#manualBrewForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addToCart(state.pendingManualProduct, {
      price: Number($("#manualPrice").value),
      bean: $("#manualBean").value.trim(),
      notes: $("#manualNotes").value.trim()
    });
    $("#manualBrewModal").close();
  });
  $("#cancelManualButton").addEventListener("click", () => $("#manualBrewModal").close());

  $("#cartItems").addEventListener("click", (event) => {
    const button = event.target.closest("[data-qty]");
    if (!button) return;
    const item = state.cart.find((cartItem) => cartItem.cartId === button.dataset.cartId);
    if (!item) return;
    item.quantity += Number(button.dataset.qty);
    if (item.quantity <= 0) state.cart = state.cart.filter((cartItem) => cartItem.cartId !== item.cartId);
    renderCart();
  });
  $("#cartItems").addEventListener("input", (event) => {
    if (!event.target.matches("[data-note-id]")) return;
    const item = state.cart.find((cartItem) => cartItem.cartId === event.target.dataset.noteId);
    if (item) item.notes = event.target.value;
  });

  ["taxToggle", "discountType", "discountValue", "cashReceived"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderCart);
    $(`#${id}`).addEventListener("change", renderCart);
  });
  $("#clearCartButton").addEventListener("click", resetOrder);
  $$(".payment").forEach((button) => {
    button.addEventListener("click", () => {
      state.paymentMethod = button.dataset.payment;
      $$(".payment").forEach((payment) => payment.classList.toggle("active", payment === button));
      const isCash = state.paymentMethod === "Cash";
      $("#cashField").classList.toggle("hidden", !isCash);
      $("#changeLine").classList.toggle("hidden", !isCash);
      $("#showQrisButton").classList.toggle("hidden", state.paymentMethod !== "QRIS");
    });
  });

  $("#checkoutButton").addEventListener("click", () => checkout().catch((error) => showToast(error.message)));
  $("#closeConfirmButton").addEventListener("click", () => $("#confirmModal").close());
  $("#showQrisButton").addEventListener("click", () => $("#qrisModal").showModal());
  $("#closeQrisButton").addEventListener("click", () => $("#qrisModal").close());
  $("#refreshHistoryButton").addEventListener("click", loadOrders);
  $("#refreshDashboardButton").addEventListener("click", loadOrders);
  $("#historySearch").addEventListener("input", renderHistory);
  ["historyStartDate", "historyEndDate"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderHistory);
  });
  $("#ordersList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-done-order-id]");
    if (!button) return;
    const orderID = button.dataset.doneOrderId;
    const order = state.orders.find((item) => item.orderID === orderID);
    const nextStatus = order && order.status === "Done" ? "Pending" : "Done";
    button.disabled = true;
    api("/api/orders/status", {
      method: "POST",
      body: JSON.stringify({ orderID, status: nextStatus })
    })
      .then((result) => {
        state.orders = state.orders.map((item) => (item.orderID === orderID ? { ...item, status: result.status } : item));
        renderHistory();
      })
      .catch((error) => showToast(error.message))
      .finally(() => {
        button.disabled = false;
      });
  });
  ["dashboardStartDate", "dashboardEndDate"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      state.dashboardPage = 1;
      renderDashboard();
    });
  });
  $("#dashboardOrderSearch").addEventListener("input", () => {
    state.dashboardPage = 1;
    renderDashboard();
  });
  $("#dashboardSort").addEventListener("change", (event) => {
    state.dashboardSort = event.target.value;
    state.dashboardPage = 1;
    renderDashboard();
  });
  $("#orderLogPageSize").addEventListener("change", (event) => {
    state.dashboardPageSize = Number(event.target.value);
    state.dashboardPage = 1;
    renderDashboard();
  });
  $("#downloadOrderLogCsv").addEventListener("click", downloadOrderLogCsv);
  $("#orderLogPrev").addEventListener("click", () => {
    state.dashboardPage = Math.max(1, state.dashboardPage - 1);
    renderDashboard();
  });
  $("#orderLogNext").addEventListener("click", () => {
    state.dashboardPage += 1;
    renderDashboard();
  });
  $("#revenueChart").addEventListener("mousemove", (event) => {
    const bar = event.target.closest(".stacked-bar");
    if (!bar) {
      hideChartTooltip();
      return;
    }
    const day = state.dashboardDayMap.get(bar.dataset.day);
    if (day) showChartTooltip(event, day);
  });
  $("#revenueChart").addEventListener("mouseleave", hideChartTooltip);
}

bindEvents();
initializeHistoryDates();
initializeDashboardDates();
loadProducts();
loadOrders();
renderCart();
