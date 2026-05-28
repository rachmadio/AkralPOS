# Akral POS

Responsive point of sales web app for Akral, backed by Google Sheets through either Google Apps Script or the Google Sheets API.

## What is included

- Fast cashier order screen with image menu cards
- Coffee and Non Coffee category filters
- Search, quantity controls, item notes, tax toggle, percentage/fixed discounts
- Manual Brew custom price, optional bean, and optional notes
- Cash, QRIS, and Transfer checkout
- Cash change calculation
- Order confirmation modal
- Google Sheets reads and writes through a server-side API
- Order history with date and order number search
- Daily and monthly sales summaries
- Dashboard with today's sales, order count, best seller, revenue chart, and category sales

Receipt printing and receipt UI are intentionally not included.

## Folder structure

```text
.
├── public
│   ├── assets
│   │   └── akral-cup.jpg
│   ├── scripts
│   │   └── app.js
│   ├── styles
│   │   └── app.css
│   └── index.html
├── src
│   ├── server
│   │   ├── env.js
│   │   ├── googleSheets.js
│   │   └── index.js
│   └── shared
│       └── menu.js
├── .env.example
├── package.json
└── README.md
```

## Google Apps Script setup

This project is already configured to use this Apps Script Web App URL in `.env`:

```text
https://script.google.com/macros/s/AKfycbzwFJdIWPohZln2nqtfwBdayoWfv80Ec2o2FCoNr1tr_BD63cSUeIWaxOGZTEgKHtnGfg/exec
```

When `GOOGLE_APPS_SCRIPT_URL` is set, the app uses Apps Script instead of service account credentials.

1. Open your Google Sheet.
2. Create three tabs:
   - `Products`
   - `Orders`
   - `Analytics`
3. Go to `Extensions > Apps Script`.
4. Paste the latest script from `google-apps-script/Code.gs`. That file is the source of truth for the Apps Script Web App, including `Status`, split `Date`/`Time`, and `DiscountType`.

Important: do not copy older Apps Script snippets from chat history or old README versions. Older sync code cleared the `Orders` and `Analytics` tabs. The current `syncProducts` only refreshes the product menu and preserves transaction data.

Legacy reference only, do not use:

```js
const SHEETS = {
  products: 'Products',
  orders: 'Orders',
  analytics: 'Analytics',
};

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : 'ping';

  if (action === 'ping') return json({ ok: true, version: 'akral-pos-v3' });

  if (action === 'products') return json({ products: getProducts() });
  if (action === 'orders') return json({ orders: getOrders() });

  return json({ error: 'Unknown action' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');

  if (body.action === 'createOrder') return json(createOrder(body.order));
  if (body.action === 'syncProducts') return json(syncProducts(body.products, body.headers));

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

function getOrders() {
  const sheet = getOrCreateSheet(SHEETS.orders);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 10).getValues()
    .filter(row => row[0])
    .map(row => normalizeOrderRow(row))
    .reverse();
}

function normalizeOrderRow(row) {
  const hasSplitDateTime = /^\d{2}:\d{2}:\d{2}$/.test(String(row[2] || ''));
  if (hasSplitDateTime) {
    return {
      orderID: row[0],
      date: parseSheetDateTime(row[1], row[2]),
      sheetDate: row[1],
      time: row[2],
      items: row[3] ? JSON.parse(row[3]) : [],
      subtotal: Number(row[4] || 0),
      discount: Number(row[5] || 0),
      discountType: row[6],
      tax: Number(row[7] || 0),
      total: Number(row[8] || 0),
      paymentMethod: row[9],
    };
  }

  return {
    orderID: row[0],
    date: row[1],
    time: '',
    items: row[2] ? JSON.parse(row[2]) : [],
    subtotal: Number(row[3] || 0),
    discount: Number(row[4] || 0),
    discountType: '',
    tax: Number(row[5] || 0),
    total: Number(row[6] || 0),
    paymentMethod: row[7],
  };
}

function createOrder(order) {
  const ordersSheet = getOrCreateSheet(SHEETS.orders);
  const analyticsSheet = getOrCreateSheet(SHEETS.analytics);
  const bestSeller = (order.items || []).slice().sort((a, b) => b.quantity - a.quantity)[0];
  const dateTime = formatSheetDateTime(order.date);

  ordersSheet.appendRow([
    order.orderID,
    dateTime.date,
    dateTime.time,
    JSON.stringify(order.items || []),
    order.subtotal,
    order.discount,
    order.discountType || '',
    order.tax,
    order.total,
    order.paymentMethod,
  ]);

  analyticsSheet.appendRow([
    new Date(order.date).toISOString().slice(0, 10),
    order.total,
    1,
    bestSeller ? bestSeller.name : '',
  ]);

  return { ok: true, order };
}

function syncProducts(products, headers) {
  const productsSheet = getOrCreateSheet(SHEETS.products);
  const ordersSheet = getOrCreateSheet(SHEETS.orders);
  const analyticsSheet = getOrCreateSheet(SHEETS.analytics);

  productsSheet.clear();
  ordersSheet.clear();
  analyticsSheet.clear();

  productsSheet.getRange(1, 1, 1, 5).setValues([headers.products]);
  productsSheet.getRange(2, 1, products.length, 5).setValues(products.map(product => [
    product.id,
    product.name,
    product.category,
    product.variablePrice ? 'variable' : product.price,
    product.imageURL,
  ]));
  ordersSheet.getRange(1, 1, 1, 10).setValues([headers.orders]);
  analyticsSheet.getRange(1, 1, 1, 4).setValues([headers.analytics]);

  return { ok: true, products: products.length };
}

function getOrCreateSheet(name) {
  const spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function formatSheetDateTime(isoDate) {
  const value = new Date(isoDate);
  return {
    date: Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd:MM:yyyy'),
    time: Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss'),
  };
}

function parseSheetDateTime(date, time) {
  if (/^\d{2}:\d{2}:\d{4}$/.test(String(date || ''))) {
    const parts = String(date).split(':');
    const timeParts = String(time || '00:00:00').split(':');
    return new Date(
      Number(parts[2]),
      Number(parts[1]) - 1,
      Number(parts[0]),
      Number(timeParts[0] || 0),
      Number(timeParts[1] || 0),
      Number(timeParts[2] || 0)
    ).toISOString();
  }
  return date;
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

5. Click `Deploy > New deployment`.
6. Select type `Web app`.
7. Set `Execute as` to `Me`.
8. Set access to `Anyone with the link`.
9. Deploy and copy the Web App URL.
10. Put the URL in `.env`:

```bash
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

