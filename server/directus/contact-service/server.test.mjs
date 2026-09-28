import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";

const port = 32000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let child;
let directus;
const stored = [];

before(async () => {
  directus = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    stored.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: body }));
  });
  await new Promise((resolve) => directus.listen(port + 1, "127.0.0.1", resolve));
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      SMTP_HOST: "smtp.invalid",
      SMTP_PORT: "465",
      SMTP_USER: "info@example.test",
      SMTP_PASSWORD: "not-used-in-tests",
      MAIL_FROM: "Example <info@example.test>",
      MAIL_TO: "info@example.test",
      ALLOWED_ORIGINS: "https://preview.example.test",
      DIRECTUS_URL: `http://127.0.0.1:${port + 1}`,
      DIRECTUS_TOKEN: "not-used-in-tests",
      SMTP_JSON_TRANSPORT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error("Contact service exited during startup");
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Contact service did not start");
});

after(() => {
  child?.kill();
  directus?.close();
});

test("health endpoint responds", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("rejects an untrusted origin", async () => {
  const response = await fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: "{}",
  });
  assert.equal(response.status, 403);
});

test("validates required fields without contacting SMTP", async () => {
  const response = await fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.test" },
    body: JSON.stringify({ startedAt: Date.now() - 10_000 }),
  });
  assert.equal(response.status, 400);
});

test("silently accepts the honeypot", async () => {
  const response = await fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.test" },
    body: JSON.stringify({ website: "https://spam.example", startedAt: Date.now() - 10_000 }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("stores a valid request and marks its notification sent", async () => {
  const id = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.test" },
    body: JSON.stringify({
      requestId: id,
      name: "Anna Test",
      email: "anna@example.test",
      occasion: "Neue CMS-Option",
      timeframe: "Sommer",
      message: "Eine echte Testnachricht.",
      consent: true,
      startedAt: Date.now() - 10_000,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(stored[0].method, "POST");
  assert.equal(stored[0].url, "/items/contact_requests");
  assert.equal(stored[0].body.id, id);
  assert.equal(stored[0].body.status, "open");
  assert.deepEqual(stored[1], {
    method: "PATCH",
    url: `/items/contact_requests/${id}`,
    body: { notification_status: "sent" },
  });
});
