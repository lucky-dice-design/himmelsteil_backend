import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

const port = 32000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let child;
let directus;
let smtp;
const stored = [];
const messages = [];
const smtpConnections = new Set();
let rejectNextMail = false;

before(async () => {
  // Loopback-only SMTP fixture: no production credentials or external mail delivery.
  smtp = net.createServer(socket => {
    smtpConnections.add(socket);
    socket.on('close', () => smtpConnections.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let message = null;
    const envelope = { from: '', to: [] };
    socket.on('data', chunk => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (message !== null) {
          if (line === '.') {
            messages.push({ ...envelope, to: [...envelope.to], data: message.join('\r\n') });
            message = null;
            socket.write('250 Message accepted\r\n');
          } else message.push(line.replace(/^\.\./, '.'));
        } else if (/^EHLO /i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) socket.write('235 Authentication successful\r\n');
        else if (/^MAIL FROM:/i.test(line)) {
          envelope.from = line.slice('MAIL FROM:'.length);
          envelope.to = [];
          if (rejectNextMail) {
            rejectNextMail = false;
            socket.write('550 Test mail rejected\r\n');
          } else socket.write('250 Sender accepted\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          envelope.to.push(line.slice('RCPT TO:'.length));
          socket.write('250 Recipient accepted\r\n');
        } else if (line === 'DATA') {
          message = [];
          socket.write('354 End with a dot\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('502 Command not supported\r\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(0, '127.0.0.1', resolve);
  });
  directus = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    stored.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: request.method === "POST" ? { ...body, id: 123 } : body }));
  });
  await new Promise((resolve) => directus.listen(port + 1, "127.0.0.1", resolve));
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtp.address().port),
      SMTP_USER: "info@example.test",
      SMTP_PASSWORD: "not-used-in-tests",
      MAIL_FROM: "Example <info@example.test>",
      MAIL_TO: "info@example.test",
      ALLOWED_ORIGINS: "https://preview.example.test",
      DIRECTUS_URL: `http://127.0.0.1:${port + 1}`,
      DIRECTUS_TOKEN: "not-used-in-tests",
      SMTP_JSON_TRANSPORT: "",
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
  for (const socket of smtpConnections) socket.destroy();
  smtp?.close();
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
  assert.equal(stored[0].url, "/items/contact_requests?fields=id,notification_status");
  assert.equal(stored[0].body.request_id, id);
  assert.equal(stored[0].body.id, undefined);
  assert.equal(stored[0].body.status, "open");
  assert.deepEqual(stored[1], {
    method: "PATCH",
    url: "/items/contact_requests/123?fields=id,notification_status",
    body: { notification_status: "sent" },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, '<info@example.test>');
  assert.deepEqual(messages[0].to, ['<info@example.test>']);
  assert.match(messages[0].data, /^Reply-To: Anna Test <anna@example\.test>$/m);
  assert.match(messages[0].data, /^Subject: Neue Website-Anfrage: Neue CMS-Option$/m);
  assert.match(messages[0].data, /Eine echte Testnachricht\./);
});

test("retains the stored request and records failed notification when SMTP rejects mail", async () => {
  rejectNextMail = true;
  const start = stored.length;
  const response = await fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.test" },
    body: JSON.stringify({ requestId: crypto.randomUUID(), name: "Mail Failure Test",
      email: "test@example.test", occasion: "Test", message: "Retain this request.",
      consent: true, startedAt: Date.now() - 10_000 }),
  });
  assert.equal(response.status, 200);
  assert.equal(stored[start].method, "POST");
  assert.equal(stored[start].body.notification_status, "pending");
  assert.deepEqual(stored[start + 1], {
    method: "PATCH", url: "/items/contact_requests/123?fields=id,notification_status",
    body: { notification_status: "failed" },
  });
  assert.equal(messages.length, 1);
});
