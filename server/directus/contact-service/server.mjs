import http from "node:http";
import fs from "node:fs";
import nodemailer from "nodemailer";

const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "MAIL_FROM", "MAIL_TO", "ALLOWED_ORIGINS", "DIRECTUS_URL"];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}
const smtpPassword = process.env.SMTP_PASSWORD?.trim() ||
  (process.env.SMTP_PASSWORD_FILE ? fs.readFileSync(process.env.SMTP_PASSWORD_FILE, "utf8").trim() : "");
if (!smtpPassword) throw new Error("SMTP password is required");
const directusToken = process.env.DIRECTUS_TOKEN?.trim() ||
  (process.env.DIRECTUS_TOKEN_FILE ? fs.readFileSync(process.env.DIRECTUS_TOKEN_FILE, "utf8").trim() : "");
if (!directusToken) throw new Error("Directus token is required");
const directusUrl = process.env.DIRECTUS_URL.replace(/\/$/, "");

const port = Number(process.env.PORT || 3000);
const smtpPort = Number(process.env.SMTP_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error("Invalid SMTP_PORT");

const allowedOrigins = new Set(process.env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean));
const requests = new Map();
const rateWindowMs = 30 * 60 * 1000;
const rateLimit = 5;

const transporter = nodemailer.createTransport(process.env.SMTP_JSON_TRANSPORT === "1" ? { jsonTransport: true } : {
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: { user: process.env.SMTP_USER, pass: smtpPassword },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
  tls: { minVersion: "TLSv1.2" },
});

const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const cleanLine = (value, max) => clean(value, max).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
const escapeHtml = (value) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return (typeof forwarded === "string" ? forwarded.split(",")[0] : request.socket.remoteAddress || "unknown").trim();
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requests.get(ip) || []).filter((timestamp) => now - timestamp < rateWindowMs);
  if (recent.length >= rateLimit) {
    requests.set(ip, recent);
    return true;
  }
  recent.push(now);
  requests.set(ip, recent);
  if (requests.size > 10_000) {
    for (const [key, timestamps] of requests) {
      if (!timestamps.some((timestamp) => now - timestamp < rateWindowMs)) requests.delete(key);
    }
  }
  return false;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

async function directusRequest(path, method, body) {
  const response = await fetch(`${directusUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${directusToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function storeRequest(item) {
  const { response, payload } = await directusRequest("/items/contact_requests", "POST", item);
  if (response.ok) return true;
  const code = payload.errors?.[0]?.extensions?.code;
  if (response.status === 400 && code === "RECORD_NOT_UNIQUE") return false;
  throw new Error(`Directus create failed: ${response.status} ${code || response.statusText}`);
}

async function setNotificationStatus(id, status) {
  const { response } = await directusRequest(`/items/contact_requests/${id}`, "PATCH", { notification_status: status });
  if (!response.ok) throw new Error(`Directus notification update failed: ${response.status}`);
}

async function handleContact(request, response) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return json(response, 403, { ok: false, message: "Anfrage nicht erlaubt." });
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return json(response, 415, { ok: false, message: "Ungültiges Datenformat." });
  }
  const ip = clientIp(request);
  if (isRateLimited(ip)) return json(response, 429, { ok: false, message: "Zu viele Anfragen. Bitte versuche es später erneut." });

  const body = await readJson(request);
  const name = cleanLine(body.name, 100);
  const email = cleanLine(body.email, 254).toLowerCase();
  const occasion = cleanLine(body.occasion, 80);
  const timeframe = cleanLine(body.timeframe, 100);
  const message = clean(body.message, 5000);
  const website = clean(body.website, 200);
  const startedAt = Number(body.startedAt);
  const consent = body.consent === true;
  const requestId = cleanLine(body.requestId, 36).toLowerCase();

  if (website || !Number.isFinite(startedAt) || Date.now() - startedAt < 3000) {
    return json(response, 200, { ok: true, message: "Danke! Deine Anfrage wurde gesendet." });
  }
  if (!name || !email || !occasion || !message || !consent ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json(response, 400, { ok: false, message: "Bitte prüfe die markierten Pflichtfelder." });
  }

  const now = new Date().toISOString();
  const created = await storeRequest({
    id: requestId,
    status: "open",
    notification_status: "pending",
    created_at: now,
    consent_at: now,
    name,
    email,
    occasion,
    timeframe: timeframe || null,
    message,
  });
  if (!created) return json(response, 200, { ok: true });

  const subject = `Neue Website-Anfrage: ${occasion}`;
  const plain = [
    `Name: ${name}`, `E-Mail: ${email}`, `Anlass: ${occasion}`,
    `Zeitraum: ${timeframe || "Nicht angegeben"}`, "", "Nachricht:", message,
  ].join("\n");
  const html = `<h1>Neue Website-Anfrage</h1><dl><dt>Name</dt><dd>${escapeHtml(name)}</dd><dt>E-Mail</dt><dd>${escapeHtml(email)}</dd><dt>Anlass</dt><dd>${escapeHtml(occasion)}</dd><dt>Zeitraum</dt><dd>${escapeHtml(timeframe || "Nicht angegeben")}</dd></dl><h2>Nachricht</h2><p>${escapeHtml(message).replaceAll(/\r?\n/g, "<br>")}</p>`;

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      replyTo: { name, address: email },
      subject,
      text: plain,
      html,
    });
    await setNotificationStatus(requestId, "sent");
  } catch (error) {
    console.error("Contact notification failed:", error?.message || error);
    await setNotificationStatus(requestId, "failed").catch((updateError) => {
      console.error("Notification status update failed:", updateError?.message || updateError);
    });
  }
  json(response, 200, { ok: true });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true });
    if (request.method === "POST" && request.url === "/contact") return await handleContact(request, response);
    json(response, 404, { ok: false, message: "Nicht gefunden." });
  } catch (error) {
    console.error("Contact request failed:", error?.message || error);
    json(response, error?.status || 500, {
      ok: false,
      message: error?.status ? error.message : "Die Anfrage konnte nicht gesendet werden. Bitte versuche es später erneut.",
    });
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, "0.0.0.0", () => console.log(`Contact service listening on ${port}`));
