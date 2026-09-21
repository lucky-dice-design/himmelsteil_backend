import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";

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
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 429 && attempt < 6) {
      await response.arrayBuffer().catch(() => {});
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(1000, Math.min(retryAfter * 1000, 10000))
        : Math.min(1000 * 2 ** attempt, 8000);
      console.warn(`Directus-Ratenlimit; erneuter Versuch in ${delay / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.errors?.[0]?.message || response.statusText;
      throw new Error(`${method} ${path}: ${response.status} ${message}`);
    }
    return payload.data;
  }
}

function listPath(name, field, value, fields) {
  const query = new URLSearchParams({
    [`filter[${field}][_eq]`]: value,
    fields,
    limit: "100",
  });
  return `/${name}?${query}`;
}

function fieldList(value) {
  return Array.isArray(value) ? value : String(value || "").split(",").filter(Boolean);
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

const specs = [
  {
    collection: "gallery_items",
    fields: ["id", "sort", "category", "title", "description", "image", "image_alt", "swatch_class"],
  },
  {
    collection: "packages",
    fields: ["id", "sort", "kicker", "title", "description", "features", "cta_label", "featured"],
  },
  {
    collection: "posts",
    fields: ["id", "title", "slug", "category", "excerpt", "meta_title", "meta_description", "published_at", "reading_minutes", "sections"],
  },
];

const email = await prompt("Directus-Admin-E-Mail: ");
const password = await prompt("Directus-Admin-Passwort: ", true);
const auth = await request("/auth/login", "POST", { email, password, mode: "json" });
const token = auth.access_token;
if (!token) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const policies = await request(listPath("policies", "name", "Website Build", "id,name,admin_access,app_access"), "GET", undefined, token);
if (policies.length !== 1 || policies[0].admin_access || policies[0].app_access) {
  throw new Error("Website-Build-Policy fehlt, ist nicht eindeutig oder hat unerwartete Admin-/App-Rechte.");
}
const policyId = policies[0].id;
const grants = await request(listPath("permissions", "policy", policyId, "id,collection,action,permissions,fields"), "GET", undefined, token);

for (const spec of specs) {
  const matches = grants.filter((grant) => grant.collection === spec.collection && grant.action === "read");
  if (matches.length !== 1) throw new Error(`${spec.collection}: genau ein Build-Leserecht erwartet.`);
  const grant = matches[0];
  const expectedFilter = { status: { _eq: "published" } };
  if (JSON.stringify(grant.permissions) !== JSON.stringify(expectedFilter)) {
    throw new Error(`${spec.collection}: Veroeffentlichungsfilter weicht ab; keine automatische Aenderung.`);
  }
  const currentFields = fieldList(grant.fields);
  const expectedFields = [...spec.fields, "status"];
  if (!sameSet(currentFields, spec.fields) && !sameSet(currentFields, expectedFields)) {
    throw new Error(`${spec.collection}: Feldrechte weichen ab; keine automatische Aenderung.`);
  }
  if (!currentFields.includes("status")) {
    await request(`/permissions/${grant.id}`, "PATCH", { fields: expectedFields }, token);
    console.log(`Status-Lesefeld ergaenzt: ${spec.collection}`);
  } else {
    console.log(`Status-Lesefeld bereits vorhanden: ${spec.collection}`);
  }
  const verified = await request(`/permissions/${grant.id}?fields=fields,permissions`, "GET", undefined, token);
  if (!sameSet(fieldList(verified.fields), expectedFields) ||
      JSON.stringify(verified.permissions) !== JSON.stringify(expectedFilter)) {
    throw new Error(`${spec.collection}: Rechtepruefung nach Update fehlgeschlagen.`);
  }
}

console.log("Build-Leserechte korrigiert. Token und andere Policies wurden nicht veraendert.");
