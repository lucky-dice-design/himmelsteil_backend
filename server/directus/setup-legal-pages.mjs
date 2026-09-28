import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";

if (!process.stdin.isTTY) throw new Error("Dieses Skript benoetigt ein interaktives Terminal.");

async function prompt(label, hidden = false) {
  const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
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
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 429 && attempt < 6) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000) : Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${payload.errors?.[0]?.message || response.statusText}`);
    }
    return payload.data;
  }
}

function listPath(name, field, value, fields) {
  const query = new URLSearchParams({ [`filter[${field}][_eq]`]: value, fields, limit: "100" });
  return `/${name}?${query}`;
}

async function findUnique(name, field, value, fields, token) {
  const items = await request(listPath(name, field, value, fields), "GET", undefined, token);
  if (items.length > 1) throw new Error(`${name}: ${value} ist nicht eindeutig.`);
  return items[0];
}

const field = (name, type, meta = {}, schema = {}) => ({
  field: name, type,
  meta: { interface: type === "text" ? "input-multiline" : "input", ...meta },
  schema,
});

const statusField = field("status", "string", {
  interface: "select-dropdown", required: true,
  options: { choices: [
    { text: "Entwurf", value: "draft" },
    { text: "Veroeffentlicht", value: "published" },
  ] },
}, { default_value: "draft" });

const pageChoices = { choices: [
  { text: "Impressum", value: "impressum" },
  { text: "Datenschutz", value: "datenschutz" },
] };

const collections = [
  {
    name: "legal_pages", icon: "gavel", note: "Impressum und Datenschutz; erst nach Pruefung veroeffentlichen",
    fields: [
      statusField,
      field("slug", "string", { required: true, interface: "select-dropdown", options: pageChoices }, { is_unique: true }),
      field("title", "string", { required: true }),
      field("seo_description", "text", { required: true }),
    ],
  },
  {
    name: "legal_sections", icon: "segment", note: "Abschnitte der Rechtstexte; Leerzeile trennt Absaetze",
    fields: [
      statusField,
      field("sort", "integer"),
      field("seed_key", "string", { hidden: true }, { is_unique: true }),
      field("page", "string", { required: true, interface: "select-dropdown", options: pageChoices }),
      field("heading", "string", { required: true }),
      field("body", "text", { required: true, note: "Nur Text; Leerzeilen trennen Absaetze." }),
    ],
  },
];

const pageDefaults = [
  { slug: "impressum", title: "Impressum", seo_description: "Impressum und Anbieterinformationen von himmelsteil Papeterie." },
  { slug: "datenschutz", title: "Datenschutz", seo_description: "Datenschutzhinweise von himmelsteil Papeterie." },
];

const sectionDefaults = [
  { seed_key: "imprint-provider", page: "impressum", sort: 1, heading: "Angaben gemaess Paragraph 5 DDG", body: "Anna Dahlenburg\nhimmelsteil Papeterie\nParadeisstr. 7\n82362 Weilheim" },
  { seed_key: "imprint-contact", page: "impressum", sort: 2, heading: "Kontakt", body: "E-Mail: info@himmelsteil.de\n\nHinweis: Dieser Entwurf muss vor der Veroeffentlichung um alle erforderlichen Angaben ergaenzt und geprueft werden." },
  { seed_key: "privacy-controller", page: "datenschutz", sort: 1, heading: "Verantwortliche Stelle", body: "Anna Dahlenburg, himmelsteil Papeterie, Paradeisstr. 7, 82362 Weilheim." },
  { seed_key: "privacy-contact", page: "datenschutz", sort: 2, heading: "Kontaktformular", body: "Bei einer Anfrage ueber das Kontaktformular werden Name, E-Mail-Adresse, Anlass, gewuenschter Zeitraum und Nachricht zur Bearbeitung der Anfrage im geschuetzten Redaktionssystem gespeichert und per E-Mail an uns uebermittelt. Pflichtangaben sind erforderlich, um die Anfrage beantworten zu koennen." },
  { seed_key: "privacy-technical", page: "datenschutz", sort: 3, heading: "Technische Hinweise", body: "Beim Aufruf der Website und Absenden des Formulars koennen technisch notwendige Verbindungsdaten verarbeitet werden. Dieser Entwurf muss vor der Veroeffentlichung an das tatsaechliche Hosting, die Rechtsgrundlage, Empfaenger, Speicherdauer und alle eingebundenen Dienste angepasst und rechtlich geprueft werden." },
];

const adminEmail = await prompt("Directus-Admin-E-Mail: ");
const adminPassword = await prompt("Directus-Admin-Passwort: ", true);
const auth = await request("/auth/login", "POST", { email: adminEmail, password: adminPassword, mode: "json" });
const token = auth.access_token;
if (!token) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const existingCollections = new Set((await request("/collections", "GET", undefined, token)).map((item) => item.collection));
for (const collection of collections) {
  if (!existingCollections.has(collection.name)) {
    await request("/collections", "POST", {
      collection: collection.name, schema: {}, meta: { icon: collection.icon, note: collection.note },
    }, token);
    console.log(`Collection angelegt: ${collection.name}`);
  } else {
    console.log(`Collection vorhanden: ${collection.name}`);
  }
  const existingFields = new Set((await request(`/fields/${collection.name}`, "GET", undefined, token)).map((item) => item.field));
  for (const definition of collection.fields) {
    if (existingFields.has(definition.field)) continue;
    await request(`/fields/${collection.name}`, "POST", definition, token);
    console.log(`Feld angelegt: ${collection.name}.${definition.field}`);
  }
}
await request("/collections/legal_sections", "PATCH", { meta: { sort_field: "sort" } }, token);

for (const page of pageDefaults) {
  if (await findUnique("items/legal_pages", "slug", page.slug, "id,slug", token)) continue;
  await request("/items/legal_pages", "POST", { ...page, status: "draft" }, token);
  console.log(`Rechtstext-Entwurf angelegt: ${page.slug}`);
}
for (const section of sectionDefaults) {
  if (await findUnique("items/legal_sections", "seed_key", section.seed_key, "id,seed_key", token)) continue;
  await request("/items/legal_sections", "POST", { ...section, status: "published" }, token);
  console.log(`Abschnitt angelegt: ${section.seed_key}`);
}

const policySpecs = [
  {
    name: "Website Build", admin: false, app: false,
    grants: [
      { collection: "legal_pages", action: "read", permissions: { status: { _eq: "published" } }, fields: ["id", "status", "slug", "title", "seo_description"] },
      { collection: "legal_sections", action: "read", permissions: { status: { _eq: "published" } }, fields: ["id", "status", "sort", "page", "heading", "body"] },
    ],
  },
  {
    name: "Website Editor", admin: false, app: true,
    grants: [
      { collection: "legal_pages", action: "read", permissions: {}, fields: ["id", "status", "slug", "title", "seo_description"] },
      { collection: "legal_pages", action: "update", permissions: {}, fields: ["status", "title", "seo_description"] },
      { collection: "legal_sections", action: "read", permissions: {}, fields: ["id", "status", "sort", "page", "heading", "body"] },
      { collection: "legal_sections", action: "create", permissions: {}, fields: ["status", "sort", "page", "heading", "body"] },
      { collection: "legal_sections", action: "update", permissions: {}, fields: ["status", "sort", "page", "heading", "body"] },
    ],
  },
];

function same(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = Object.keys(left).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(right).sort()) && keys.every((key) => same(left[key], right[key]));
  }
  return left === right;
}

for (const spec of policySpecs) {
  const policy = await findUnique("policies", "name", spec.name, "id,name,admin_access,app_access", token);
  if (!policy || Boolean(policy.admin_access) !== spec.admin || Boolean(policy.app_access) !== spec.app) {
    throw new Error(`Policy ${spec.name} fehlt oder hat unerwartete Admin-/App-Rechte.`);
  }
  const existing = await request(listPath("permissions", "policy", policy.id, "id,collection,action,permissions,fields"), "GET", undefined, token);
  for (const grant of spec.grants) {
    const matches = existing.filter((item) => item.collection === grant.collection && item.action === grant.action);
    if (matches.length > 1) throw new Error(`Doppeltes Recht: ${spec.name} ${grant.collection}/${grant.action}`);
    if (matches.length === 1) {
      const current = matches[0];
      const fields = Array.isArray(current.fields) ? current.fields : String(current.fields || "").split(",");
      if (!same(current.permissions || {}, grant.permissions) || !same(fields.sort(), [...grant.fields].sort())) {
        throw new Error(`Vorhandenes Recht weicht ab: ${spec.name} ${grant.collection}/${grant.action}`);
      }
      continue;
    }
    await request("/permissions", "POST", { policy: policy.id, ...grant }, token);
    console.log(`Recht angelegt: ${spec.name} ${grant.collection}/${grant.action}`);
  }
}

console.log("Rechtstexte und Rechte bereit. Beide Seiten bleiben als Entwurf; die bisherige Vorschau bleibt unveraendert.");
