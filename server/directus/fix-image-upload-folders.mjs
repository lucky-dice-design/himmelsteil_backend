import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Usage: node fix-image-upload-folders.mjs [--apply]");
if (!process.stdin.isTTY) throw new Error("Interaktives Terminal fuer den Admin-Login erforderlich.");

async function prompt(label, hidden = false) {
  const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  if (hidden) process.stdout.write(label);
  try { return await input.question(hidden ? "" : label); }
  finally { input.close(); if (hidden) process.stdout.write("\n"); }
}

let token;
async function request(endpoint, method = "GET", body) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${payload.errors?.[0]?.message || response.statusText}`);
    return payload.data;
  }
}

const email = await prompt("Directus-Admin-E-Mail: ");
const password = await prompt("Directus-Admin-Passwort: ", true);
token = (await request("/auth/login", "POST", { email, password, mode: "json" })).access_token;
if (!token) throw new Error("Kein Access-Token erhalten.");

const folders = await request(`/folders?${new URLSearchParams({ "filter[name][_eq]": "Website", fields: "id,name", limit: "2" })}`);
if (folders.length !== 1) throw new Error("Ordner Website fehlt oder ist nicht eindeutig.");
const folderId = folders[0].id;
const targets = [["home_page", "hero_image", true], ["home_tiles", "image", false], ["gallery_items", "image", false], ["contact_form", "intro_image", true]];
const fieldChanges = [];
const files = new Map();

// Inspect all targets before changing anything. Include drafts to preserve their image access, too.
for (const [collection, field, singleton] of targets) {
  const definition = await request(`/fields/${collection}/${field}`);
  if (definition.meta?.interface !== "file-image") throw new Error(`Unerwartetes Interface: ${collection}.${field}`);
  if (definition.meta.options?.folder !== folderId) {
    fieldChanges.push({ collection, field, options: { ...definition.meta.options, folder: folderId } });
  }
  const result = await request(`/items/${collection}?${new URLSearchParams({ fields: `id,${field}`, limit: "-1" })}`);
  const entries = singleton ? (result ? [result] : []) : result;
  if (!Array.isArray(entries)) throw new Error(`Ungueltige Inhalte: ${collection}`);
  for (const entry of entries) {
    const id = typeof entry[field] === "object" ? entry[field]?.id : entry[field];
    if (!id || files.has(id)) continue;
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`Ungueltige Datei-ID: ${collection}.${field}`);
    const file = await request(`/files/${id}?fields=id,folder,type`);
    if (!file.type?.startsWith("image/")) throw new Error(`Verknuepfte Datei ist kein Bild: ${id}`);
    // Never take files out of another managed folder.
    if (file.folder && file.folder !== folderId) throw new Error(`Bild ${id} liegt in einem anderen Ordner; bitte gezielt pruefen.`);
    files.set(id, file);
  }
}

for (const change of fieldChanges) {
  console.log(`${apply ? "Setze" : "Geplant:"} Upload-Ordner Website: ${change.collection}.${change.field}`);
  if (apply) await request(`/fields/${change.collection}/${change.field}`, "PATCH", { meta: { options: change.options } });
}
for (const file of files.values()) {
  if (file.folder === folderId) continue;
  console.log(`${apply ? "Verschiebe" : "Geplant:"} verknuepftes Bild nach Website: ${file.id}`);
  if (apply) await request(`/files/${file.id}`, "PATCH", { folder: folderId });
}

// Verify the saved configuration and existing references, without changing content or permissions.
if (apply) {
  for (const [collection, field] of targets) {
    const definition = await request(`/fields/${collection}/${field}`);
    if (definition.meta?.options?.folder !== folderId) throw new Error(`Upload-Ordner nicht gespeichert: ${collection}.${field}`);
  }
  for (const id of files.keys()) {
    const file = await request(`/files/${id}?fields=id,folder`);
    if (file.folder !== folderId) throw new Error(`Bildordner nicht gespeichert: ${id}`);
  }
}
console.log(apply ? "Ordnerzuweisung gespeichert und geprueft. Directus neu laden, dann Vorschau-Build pruefen." : "Prueflauf abgeschlossen; zum Anwenden erneut mit --apply ausfuehren.");
