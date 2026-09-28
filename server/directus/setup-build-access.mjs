import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";
const roleName = "Website Build";
const buildEmail = "website-build@himmelsteil.de";

if (!process.stdin.isTTY) {
  throw new Error("Dieses Skript benötigt ein interaktives Terminal für die sichere Passwortabfrage.");
}

async function prompt(label, hidden = false) {
  const output = hidden
    ? new Writable({ write(_chunk, _encoding, callback) { callback(); } })
    : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  if (hidden) process.stdout.write(label);
  try {
    return await input.question(hidden ? "" : label);
  } finally {
    input.close();
    if (hidden) process.stdout.write("\n");
  }
}

async function request(path, method = "GET", body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.errors?.[0]?.message || response.statusText;
    if (response.status === 403 && message.includes("custom_permission_rules_enabled")) {
      throw new Error("Directus Core sperrt benutzerdefinierte Lesefilter. Erst eine passende Lizenz aktivieren; danach dieses Skript erneut starten.");
    }
    throw new Error(`${method} ${path}: ${response.status} ${message}`);
  }
  return payload.data;
}

function listPath(name, field, value, fields) {
  const query = new URLSearchParams({
    [`filter[${field}][_eq]`]: value,
    fields,
    limit: "10",
  });
  return `/${name}?${query}`;
}

async function findUnique(name, field, value, fields, token) {
  const items = await request(listPath(name, field, value, fields), "GET", undefined, token);
  if (items.length > 1) throw new Error(`${name}: ${value} ist nicht eindeutig.`);
  return items[0];
}

const email = await prompt("Directus-Admin-E-Mail: ");
const password = await prompt("Directus-Admin-Passwort: ", true);
const adminAuth = await request("/auth/login", "POST", { email, password, mode: "json" });
const adminToken = adminAuth.access_token;
if (!adminToken) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const folder = await findUnique("folders", "name", "Website", "id,name", adminToken);
if (!folder) throw new Error("Der Directus-Dateiordner Website fehlt.");

let role = await findUnique("roles", "name", roleName, "id,name", adminToken);
if (!role) {
  role = await request("/roles", "POST", {
    name: roleName,
    icon: "web",
    description: "Technischer Lesekonto-Rolle für den statischen Website-Build",
  }, adminToken);
  console.log(`Rolle angelegt: ${roleName}`);
}

let policy = await findUnique("policies", "name", roleName, "id,name,admin_access,app_access", adminToken);
if (!policy) {
  policy = await request("/policies", "POST", {
    name: roleName,
    icon: "visibility",
    description: "Nur veröffentlichte Website-Inhalte und Bilder aus dem Ordner Website",
    admin_access: false,
    app_access: false,
    roles: [{ role: role.id }],
  }, adminToken);
  console.log(`Policy angelegt: ${roleName}`);
}
if (policy.admin_access || policy.app_access) {
  throw new Error("Die Website-Build-Policy hat unerwartet App- oder Admin-Zugriff.");
}

async function linkedRoleIds() {
  const details = await request(`/policies/${policy.id}?fields=roles.role`, "GET", undefined, adminToken);
  return (details.roles || []).map((entry) => typeof entry === "string" ? entry : entry.role);
}

let roleIds = await linkedRoleIds();
if (!roleIds.includes(role.id)) {
  await request(`/policies/${policy.id}`, "PATCH", {
    roles: { create: [{ role: role.id }] },
  }, adminToken);
  roleIds = await linkedRoleIds();
}
if (!roleIds.includes(role.id)) throw new Error("Rolle und Policy sind nicht verknüpft.");

const grants = [
  {
    collection: "gallery_items",
    permissions: { status: { _eq: "published" } },
    fields: ["id", "status", "sort", "category", "title", "description", "image", "image_alt", "swatch_class"],
  },
  {
    collection: "packages",
    permissions: { status: { _eq: "published" } },
    fields: ["id", "status", "sort", "kicker", "title", "description", "features", "cta_label", "featured"],
  },
  {
    collection: "posts",
    permissions: { status: { _eq: "published" } },
    fields: ["id", "status", "title", "slug", "category", "excerpt", "meta_title", "meta_description", "published_at", "reading_minutes", "sections"],
  },
  {
    collection: "directus_files",
    permissions: { folder: { _eq: folder.id } },
    fields: ["*"],
  },
];

