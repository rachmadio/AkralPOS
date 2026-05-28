const SHEETS = {
  products: 'Products',
  orders: 'Orders',
  analytics: 'Analytics',
};

const ORDER_HEADERS = ['OrderID', 'Date', 'Time', 'Items', 'Subtotal', 'Discount', 'DiscountType', 'Tax', 'Total', 'PaymentMethod', 'Status'];

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : 'ping';

  if (action === 'ping') return json({ ok: true, version: 'akral-pos-v4' });
  if (action === 'debug') return json(getDebugInfo());
  if (action === 'products') return json({ products: getProducts() });
  if (action === 'orders') return json({ orders: getOrders() });

  return json({ error: 'Unknown action' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');

  if (body.action === 'createOrder') return json(createOrder(body.order));
  if (body.action === 'syncProducts') return json(syncProducts(body.products, body.headers));
  if (body.action === 'updateOrderStatus') return json(updateOrderStatus(body.orderID, body.status));

  return json({ error: 'Unknown action' });
}

function getProducts() {
  const sheet = getOrCreateSheet(SHEETS.products);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 5).getValues()
    .filter(row => row[0] && row[1])
    .map(row => ({
      id: row[0],
      name: row[1],
      category: row[2],
      price: row[3] === 'variable' ? null : Number(row[3]),
      imageURL: row[4],
      variablePrice: row[3] === 'variable',
    }));
}

function getDebugInfo() {
  const spreadsheet = SpreadsheetApp.getActive();
  const productsSheet = getOrCreateSheet(SHEETS.products);
  const ordersSheet = getOrCreateSheet(SHEETS.orders);
  const analyticsSheet = getOrCreateSheet(SHEETS.analytics);
  const orderLastRow = ordersSheet.getLastRow();
  const orderLastColumn = ordersSheet.getLastColumn();
  const orderHeader = orderLastRow ? ordersSheet.getRange(1, 1, 1, Math.max(1, orderLastColumn)).getValues()[0] : [];
  const firstOrder = orderLastRow > 1 ? ordersSheet.getRange(2, 1, 1, Math.max(1, orderLastColumn)).getValues()[0] : [];
  const firstOrderDisplay = orderLastRow > 1 ? ordersSheet.getRange(2, 1, 1, Math.max(1, orderLastColumn)).getDisplayValues()[0] : [];

  return {
    ok: true,
    version: 'akral-pos-v4-debug',
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: {
      products: { rows: productsSheet.getLastRow(), columns: productsSheet.getLastColumn() },
      orders: { rows: orderLastRow, columns: orderLastColumn },
      analytics: { rows: analyticsSheet.getLastRow(), columns: analyticsSheet.getLastColumn() },
    },
    orderHeader,
    firstOrderID: firstOrder[0] || '',
    firstOrderDate: firstOrder[1] || '',
    firstOrderTime: firstOrder[2] || '',
    firstOrderDisplay,
  };
}

function getOrders() {
  const sheet = getOrCreateSheet(SHEETS.orders);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 11).getDisplayValues()
    .filter(row => row[0])
    .map(row => {
      try {
        return normalizeOrderRow(row);
      } catch (error) {
        return {
          orderID: row[0],
          date: row[1],
          time: row[2],
          items: [],
          subtotal: numberValue(row[4] || row[3]),
          discount: numberValue(row[5] || row[4]),
          discountType: row[6] || '',
          tax: numberValue(row[7] || row[5]),
          total: numberValue(row[8] || row[6]),
          paymentMethod: row[9] || row[7] || '',
          status: row[10] || 'Pending',
          parseWarning: error.message,
        };
      }
    })
    .reverse();
}

function normalizeOrderRow(row) {
  const hasSplitDateTime = looksLikeItems(row[3]) || isTimeValue(row[2]);
  if (hasSplitDateTime) {
    return {
      orderID: row[0],
      date: parseSheetDateTime(row[1], row[2]),
      sheetDate: row[1],
      time: row[2],
      items: parseItems(row[3]),
      subtotal: numberValue(row[4]),
      discount: numberValue(row[5]),
      discountType: row[6],
      tax: numberValue(row[7]),
      total: numberValue(row[8]),
      paymentMethod: row[9],
      status: row[10] || 'Pending',
    };
  }

  return {
    orderID: row[0],
    date: row[1],
    time: '',
    items: parseItems(row[2]),
    subtotal: numberValue(row[3]),
    discount: numberValue(row[4]),
    discountType: '',
    tax: numberValue(row[5]),
    total: numberValue(row[6]),
    paymentMethod: row[7],
    status: 'Pending',
  };
}

function createOrder(order) {
  const ordersSheet = getOrCreateSheet(SHEETS.orders);
  const analyticsSheet = getOrCreateSheet(SHEETS.analytics);
  const bestSeller = (order.items || []).slice().sort((a, b) => b.quantity - a.quantity)[0];
  const dateTime = formatSheetDateTime(order.date);

  ensureOrdersHeader();
  ordersSheet.appendRow([
    order.orderID,
    dateTime.date,
    dateTime.time,
    JSON.stringify(order.items || []),
    order.subtotal,
    order.discount,
    formatDiscountType(order.discountType),
    order.tax,
    order.total,
    order.paymentMethod,
    order.status || 'Pending',
  ]);

  analyticsSheet.appendRow([
    new Date(order.date).toISOString().slice(0, 10),
    order.total,
    1,
    bestSeller ? bestSeller.name : '',
  ]);

  return { ok: true, order };
}

