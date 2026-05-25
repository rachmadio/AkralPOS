const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
let cachedToken = null;

function hasSheetsConfig() {
  return Boolean(process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function requestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        method: options.method || "GET",
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        headers: options.headers || {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const parsedData = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            const message = parsedData.error && parsedData.error.message ? parsedData.error.message : data;
            reject(new Error(`Google API ${res.statusCode}: ${message}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.accessToken;

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const unsignedToken = `${header}.${claim}`;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const signature = crypto.createSign("RSA-SHA256").update(unsignedToken).sign(privateKey, "base64");
  const jwt = `${unsignedToken}.${signature.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt
  }).toString();

  const token = await requestJson(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    },
    body
  );

  cachedToken = {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in
  };
  return cachedToken.accessToken;
}

async function sheetsRequest(path, method, payload) {
  if (!hasSheetsConfig()) {
    throw new Error("Google Sheets credentials are not configured.");
  }
  const token = await getAccessToken();
  const body = payload ? JSON.stringify(payload) : null;
  return requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {})
      }
    },
    body
  );
}

function encodeRange(range) {
  return encodeURIComponent(range).replace(/'/g, "%27");
}

async function getRows(range) {
  const response = await sheetsRequest(`/values/${encodeRange(range)}`, "GET");
  return response.values || [];
}

async function appendRows(range, rows) {
  return sheetsRequest(`/values/${encodeRange(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, "POST", {
    values: rows
  });
}

async function updateRows(range, rows) {
  return sheetsRequest(`/values/${encodeRange(range)}?valueInputOption=USER_ENTERED`, "PUT", {
    values: rows
  });
}

async function clearRange(range) {
  return sheetsRequest(`/values/${encodeRange(range)}:clear`, "POST", {});
}

module.exports = {
  hasSheetsConfig,
  getRows,
  appendRows,
  updateRows,
  clearRange
};