const existingGrants = await request(
  listPath("permissions", "policy", policy.id, "id,collection,action,permissions,fields"),
  "GET", undefined, adminToken
);
const allowedCollections = new Set([
  ...grants.map((grant) => grant.collection),
  "home_page", "home_tiles", "home_occasions", "legal_pages", "legal_sections",
  "contact_form", "contact_options",
]);
if (existingGrants.some((item) => item.action !== "read" || !allowedCollections.has(item.collection))) {
  throw new Error("Die Website-Build-Policy enthält unerwartete Berechtigungen; bitte manuell prüfen.");
}
for (const grant of grants) {
  const matches = existingGrants.filter((item) => item.collection === grant.collection && item.action === "read");
  if (matches.length > 1) throw new Error(`Doppeltes Leserecht fuer ${grant.collection}.`);
  const existing = matches[0];
  if (existing) {
    if (JSON.stringify(existing.permissions) !== JSON.stringify(grant.permissions)) {
      throw new Error(`Vorhandene Leseregel für ${grant.collection} weicht vom Soll ab; bitte manuell prüfen.`);
    }
    const fields = Array.isArray(existing.fields) ? existing.fields : String(existing.fields || "").split(",").filter(Boolean);
    if (fields.length !== grant.fields.length || !fields.every((field) => grant.fields.includes(field))) {
      throw new Error(`Vorhandene Feldrechte fuer ${grant.collection} weichen ab; fix-build-status-access.mjs ausfuehren.`);
    }
    console.log(`Leserecht vorhanden: ${grant.collection}`);
    continue;
  }
  await request("/permissions", "POST", {
    policy: policy.id,
    collection: grant.collection,
    action: "read",
    permissions: grant.permissions,
    fields: grant.fields,
  }, adminToken);
  console.log(`Leserecht angelegt: ${grant.collection}`);
}

let buildUser = await findUnique("users", "email", buildEmail, "id,email,role,status,token", adminToken);
let buildToken = buildUser?.token;
if (!buildUser) {
  buildToken = randomBytes(32).toString("hex");
  buildUser = await request("/users", "POST", {
    email: buildEmail,
    first_name: "Website",
    last_name: "Build",
    status: "active",
    role: role.id,
    password: randomBytes(48).toString("hex"),
    token: buildToken,
  }, adminToken);
  console.log(`Technischen Benutzer angelegt: ${buildEmail}`);
}
if (buildUser.role !== role.id || buildUser.status !== "active") {
  throw new Error("Der technische Benutzer hat nicht die erwartete aktive Rolle.");
}

async function tokenWorks(token) {
  if (!token) return false;
  const response = await fetch(`${baseUrl}/items/gallery_items?limit=1&fields=id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) return false;
  if (!response.ok) {
    throw new Error(`Build-Token wurde erkannt, aber der Lesetest ergab ${response.status}.`);
  }
  return true;
}

if (!(await tokenWorks(buildToken))) {
  buildToken = randomBytes(32).toString("hex");
  await request(`/users/${buildUser.id}`, "PATCH", { token: buildToken }, adminToken);
  console.log("Technischen Token neu gesetzt (Wert wird nicht ausgegeben).");
  if (!(await tokenWorks(buildToken))) {
    throw new Error("Der neu gesetzte technische Token wird von Directus nicht akzeptiert.");
  }
}

for (const grant of grants) {
  const endpoint = grant.collection === "directus_files" ? "/files" : `/items/${grant.collection}`;
  const items = await request(`${endpoint}?limit=1&fields=id`, "GET", undefined, buildToken);
  if (!Array.isArray(items)) throw new Error(`Lesetest fehlgeschlagen: ${grant.collection}`);
  console.log(`Lesetest erfolgreich: ${grant.collection}`);
}

const writeTest = await fetch(`${baseUrl}/items/packages`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${buildToken}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
if (writeTest.status !== 403) {
  throw new Error(`Schreibtest fehlgeschlagen: erwartet 403, erhalten ${writeTest.status}.`);
}

console.log("Build-Zugang geprüft: Lesen erlaubt, Schreiben verboten.");
console.log("Der Token wurde nicht ausgegeben. Er bleibt im technischen Directus-Benutzer gespeichert.");
