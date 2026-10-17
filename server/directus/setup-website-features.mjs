import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyCollectionNavigation, rateLimitDelay } from "./setup-collection-navigation.mjs";

export const siteDefaults = {
  brand_name: "himmelsteil Papeterie", brand_home_label: "himmelsteil Papeterie Startseite",
  menu_label: "Menü öffnen", nav_label: "Hauptnavigation",
  header_links: [
    { label: "Start", href: "/" }, { label: "Galerie", href: "/galerie" },
    { label: "Pakete", href: "/pakete" }, { label: "Blog", href: "/blog" }, { label: "Kontakt", href: "/kontakt" },
  ],
  footer_text: "© himmelsteil Papeterie 2026",
  footer_links: [{ label: "Kontakt", href: "/kontakt" }, { label: "Impressum", href: "/impressum" }, { label: "Datenschutz", href: "/datenschutz" }],
};
export const lists = ["gallery_items", "packages", "posts", "home_tiles", "home_occasions", "legal_pages", "legal_sections", "contact_options"];
export const singletons = ["home_page", "contact_form", "site_settings"];
const imageFields = { gallery_items: "image", home_tiles: "image", home_page: "hero_image", contact_form: "intro_image" };
const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: "input", ...meta }, schema });
const settingsFields = Object.keys(siteDefaults).map((name) => name.endsWith("_links")
  ? field(name, "json", { interface: "list", special: ["cast-json"], required: true, note: "Beschriftung, interner Link und Reihenfolge bearbeiten.", options: { fields: [
    { field: "label", name: "Beschriftung", type: "string", meta: { interface: "input", required: true } },
    { field: "href", name: "Linkziel", type: "string", meta: { interface: "input", required: true, note: "Interner Pfad, z. B. /kontakt" } },
  ] } })
  : field(name, "string", { required: true }));

function statusDefinition(singleton) {
  return field("status", "string", {
    interface: "select-dropdown", required: true,
    translations: [{ language: "de-DE", translation: "Veröffentlichung" }],
    note: singleton ? "Preview: neue Fassung nur in der Vorschau. Live behält bis zur Freigabe den letzten Live-Stand." : "Preview: nur Vorschau. Live: Vorschau und öffentliche Website. Entwurf: nicht sichtbar.",
    options: { choices: [
      ...(!singleton ? [{ text: "Entwurf", value: "draft" }] : []),
      { text: "Preview", value: "preview" }, { text: "Live", value: "live" },
    ] },
  }, { default_value: singleton ? "live" : "draft" });
}

// Extend existing grants without replacing their field restrictions or write validation.
async function extendGrant(request, policy, collection, action, additions, permissions) {
  const query = new URLSearchParams({ "filter[policy][_eq]": policy.id, "filter[collection][_eq]": collection, "filter[action][_eq]": action, limit: "100" });
  const grants = await request(`/permissions?${query}`);
  if (grants.length > 1) throw new Error(`${policy.name}: mehrdeutiges Recht ${collection}/${action}`);
  const current = grants[0];
  if (!current && collection !== "site_settings") throw new Error(`${policy.name}: Recht fehlt fuer ${collection}/${action}`);
  const fields = Array.isArray(current?.fields) ? current.fields : String(current?.fields || "").split(",").filter(Boolean);
  if (fields.includes("*")) throw new Error(`${policy.name}: unerwartetes Wildcard-Recht fuer ${collection}`);
  const body = { fields: [...new Set([...fields, ...additions])], ...(permissions === undefined ? {} : { permissions }) };
  if (current) await request(`/permissions/${current.id}`, "PATCH", body);
  else await request("/permissions", "POST", { policy: policy.id, collection, action, permissions: null, ...body });
}

