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
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(1000, Math.min(retryAfter * 1000, 10000))
        : Math.min(1000 * 2 ** attempt, 8000);
      console.warn(`Directus-Ratenlimit bei ${method} ${path}; erneuter Versuch in ${delay / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
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

const statusField = {
  field: "status",
  type: "string",
  meta: {
    interface: "select-dropdown",
    required: true,
    options: { choices: [
      { text: "Entwurf", value: "draft" },
      { text: "Veroeffentlicht", value: "published" },
    ] },
  },
  schema: { default_value: "draft" },
};

const field = (name, type, meta = {}, schema = {}) => ({
  field: name,
  type,
  meta: { interface: type === "text" ? "input-multiline" : "input", ...meta },
  schema,
});

const imageField = (name) => field(name, "uuid", { interface: "file-image", special: ["file"] });

const collections = [
  {
    name: "home_page", icon: "home", singleton: true,
    note: "Startseite: SEO, Hero, Einleitung und Ueberschrift der Anlaesse",
    fields: [
      field("seo_title", "string", { required: true }),
      field("seo_description", "text", { required: true }),
      field("hero_eyebrow", "string", { required: true }),
      field("hero_title", "string", { required: true }),
      field("hero_body", "text", { required: true }),
      imageField("hero_image"),
      field("hero_image_alt", "string", { required: true, note: "Bildbeschreibung fuer Screenreader." }),
      field("hero_primary_label", "string", { required: true, note: "Linkziel: Kontakt." }),
      field("hero_secondary_label", "string", { required: true, note: "Linkziel: Galerie." }),
      field("intro_eyebrow", "string", { required: true }),
      field("intro_title", "string", { required: true }),
      field("intro_body", "text", { required: true }),
      field("intro_link_label", "string", { required: true, note: "Linkziel: Pakete." }),
      field("occasions_eyebrow", "string", { required: true }),
      field("occasions_title", "string", { required: true }),
    ],
  },
  {
    name: "home_tiles", icon: "dashboard", singleton: false,
    note: "Drei feste Startseiten-Kacheln fuer Galerie, Pakete und Blog",
    fields: [
      statusField,
      field("sort", "integer"),
      field("destination", "string", {
        interface: "select-dropdown", required: true,
        options: { choices: [
          { text: "Galerie", value: "galerie" },
          { text: "Pakete", value: "pakete" },
          { text: "Blog", value: "blog" },
        ] },
      }, { is_unique: true }),
      field("label", "string", { required: true }),
      imageField("image"),
      field("image_alt", "string", { note: "Bei Bild erforderlich." }),
    ],
  },
  {
    name: "home_occasions", icon: "celebration", singleton: false,
    note: "Anlaesse auf der Startseite; Entwurf blendet einen Eintrag aus",
    fields: [
      statusField,
      field("sort", "integer"),
      field("seed_key", "string", { hidden: true }, { is_unique: true }),
      field("title", "string", { required: true }),
      field("description", "text", { required: true }),
    ],
  },
];

const homeDefaults = {
  seo_title: "Individuelle Hochzeits- & Eventpapeterie | himmelsteil Weilheim",
  seo_description: "Individuelle Papeterie aus Weilheim f\u00fcr Hochzeiten, Taufen, Geburtstage und besondere Events. Pers\u00f6nlich gestaltet statt von der Stange.",
  hero_eyebrow: "Individuelle Papeterie aus Weilheim",
  hero_title: "Sch\u00f6nes auf Papier.",
  hero_body: "Individuelle Papeterie f\u00fcr Hochzeit, Taufe, Geburtstag und all die Momente, die ein wenig l\u00e4nger bleiben d\u00fcrfen.",
  hero_image_alt: "Individuelle Einladung mit Umschlag und feiner Illustration",
  hero_primary_label: "Projekt anfragen",
  hero_secondary_label: "Arbeiten ansehen",
  intro_eyebrow: "Individuell statt Massenware",
  intro_title: "Ein roter Faden f\u00fcr eure Feier.",
  intro_body: "Von der ersten Einladung bis zur Men\u00fckarte, vom Sitzplan bis zum kleinen Gastgeschenk entsteht ein Designkonzept, das eure Geschichte tr\u00e4gt. Hochzeit ist unser Schwerpunkt, aber l\u00e4ngst nicht der einzige sch\u00f6ne Anlass.",
  intro_link_label: "Papeterie-Pakete entdecken",
  occasions_eyebrow: "F\u00fcr gro\u00dfe und kleine Feste",
  occasions_title: "Papeterie, die zum Anlass passt.",
};

const tileDefaults = [
  { sort: 1, destination: "galerie", label: "Galerie", image_alt: "Papeterie mit Aufschrift f\u00fcr Dich" },
  { sort: 2, destination: "pakete", label: "Pakete" },
  { sort: 3, destination: "blog", label: "Blog" },
];

const occasionDefaults = [
  { sort: 1, seed_key: "hochzeit", title: "Hochzeit", description: "Einladung, Tagespapeterie und Dankeskarte." },
  { sort: 2, seed_key: "taufe", title: "Taufe & Kommunion", description: "Pers\u00f6nlich, leicht und liebevoll abgestimmt." },
  { sort: 3, seed_key: "geburtstag", title: "Geburtstag", description: "Vom runden Geburtstag bis zur Gartenfeier." },
  { sort: 4, seed_key: "business", title: "Business & Event", description: "Einladungen, Karten und kleine Markendetails." },
];

const adminEmail = await prompt("Directus-Admin-E-Mail: ");
const adminPassword = await prompt("Directus-Admin-Passwort: ", true);
const auth = await request("/auth/login", "POST", { email: adminEmail, password: adminPassword, mode: "json" });
const token = auth.access_token;
if (!token) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const existingCollections = new Set(
  (await request("/collections", "GET", undefined, token)).map(({ collection }) => collection)
);
for (const collection of collections) {
  if (!existingCollections.has(collection.name)) {
    await request("/collections", "POST", {
      collection: collection.name,
      schema: {},
      meta: { icon: collection.icon, note: collection.note, singleton: collection.singleton },
    }, token);
    console.log(`Collection angelegt: ${collection.name}`);
  } else {
    const details = await request(`/collections/${collection.name}`, "GET", undefined, token);
    if (Boolean(details.meta?.singleton) !== collection.singleton) {
      throw new Error(`${collection.name}: Singleton-Einstellung weicht ab.`);
    }
    console.log(`Collection vorhanden: ${collection.name}`);
  }

  const existingFields = new Set(
    (await request(`/fields/${collection.name}`, "GET", undefined, token)).map(({ field: name }) => name)
  );
  for (const definition of collection.fields) {
    if (existingFields.has(definition.field)) continue;
    await request(`/fields/${collection.name}`, "POST", definition, token);
    console.log(`  Feld angelegt: ${definition.field}`);
  }
  if (!collection.singleton) {
    await request(`/collections/${collection.name}`, "PATCH", { meta: { sort_field: "sort" } }, token);
  }
}

for (const [collection, imageFieldName] of [["home_page", "hero_image"], ["home_tiles", "image"]]) {
  const relations = await request(`/relations/${collection}`, "GET", undefined, token);
  if (!relations.some(({ field: name }) => name === imageFieldName)) {
    await request("/relations", "POST", {
      collection,
      field: imageFieldName,
      related_collection: "directus_files",
      meta: { one_deselect_action: "nullify" },
      schema: { on_delete: "SET NULL" },
    }, token);
    console.log(`Dateiverknuepfung angelegt: ${collection}.${imageFieldName}`);
  }
}

const singletonResponse = await fetch(`${baseUrl}/items/home_page?fields=id`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!singletonResponse.ok && singletonResponse.status !== 404) {
  throw new Error(`GET /items/home_page: ${singletonResponse.status}`);
}
const singleton = singletonResponse.ok ? (await singletonResponse.json()).data : null;
if (!singleton?.id) {
  await request("/items/home_page", "PATCH", homeDefaults, token);
  console.log("Startseite mit den bisherigen Texten angelegt.");
}

for (const tile of tileDefaults) {
  if (await findUnique("items/home_tiles", "destination", tile.destination, "id,destination", token)) continue;
  await request("/items/home_tiles", "POST", { ...tile, status: "published" }, token);
  console.log(`Kachel angelegt: ${tile.destination}`);
}
for (const occasion of occasionDefaults) {
  if (await findUnique("items/home_occasions", "seed_key", occasion.seed_key, "id,seed_key", token)) continue;
  await request("/items/home_occasions", "POST", { ...occasion, status: "published" }, token);
  console.log(`Anlass angelegt: ${occasion.seed_key}`);
}

const pageFields = ["seo_title", "seo_description", "hero_eyebrow", "hero_title", "hero_body", "hero_image", "hero_image_alt", "hero_primary_label", "hero_secondary_label", "intro_eyebrow", "intro_title", "intro_body", "intro_link_label", "occasions_eyebrow", "occasions_title"];
const tileFields = ["status", "sort", "destination", "label", "image", "image_alt"];
const occasionFields = ["status", "sort", "title", "description"];
const policySpecs = [
  {
    name: "Website Build", admin: false, app: false,
    grants: [
      { collection: "home_page", action: "read", permissions: {}, fields: ["id", ...pageFields] },
      { collection: "home_tiles", action: "read", permissions: { status: { _eq: "published" } }, fields: ["id", ...tileFields] },
      { collection: "home_occasions", action: "read", permissions: { status: { _eq: "published" } }, fields: ["id", ...occasionFields] },
    ],
  },
  {
    name: "Website Editor", admin: false, app: true,
    grants: [
      { collection: "home_page", action: "read", permissions: {}, fields: ["id", ...pageFields] },
      { collection: "home_page", action: "update", permissions: {}, fields: pageFields },
      { collection: "home_tiles", action: "read", permissions: {}, fields: ["id", ...tileFields] },
      { collection: "home_tiles", action: "update", permissions: {}, fields: tileFields.filter((name) => name !== "destination") },
      { collection: "home_occasions", action: "read", permissions: {}, fields: ["id", "seed_key", ...occasionFields] },
      { collection: "home_occasions", action: "create", permissions: {}, fields: occasionFields },
      { collection: "home_occasions", action: "update", permissions: {}, fields: occasionFields },
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
  const existing = await request(
    listPath("permissions", "policy", policy.id, "id,collection,action,permissions,fields"),
    "GET", undefined, token
  );
  for (const grant of spec.grants) {
    const matches = existing.filter((item) => item.collection === grant.collection && item.action === grant.action);
    if (matches.length > 1) throw new Error(`Doppeltes Recht: ${spec.name} ${grant.collection}/${grant.action}`);
    if (matches.length === 1) {
      const item = matches[0];
      const fields = Array.isArray(item.fields) ? item.fields : String(item.fields || "").split(",");
      if (!same(item.permissions || {}, grant.permissions) || !same(fields.sort(), [...grant.fields].sort())) {
        throw new Error(`Vorhandenes Recht weicht ab: ${spec.name} ${grant.collection}/${grant.action}`);
      }
      continue;
    }
    await request("/permissions", "POST", { policy: policy.id, ...grant }, token);
    console.log(`Recht angelegt: ${spec.name} ${grant.collection}/${grant.action}`);
  }
}

console.log("Startseiten-Collections, Inhalte und Rechte bereit. Die Website bleibt bis zum naechsten Build unveraendert.");