11. Restart the POS app.
12. Open this once to initialize the menu:

```bash
curl -X POST http://127.0.0.1:4173/api/setup/sync-products
```

## Google Sheets API setup

This is the alternate service-account setup. You only need this if you are not using Apps Script.

1. Create a Google Sheet with three tabs:
   - `Products`
   - `Orders`
   - `Analytics`

2. Create a Google Cloud project, enable the Google Sheets API, and create a service account.

3. Create a service account key in JSON format.

4. Share the Google Sheet with the service account email as an editor.

5. Copy `.env.example` to `.env` and fill these values:

```bash
GOOGLE_SHEETS_ID=your_google_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
```

The Sheet ID is the long value in the spreadsheet URL:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

## Sheet structure

`Products`

| ID | Name | Category | Price | ImageURL |
| --- | --- | --- | --- | --- |

`Orders`

| OrderID | Date | Time | Items | Subtotal | Discount | DiscountType | Tax | Total | PaymentMethod | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

`Analytics`

| Date | Revenue | Orders | BestSeller |
| --- | --- | --- | --- |

## Initialize the Akral menu

After `.env` is configured, start the app:

```bash
npm start
```

Then run this once to write the Products menu to Google Sheets:

```bash
curl -X POST http://localhost:4173/api/setup/sync-products
```

This does not clear existing orders when using the latest Apps Script from `google-apps-script/Code.gs`.

The starter product catalog is based on the menu you provided:

- Americano: 18000
- Kopi Susu Aren: 28000
- Berry In Bloom: 30000
- Kopi Susu Laviberry: 30000
- Latte: 28000
- Vanilla Latte: 35000
- Caramel Latte: 35000
- Berry Jam Latte: 35000
- Manual Brew: variable
- Matcha: 28000
- Cereal Matcha: 35000
- Matcha Berry: 28000
- Hojicha: 28000
- Red Velvet: 28000
- Coklat: 28000

## Local development

```bash
npm start
```

Open:

```text
http://localhost:4173
```

For UI preview before connecting Google Sheets, set this in `.env`:

```bash
ALLOW_LOCAL_MENU_FALLBACK=true
```

Keep it `false` in production.

## Deployment guide

This app is a small Node server plus static frontend, so it can be deployed to any Node host.

Recommended simple options:

- Render Web Service
- Railway
- Fly.io
- Google Cloud Run
- VPS with Node and a process manager

Deployment steps:

1. Upload the project to your Git provider.
2. Create a new Node web service.
3. Set the start command:

```bash
npm start
```

4. Add production environment variables:

```bash
PORT=4173
HOST=0.0.0.0
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
ALLOW_LOCAL_MENU_FALLBACK=false
```

Some hosts inject their own `PORT`; that is fine. The server uses it automatically.

5. Visit `/api/health` on the deployed URL and confirm `databaseMode` is `apps-script`.
6. Run `/api/setup/sync-products` once from a trusted machine if the sheet is empty.

## Production notes

- Apps Script runs as the Google account that deployed the Web App.
- Service account credentials are only used server-side when `GOOGLE_APPS_SCRIPT_URL` is not set.
- The browser never receives the private key.
- Orders are recalculated on the server before saving, so totals are not trusted blindly from the client.
- Product images use the Akral cup photo with consistent drink color treatments per menu item to keep the menu visually unified.
- The app is dependency-light by design, which keeps deployment simple and fast.