export async function applyWebsiteFeatures(request) {
  // Check both restricted policies and all base modules before changing schema.
  const policies = await request('/policies?limit=100&fields=id,name,admin_access,app_access');
  const policy = (name) => {
    const matches = policies.filter((item) => item.name === name);
    if (matches.length !== 1 || matches[0].admin_access || Boolean(matches[0].app_access) !== (name === "Website Editor")) {
      throw new Error(`Policy ${name} fehlt oder hat unerwartete Rechte.`);
    }
    return matches[0];
  };
  const build = policy("Website Build"), editor = policy("Website Editor");
  const collections = new Set((await request("/collections")).map((item) => item.collection));
  for (const name of [...lists, "home_page", "contact_form"]) {
    if (!collections.has(name)) throw new Error(`Zuerst Basismodul einrichten: ${name}`);
  }
  if (!collections.has("site_settings")) {
    await request("/collections", "POST", { collection: "site_settings", schema: {}, meta: { singleton: true, icon: "web", note: "Gemeinsamer Header und Footer aller Seiten" } });
  }
  for (const name of [...lists, ...singletons]) {
    const existing = new Set((await request(`/fields/${name}`)).map((item) => item.field));
    const definitions = [statusDefinition(singletons.includes(name))];
    if (name === "site_settings") definitions.push(...settingsFields);
    if (imageFields[name]) {
      const prefix = imageFields[name];
      definitions.push(
        field(`${prefix}_copyright`, "string", { note: "Optionaler Bildnachweis, z. B. © Fotografin. HTML wird als Text ausgegeben.", translations: [{ language: "de-DE", translation: "Bild-Copyright" }] }),
        field(`show_${prefix}_copyright`, "boolean", { interface: "boolean", special: ["cast-boolean"], translations: [{ language: "de-DE", translation: "Bild-Copyright anzeigen" }] }, { default_value: false }),
      );
    }
    for (const definition of definitions) {
      if (!existing.has(definition.field)) await request(`/fields/${name}`, "POST", definition);
      else if (definition.field === "status") await request(`/fields/${name}/status`, "PATCH", { meta: definition.meta });
    }
    if (lists.includes(name)) {
      await request(`/items/${name}`, "PATCH", { query: { filter: { status: { _eq: "published" } } }, data: { status: "live" } });
    }
    const additions = ["status", ...(name === "site_settings" ? Object.keys(siteDefaults) : []),
      ...(imageFields[name] ? [`${imageFields[name]}_copyright`, `show_${imageFields[name]}_copyright`] : [])];
    await extendGrant(request, build, name, "read", ["id", ...additions], lists.includes(name) ? { status: { _in: ["live", "preview", "published"] } } : null);
    await extendGrant(request, editor, name, "read", ["id", ...additions]);
    await extendGrant(request, editor, name, "update", additions);
    if (["gallery_items", "packages", "posts", "home_occasions", "legal_sections", "contact_options"].includes(name)) {
      await extendGrant(request, editor, name, "create", additions);
    }
  }
  const settings = await request("/items/site_settings?fields=id");
  if (!settings?.id) await request("/items/site_settings", "PATCH", { status: "live", ...siteDefaults });
  await applyCollectionNavigation(request);
}

async function prompt(label, hidden = false) {
  const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  if (hidden) process.stdout.write(label);
  try { return await input.question(hidden ? "" : label); }
  finally { input.close(); if (hidden) process.stdout.write("\n"); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--env-auth")) throw new Error("Aufruf: node setup-website-features.mjs [--env-auth]");
  let token;
  const request = async (path, method = "GET", body) => {
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await fetch(`http://127.0.0.1:8055${path}`, {
        method, signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 429 && attempt < 6) {
        await response.arrayBuffer();
        const delay = rateLimitDelay(response.headers.get("retry-after"));
        console.warn(`Directus-Ratenlimit: erneuter Versuch in ${Math.ceil(delay / 1000)} Sekunden.`);
        await new Promise((done) => setTimeout(done, delay));
        continue;
      }
      if (!response.ok) throw new Error(`Directus ${method} ${path}: HTTP ${response.status}`);
      if (response.status === 204) return null;
      return (await response.json()).data;
    }
  };
  if (!args.includes("--env-auth") && !process.stdin.isTTY) throw new Error("Interaktives Terminal erforderlich.");
  const email = args.includes("--env-auth") ? process.env.ADMIN_EMAIL : await prompt("Directus-Admin-E-Mail: ");
  const password = args.includes("--env-auth") ? process.env.ADMIN_PASSWORD : await prompt("Directus-Admin-Passwort: ", true);
  if (!email || !password) throw new Error("Admin-Zugang fehlt.");
  token = (await request("/auth/login", "POST", { email, password })).access_token;
  if (!token) throw new Error("Anmeldung fehlgeschlagen.");
  await applyWebsiteFeatures(request);
  console.log("Header/Footer, optionale Bildnachweise und Live/Preview eingerichtet.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
