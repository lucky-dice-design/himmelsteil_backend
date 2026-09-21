import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";
const roleName = "Website Editor";

if (!process.stdin.isTTY) {
  throw new Error("Dieses Skript benoetigt ein interaktives Terminal.");
}

async function prompt(label, hidden = false) {
  const output = hidden
    ? new Writable({ write(_chunk, _encoding, callback) { callback(); } })
    : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  if (hidden) process.stdout.write(label);
  try {
    return (await input.question(hidden ? "" : label)).trim();
  } finally {
    input.close();
    if (hidden) process.stdout.write("\n");
  }
}

async function request(path, method = "GET", body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.errors?.[0]?.message || response.statusText;
    if (response.status === 403 && message.includes("custom_permission_rules_enabled")) {
      throw new Error("Benutzerdefinierte Berechtigungen sind nicht lizenziert. Keine breiteren Rechte als Ersatz vergeben.");
    }
    throw new Error(`${method} ${path}: ${response.status} ${message}`);
  }
  return payload.data;
}

function listPath(name, field, value, fields) {
  const query = new URLSearchParams({
    [`filter[${field}][_eq]`]: value,
    fields,
    limit: "100",
  });
  return `/${name}?${query}`;
}

async function findUnique(name, field, value, fields, token) {
  const items = await request(listPath(name, field, value, fields), "GET", undefined, token);
  if (items.length > 1) throw new Error(`${name}: ${value} ist nicht eindeutig.`);
  return items[0];
}

function same(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return same(leftKeys, rightKeys) && leftKeys.every((key) => same(left[key], right[key]));
  }
  return left === right;
}

function fieldList(fields) {
  return Array.isArray(fields) ? fields : String(fields || "").split(",").filter(Boolean);
}

const adminEmail = await prompt("Directus-Admin-E-Mail: ");
const adminPassword = await prompt("Directus-Admin-Passwort: ", true);
const auth = await request("/auth/login", "POST", {
  email: adminEmail,
  password: adminPassword,
  mode: "json",
});
const adminToken = auth.access_token;
if (!adminToken) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const editorEmail = (await prompt("E-Mail des neuen Editors: ")).toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editorEmail)) {
  throw new Error("Ungueltige Editor-E-Mail-Adresse.");
}
if (await findUnique("users", "email", editorEmail, "id,email,role", adminToken)) {
  throw new Error("Diese E-Mail ist bereits vergeben. Ein vorhandener Benutzer wird nicht veraendert.");
}

const folder = await findUnique("folders", "name", "Website", "id,name", adminToken);
if (!folder) throw new Error("Der Directus-Dateiordner Website fehlt.");

let role = await findUnique("roles", "name", roleName, "id,name,parent", adminToken);
if (!role) {
  role = await request("/roles", "POST", {
    name: roleName,
    icon: "edit_note",
    description: "Redaktion fuer Galerie, Pakete, Blog und Bilder im Ordner Website",
  }, adminToken);
  console.log(`Rolle angelegt: ${roleName}`);
}
if (role.parent) throw new Error("Die Editor-Rolle erbt unerwartet eine andere Rolle.");

let policy = await findUnique("policies", "name", roleName, "id,name,admin_access,app_access", adminToken);
if (!policy) {
  policy = await request("/policies", "POST", {
    name: roleName,
    icon: "edit_note",
    description: "Inhalte bearbeiten und Bilder ausschliesslich im Ordner Website verwalten",
    admin_access: false,
    app_access: true,
    roles: [{ role: role.id }],
  }, adminToken);
  console.log(`Policy angelegt: ${roleName}`);
}
if (policy.admin_access || !policy.app_access) {
  throw new Error("Die Editor-Policy hat nicht die erwarteten App-/Admin-Einstellungen.");
}

async function linkedRoleIds() {
  const details = await request(`/policies/${policy.id}?fields=roles.role`, "GET", undefined, adminToken);
  return (details.roles || []).map((entry) => typeof entry === "string" ? entry : entry.role);
}

if (!(await linkedRoleIds()).includes(role.id)) {
  await request(`/policies/${policy.id}`, "PATCH", {
    roles: { create: [{ role: role.id }] },
  }, adminToken);
}
if (!(await linkedRoleIds()).includes(role.id)) throw new Error("Rolle und Policy sind nicht verknuepft.");

const roleDetails = await request(`/roles/${role.id}?fields=policies.policy,parent`, "GET", undefined, adminToken);
const rolePolicyIds = (roleDetails.policies || []).map((entry) => typeof entry === "string" ? entry : entry.policy);
if (roleDetails.parent || rolePolicyIds.length !== 1 || rolePolicyIds[0] !== policy.id) {
  throw new Error("Die Editor-Rolle hat unerwartete zusaetzliche Policies oder eine Elternrolle.");
}

const contentFields = {
  gallery_items: ["status", "sort", "category", "title", "description", "image", "image_alt", "swatch_class"],
  packages: ["status", "sort", "kicker", "title", "description", "features", "cta_label", "featured"],
  posts: ["status", "title", "slug", "category", "excerpt", "meta_title", "meta_description", "published_at", "reading_minutes", "sections"],
};

