const state = {
  products: [],
  cart: [],
  orders: [],
  activeCategory: "All",
  paymentMethod: "Cash",
  pendingManualProduct: null,
  isCheckingOut: false
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

function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => $("#toast").classList.add("hidden"), 3800);
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

function renderProducts() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const products = state.products.filter((product) => {
    const matchesCategory = state.activeCategory === "All" || product.category === state.activeCategory;
    const matchesSearch = !query || product.name.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  $("#menuGrid").innerHTML = products
    .map(
      (product) => `
        <button class="product-card" data-product-id="${product.id}" style="--drink-color: ${product.color || "#9b6b43"}">
          <div class="product-image">
            <img src="${escapeHTML(product.imageURL || "/assets/akral-cup.jpg")}" alt="${escapeHTML(product.name)}">
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
      `
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
  return new Date(order.date);
}

function filteredOrders() {
  const search = $("#historySearch").value.trim().toLowerCase();
  const date = $("#historyDate").value;
  return state.orders.filter((order) => {
    const matchesSearch = !search || order.orderID.toLowerCase().includes(search);
    const matchesDate = !date || orderDate(order).toISOString().slice(0, 10) === date;
    return matchesSearch && matchesDate;
  });
}

function renderHistory() {
  const orders = filteredOrders();
  $("#ordersList").innerHTML = orders.length
    ? orders
        .map(
          (order) => `
            <article class="order-row">
              <div>
                <strong>${escapeHTML(order.orderID)}</strong>
                <p>${orderDate(order).toLocaleString("id-ID")} · ${order.paymentMethod}</p>
                <p>${order.items.map((item) => `${item.quantity}x ${escapeHTML(item.name)}`).join(", ")}</p>
              </div>
              <strong>${formatIDR(order.total)}</strong>
            </article>
          `
        )
        .join("")
    : `<div class="empty-cart">No orders found</div>`;

  renderSummaries();
}

function renderSummaries() {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const todayOrders = state.orders.filter((order) => orderDate(order).toISOString().slice(0, 10) === todayKey);
  const monthlyOrders = state.orders.filter((order) => orderDate(order).toISOString().slice(0, 7) === monthKey);
  const todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const monthlySales = monthlyOrders.reduce((sum, order) => sum + order.total, 0);

  $("#dailySales").textContent = formatIDR(todaySales);
  $("#monthlySales").textContent = formatIDR(monthlySales);
  $("#dailyOrders").textContent = todayOrders.length;
  $("#todaySalesMetric").textContent = formatIDR(todaySales);
  $("#todayOrdersMetric").textContent = todayOrders.length;

  const itemCounts = new Map();
  const categoryCounts = new Map();
  todayOrders.forEach((order) => {
    order.items.forEach((item) => {
      itemCounts.set(item.name, (itemCounts.get(item.name) || 0) + item.quantity);
      categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + item.quantity);
    });
  });

  const bestSeller = Array.from(itemCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const topCategory = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  $("#bestSellerMetric").textContent = bestSeller ? bestSeller[0] : "-";
  $("#topCategoryMetric").textContent = topCategory ? topCategory[0] : "-";

  renderRevenueChart(monthlyOrders);
  renderCategoryChart(categoryCounts);
}

function renderRevenueChart(orders) {
  const byDay = new Map();
  orders.forEach((order) => {
    const key = orderDate(order).toISOString().slice(8, 10);
    byDay.set(key, (byDay.get(key) || 0) + order.total);
  });
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const key = date.toISOString().slice(8, 10);
    return { key, revenue: byDay.get(key) || 0 };
  });
  const max = Math.max(1, ...days.map((day) => day.revenue));
  $("#revenueChart").innerHTML = days
    .map((day) => `<span class="bar" title="${day.key}: ${formatIDR(day.revenue)}" style="height: ${Math.max(4, (day.revenue / max) * 100)}%"></span>`)
    .join("");
}

function renderCategoryChart(categoryCounts) {
  const entries = ["Coffee", "Non Coffee"].map((category) => [category, categoryCounts.get(category) || 0]);
  const max = Math.max(1, ...entries.map((entry) => entry[1]));
  $("#categoryChart").innerHTML = entries
    .map(
      ([category, count]) => `
        <div class="category-line">
          <span>${escapeHTML(category)} · ${count}</span>
          <div><i style="width:${(count / max) * 100}%"></i></div>
        </div>
      `
    )
    .join("");
}

async function loadOrders() {
  try {
    const data = await api("/api/orders");
    state.orders = data.orders || [];
  } catch (error) {
    state.orders = [];
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
    });
  });

  $("#checkoutButton").addEventListener("click", () => checkout().catch((error) => showToast(error.message)));
  $("#closeConfirmButton").addEventListener("click", () => $("#confirmModal").close());
  $("#refreshHistoryButton").addEventListener("click", loadOrders);
  $("#historySearch").addEventListener("input", renderHistory);
  $("#historyDate").addEventListener("input", renderHistory);
}

bindEvents();
loadProducts();
loadOrders();
renderCart();
