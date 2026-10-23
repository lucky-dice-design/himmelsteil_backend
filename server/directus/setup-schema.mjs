import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";

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

const email = await prompt("Directus-Admin-E-Mail: ");
const password = await prompt("Directus-Admin-Passwort: ", true);

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
    throw new Error(`${method} ${path}: ${response.status} ${message}`);
  }
  return payload.data;
}

const auth = await request("/auth/login", "POST", { email, password, mode: "json" });
const token = auth.access_token;
if (!token) throw new Error("Anmeldung fehlgeschlagen: kein Access-Token erhalten.");

const statusField = {
  field: "status",
  type: "string",
  meta: {
    interface: "select-dropdown",
    required: true,
    options: {
      choices: [
        { text: "Entwurf", value: "draft" },
        { text: "Veröffentlicht", value: "published" },
      ],
    },
  },
  schema: { default_value: "draft" },
};

const field = (name, type, meta = {}, schema = {}) => ({
  field: name,
  type,
  meta: { interface: type === "text" ? "input-multiline" : "input", ...meta },
  schema,
});

const collections = [
  {
    name: "gallery_items",
    icon: "collections",
    note: "Arbeiten für die Galerie",
    fields: [
      statusField,
      field("sort", "integer", { interface: "input" }),
      field("category", "string", {
        interface: "select-dropdown",
        required: true,
        options: { choices: [
          { text: "Hochzeit", value: "hochzeit" },
          { text: "Event", value: "event" },
          { text: "Kollektion", value: "kollektion" },
        ] },
      }),
      field("title", "string", { required: false, note: "Optionaler Titel unter dem Bild." }),
      field("description", "text", { required: false, note: "Optionale Beschreibung unter dem Bild." }),
      field("image", "uuid", { interface: "file-image", special: ["file"] }),
      field("image_alt", "string", { note: "Bildbeschreibung für Screenreader; bei Bild erforderlich." }),
      field("swatch_class", "string", {
        interface: "select-dropdown",
        note: "Nur für Galerieeinträge ohne Bild.",
        options: { choices: [
          { text: "Botanical", value: "botanical" },
          { text: "Dark", value: "dark" },
          { text: "Clay", value: "clay" },
        ] },
      }),
    ],
  },
  {
    name: "packages",
    icon: "inventory_2",
    note: "Kombinierte Papeterie-Angebote",
    fields: [
      statusField,
      field("sort", "integer"),
      field("kicker", "string"),
      field("title", "string", { required: true }),
      field("description", "text", { required: true }),
      field("features", "json", {
        interface: "input-code",
        note: 'JSON-Liste aus Texten, z. B. ["Einladung", "Menükarte"].',
        options: { language: "json" },
      }),
      field("cta_label", "string", { note: "Beschriftung des Anfrage-Links." }),
      field("featured", "boolean", { interface: "boolean" }, { default_value: false }),
    ],
  },
  {
    name: "posts",
    icon: "article",
    note: "Blogbeiträge",
    fields: [
      statusField,
      field("title", "string", { required: true }),
      field("slug", "string", {
        required: true,
        note: "Eindeutige URL-Kennung: Kleinbuchstaben, Zahlen und Bindestriche.",
      }, { is_unique: true }),
      field("category", "string"),
      field("excerpt", "text", { required: true }),
      field("meta_title", "string"),
      field("meta_description", "text"),
      field("published_at", "date", { interface: "datetime" }),
      field("reading_minutes", "integer"),
      field("sections", "json", {
        interface: "input-code",
        note: "JSON-Array im Format aus directus/MODEL.md.",
        options: { language: "json" },
      }),
    ],
  },
];

const existingCollections = new Set(
  (await request("/collections", "GET", undefined, token)).map(({ collection }) => collection)
);

for (const collection of collections) {
  if (!existingCollections.has(collection.name)) {
    await request("/collections", "POST", {
      collection: collection.name,
      schema: {},
      meta: { icon: collection.icon, note: collection.note },
    }, token);
    console.log(`Collection angelegt: ${collection.name}`);
  } else {
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

  if (collection.name !== "posts") {
    await request(`/collections/${collection.name}`, "PATCH", {
      meta: { sort_field: "sort" },
    }, token);
  }
}

const galleryRelations = await request("/relations/gallery_items", "GET", undefined, token);
if (!galleryRelations.some(({ field: name }) => name === "image")) {
  await request("/relations", "POST", {
    collection: "gallery_items",
    field: "image",
    related_collection: "directus_files",
    meta: { one_deselect_action: "nullify" },
    schema: { on_delete: "SET NULL" },
  }, token);
  console.log("Dateiverknüpfung angelegt: gallery_items.image");
}

console.log("Datenmodell bereit. Noch keine Inhalte oder öffentlichen Berechtigungen angelegt.");