const grants = [];
for (const [collection, fields] of Object.entries(contentFields)) {
  grants.push({ collection, action: "read", permissions: {}, fields: ["id", ...fields] });
  grants.push({ collection, action: "create", permissions: {}, fields });
  grants.push({ collection, action: "update", permissions: {}, fields });
}
grants.push({
  collection: "directus_folders", action: "read",
  permissions: { id: { _eq: folder.id } },
  fields: ["id", "name", "parent"],
});
grants.push({
  collection: "directus_files", action: "read",
  permissions: { folder: { _eq: folder.id } },
  fields: ["*"],
});
grants.push({
  collection: "directus_files", action: "create",
  permissions: {},
  validation: { folder: { _eq: folder.id }, type: { _starts_with: "image/" } },
  presets: { folder: folder.id },
  fields: ["*"],
});
grants.push({
  collection: "directus_files", action: "update",
  permissions: { folder: { _eq: folder.id } },
  fields: ["title", "description", "filename_download", "tags", "focal_point_x", "focal_point_y"],
});

const existingGrants = await request(
  listPath("permissions", "policy", policy.id, "id,collection,action,permissions,validation,presets,fields"),
  "GET", undefined, adminToken
);
const managedCollections = new Set([...Object.keys(contentFields), "directus_files", "directus_folders"]);
for (const existing of existingGrants) {
  if (!managedCollections.has(existing.collection)) continue;
  const matching = grants.filter((grant) => grant.collection === existing.collection && grant.action === existing.action);
  if (matching.length !== 1) throw new Error(`Unerwartetes Recht: ${existing.collection}/${existing.action}`);
  if (existingGrants.filter((item) => item.collection === existing.collection && item.action === existing.action).length !== 1) {
    throw new Error(`Doppeltes Recht: ${existing.collection}/${existing.action}`);
  }
}

for (const grant of grants) {
  const existing = existingGrants.find((item) => item.collection === grant.collection && item.action === grant.action);
  if (existing) {
    if (!same(existing.permissions || {}, grant.permissions) ||
        !same(existing.validation || {}, grant.validation || {}) ||
        !same(existing.presets || {}, grant.presets || {}) ||
        !same(fieldList(existing.fields).sort(), [...grant.fields].sort())) {
      throw new Error(`Vorhandenes Recht weicht ab: ${grant.collection}/${grant.action}`);
    }
    console.log(`Recht vorhanden: ${grant.collection}/${grant.action}`);
    continue;
  }
  await request("/permissions", "POST", { policy: policy.id, ...grant }, adminToken);
  console.log(`Recht angelegt: ${grant.collection}/${grant.action}`);
}

const firstName = await prompt("Vorname des Editors (optional): ");
const lastName = await prompt("Nachname des Editors (optional): ");
const editorPassword = await prompt("Editor-Passwort (mindestens 16 Zeichen): ", true);
if (editorPassword.length < 16) throw new Error("Das Editor-Passwort muss mindestens 16 Zeichen haben.");
if (editorPassword !== await prompt("Editor-Passwort wiederholen: ", true)) {
  throw new Error("Die Editor-Passwoerter stimmen nicht ueberein.");
}

const editor = await request("/users", "POST", {
  email: editorEmail,
  first_name: firstName || undefined,
  last_name: lastName || undefined,
  password: editorPassword,
  status: "active",
  role: role.id,
}, adminToken);
if (editor.role !== role.id || editor.status !== "active") {
  throw new Error("Editor angelegt, aber Rolle oder Status bitte im Adminbereich pruefen.");
}
console.log(`Editor angelegt: ${editorEmail}`);

try {
  const editorAuth = await request("/auth/login", "POST", {
    email: editorEmail,
    password: editorPassword,
    mode: "json",
  });
  const editorToken = editorAuth.access_token;
  if (!editorToken) throw new Error("Editor-Anmeldung fehlgeschlagen.");
  for (const collection of Object.keys(contentFields)) {
    const items = await request(`/items/${collection}?limit=1&fields=id`, "GET", undefined, editorToken);
    if (!Array.isArray(items)) throw new Error(`Editor-Lesetest fehlgeschlagen: ${collection}`);
  }
  const files = await request("/files?limit=1&fields=id", "GET", undefined, editorToken);
  if (!Array.isArray(files)) throw new Error("Editor-Dateilesetest fehlgeschlagen.");

  const upload = new FormData();
  upload.set("folder", folder.id);
  upload.set("title", "Editor-Rechtetest");
  upload.set("file", new Blob([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64"),
  ], { type: "image/png" }), "editor-rechtetest.png");
  const uploadResponse = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${editorToken}` },
    body: upload,
  });
  const uploadPayload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadPayload.data?.id) {
    throw new Error(`Editor-Bildupload fehlgeschlagen: ${uploadResponse.status} ${uploadPayload.errors?.[0]?.message || ""}`);
  }
  try {
    if (uploadPayload.data.folder !== folder.id) {
      throw new Error("Testbild liegt nicht im Ordner Website.");
    }
    await request(`/files/${uploadPayload.data.id}`, "PATCH", { title: "Editor-Rechtetest geprueft" }, editorToken);
  } finally {
    await request(`/files/${uploadPayload.data.id}`, "DELETE", undefined, adminToken);
  }

  for (const [path, method, body] of [
    ["/roles", "POST", {}],
    ["/settings", "PATCH", {}],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${editorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 403) {
      throw new Error(`Verwaltungszugriff unerwartet moeglich: ${method} ${path} (${response.status}).`);
    }
  }
} catch (error) {
  await request(`/users/${editor.id}`, "PATCH", { status: "suspended" }, adminToken);
  throw new Error(`Editor wurde wegen fehlgeschlagener Rechtepruefung gesperrt: ${error.message}`);
}

console.log("Editor-Zugang geprueft: Inhalte lesbar, kein Rollen-/Systemzugriff.");
console.log("Passwoerter und Tokens wurden nicht ausgegeben. Editor-Passwort sicher weitergeben.");