function updateOrderStatus(orderID, status) {
  ensureOrdersHeader();
  const normalizedStatus = status === 'Done' ? 'Done' : 'Pending';
  const sheet = getOrCreateSheet(SHEETS.orders);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Order not found' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const index = ids.findIndex(row => row[0] === orderID);
  if (index === -1) return { ok: false, error: 'Order not found' };

  sheet.getRange(index + 2, 11).setValue(normalizedStatus);
  return { ok: true, orderID, status: normalizedStatus };
}

function syncProducts(products, headers) {
  const productsSheet = getOrCreateSheet(SHEETS.products);

  productsSheet.clear();

  productsSheet.getRange(1, 1, 1, 5).setValues([headers.products]);
  if (products && products.length) {
    productsSheet.getRange(2, 1, products.length, 5).setValues(products.map(product => [
      product.id,
      product.name,
      product.category,
      product.variablePrice ? 'variable' : product.price,
      product.imageURL,
    ]));
  }
  ensureOrdersHeader();
  ensureAnalyticsHeader(headers.analytics);

  return { ok: true, products: products ? products.length : 0 };
}

function migrateOrdersToV4() {
  const sheet = getOrCreateSheet(SHEETS.orders);
  const rows = sheet.getDataRange().getValues();
  if (!rows.length) {
    sheet.getRange(1, 1, 1, 11).setValues([ORDER_HEADERS]);
    return { ok: true, migrated: 0 };
  }

  const header = rows[0];
  if (header[2] === 'Time' && header[6] === 'DiscountType' && header[10] === 'Status') {
    return { ok: true, migrated: 0 };
  }

  const migrated = [ORDER_HEADERS];
  rows.slice(1).forEach(row => {
    if (!row[0]) return;
    const hasSplitDateTime = looksLikeItems(row[3]) || isTimeValue(row[2]);
    if (hasSplitDateTime) {
      migrated.push([
        row[0],
        normalizeSheetDate(row[1]),
        normalizeSheetTime(row[2]),
        row[3],
        row[4],
        row[5],
        normalizeDiscountType(row[6]),
        row[7],
        row[8],
        row[9],
        row[10] || 'Pending',
      ]);
      return;
    }

    const parsed = splitDateTime(row[1]);
    migrated.push([
      row[0],
      parsed.date,
      parsed.time,
      row[2],
      row[3],
      row[4],
      guessDiscountType(row[3], row[4]),
      row[5],
      row[6],
      row[7],
      'Pending',
    ]);
  });

  sheet.clear();
  sheet.getRange(1, 1, migrated.length, 11).setValues(migrated);
  return { ok: true, migrated: migrated.length - 1 };
}

function ensureOrdersHeader() {
  const sheet = getOrCreateSheet(SHEETS.orders);
  const current = sheet.getRange(1, 1, 1, Math.max(11, sheet.getLastColumn())).getValues()[0];
  if (current[2] === 'Time' && current[6] === 'DiscountType' && current[10] === 'Status') return;
  migrateOrdersToV4();
}

function ensureAnalyticsHeader(headers) {
  const sheet = getOrCreateSheet(SHEETS.analytics);
  if (sheet.getLastRow() > 0 && sheet.getRange(1, 1).getValue()) return;
  sheet.getRange(1, 1, 1, 4).setValues([headers || ['Date', 'Revenue', 'Orders', 'BestSeller']]);
}

function getOrCreateSheet(name) {
  const spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function formatSheetDateTime(isoDate) {
  const value = new Date(isoDate);
  return {
    date: Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd-MM-yyyy'),
    time: Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss'),
  };
}

function parseSheetDateTime(date, time) {
  const dateText = normalizeSheetDate(date);
  const timeText = normalizeSheetTime(time);
  if (/^\d{1,2}[-:\/]\d{1,2}[-:\/]\d{4}$/.test(String(dateText || ''))) {
    const parts = String(dateText).split(/[-:\/]/);
    const timeParts = String(timeText || '00:00:00').split(':');
    return new Date(
      Number(parts[2]),
      Number(parts[1]) - 1,
      Number(parts[0]),
      Number(timeParts[0] || 0),
      Number(timeParts[1] || 0),
      Number(timeParts[2] || 0)
    ).toISOString();
  }
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? dateText : parsed.toISOString();
}

function splitDateTime(value) {
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return formatSheetDateTime(date);
  }
  return {
    date: normalizeSheetDate(value || ''),
    time: '',
  };
}

function normalizeSheetDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd-MM-yyyy');
  }
  const text = String(value || '');
  if (/^\d{2}:\d{2}:\d{4}$/.test(text)) return text.replace(/:/g, '-');
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) return text.replace(/\//g, '-');
  return text;
}

function normalizeSheetTime(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss');
  }
  const text = String(value || '');
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const parts = text.split(':');
    return [
      String(parts[0]).padStart(2, '0'),
      String(parts[1] || '00').padStart(2, '0'),
      String(parts[2] || '00').padStart(2, '0'),
    ].join(':');
  }
  return text;
}

function formatDiscountType(value) {
  if (value === 'percentage' || value === '%') return '%';
  if (value === 'fixed' || value === 'Rp') return 'Rp';
  return '';
}

function normalizeDiscountType(value) {
  return formatDiscountType(value);
}

function parseItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function looksLikeItems(value) {
  const text = String(value || '').trim();
  return text.charAt(0) === '[' || text.charAt(0) === '{';
}

function isTimeValue(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return true;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value || ''));
}

function numberValue(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/[^\d.-]/g, '');
  return Number(cleaned || 0);
}

function guessDiscountType(subtotal, discount) {
  const discountValue = numberValue(discount);
  if (!discountValue) return '';
  return 'Rp';
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
