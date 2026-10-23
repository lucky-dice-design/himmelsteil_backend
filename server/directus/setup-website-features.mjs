import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyCollectionNavigation, rateLimitDelay } from "./setup-collection-navigation.mjs";

export const pageDefaults = {
  gallery_page: {
    gallery_filters: [
      { category: "all", label: "Alle", enabled: true }, { category: "hochzeit", label: "Hochzeit", enabled: true },
      { category: "event", label: "Event", enabled: true }, { category: "kollektion", label: "Kollektion", enabled: true },
    ],
    seo_title: "Papeterie-Galerie für Hochzeit & Event | himmelsteil",
    seo_description: "Entdecke individuelle Einladungen, Tagespapeterie, Menükarten und Papeterie-Kollektionen für Hochzeit und Event.",
    intro_eyebrow: "Ausgewählte Arbeiten", intro_title: "Galerie",
    intro_body: "Feine Details, ruhige Farben und durchdachte Kombinationen. Nutze die Filter, um passende Arbeiten für deinen Anlass zu entdecken.",
    intro_image: null, intro_image_alt: "Nahaufnahme einer Papeterie mit Wachssiegel",
    show_intro_image: true,
    section_eyebrow: "Papeterie", section_title: "Arbeiten zum Stöbern", section_body: "",
    filter_label: "Galerie filtern", results_message: "{count} Arbeiten werden angezeigt.",
  },
  packages_page: {
    seo_title: "Papeterie-Pakete für Hochzeit & Feier | himmelsteil",
    seo_description: "Flexible Papeterie-Pakete für Einladung, Hochzeitstag und ein durchgängiges Gestaltungskonzept vom ersten Umschlag bis zur Dankeskarte.",
    intro_eyebrow: "Passend kombiniert", intro_title: "Pakete",
    intro_body: "Ein klarer Ausgangspunkt für typische Wünsche. Umfang, Papier und Stückzahl werden anschließend persönlich auf euer Fest abgestimmt.",
    intro_image: null, intro_image_alt: "Einladungsset auf dunklem Untergrund", show_intro_image: true,
    section_eyebrow: "Drei Möglichkeiten", section_title: "So viel Papeterie, wie ihr braucht.",
    section_body: "Die Pakete geben Orientierung und bleiben flexibel. Preise entstehen nach Papier, Veredelung, Stückzahl und gewünschter Individualisierung.",
    show_details: true, details_eyebrow: "Gut zu wissen", details_title: "Individuell bleibt individuell.",
    details_body: "Ein Paket ist kein starres Produkt. Einzelne Bestandteile können ergänzt, weggelassen oder für Taufe, Kommunion, Geburtstag und Business-Events neu zusammengestellt werden.",
    details_cta_label: "Unverbindlich anfragen", details_cta_href: "/kontakt",
  },
  blog_page: {
    seo_title: "Papeterie-Blog: Hochzeit, Planung & Gestaltung | himmelsteil",
    seo_description: "Praktische Planungshilfen und Inspiration rund um Hochzeitspapeterie, Budgets, Farben und Papeterie für besondere Anlässe.",
    intro_eyebrow: "Inspiration & Planung", intro_title: "Blog",
    intro_body: "Gedanken zu Papier, Gestaltung und den vielen kleinen Entscheidungen, die aus einer Feier ein stimmiges Ganzes machen.",
    intro_image: null, intro_image_alt: "Papeterie und Wachssiegel in sanften Farbtönen", show_intro_image: true,
    section_eyebrow: "Notizen aus dem Atelier", section_title: "Neu im Blog", section_body: "",
    read_label: "Artikel lesen", breadcrumb_label: "Brotkrümelnavigation", home_label: "Start",
    author_prefix: "Von", reading_suffix: "Minuten Lesezeit",
    packages_cta_label: "Pakete ansehen", contact_cta_label: "Projekt anfragen",
  },
};

export const extraDefaults = {
  home_page: { tiles_label: "Websitebereiche" },
  contact_form: {
    privacy_intro: "Weitere Informationen stehen im", privacy_link_label: "Datenschutz",
    noscript_message: "Für das Formular ist JavaScript erforderlich. Alternativ erreichst du uns unter",
    timeout_message: "Der Versand dauert zu lange. Bitte versuche es erneut oder schreibe uns direkt eine E-Mail.",
  },
};

export const siteDefaults = {
  menu_close_label: "Menü schließen", owner_name: "Anna Dahlenburg",
  business_description: "Individuelle Papeterie für Hochzeiten, Taufen, Geburtstage und besondere Events.",
  street_address: "Paradeisstr. 7", postal_code: "82362", city: "Weilheim", country: "DE",
  legal_eyebrow: "Rechtliches", unpublished_message: "Dieser Inhalt ist derzeit nicht veröffentlicht.",
  default_package_cta: "Paket anfragen",
  gallery_filters: [
    { category: "all", label: "Alle", enabled: true },
    { category: "hochzeit", label: "Hochzeit", enabled: true },
    { category: "event", label: "Event", enabled: true },
    { category: "kollektion", label: "Kollektion", enabled: true },
  ],
  logo: null, logo_alt: "himmelsteil Papeterie", show_footer_logo: false,
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
export const singletons = ["home_page", "contact_form", "site_settings", ...Object.keys(pageDefaults)];
const imageFields = { gallery_items: "image", home_tiles: "image", home_page: "hero_image", contact_form: "intro_image", ...Object.fromEntries(Object.keys(pageDefaults).map((name) => [name, "intro_image"])) };
const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: "input", ...meta }, schema });
const settingsFields = Object.keys(siteDefaults).filter((name) => !["logo", "logo_alt", "show_footer_logo", "gallery_filters"].includes(name)).map((name) => name.endsWith("_links")
  ? field(name, "json", { interface: "list", special: ["cast-json"], required: true, note: "Beschriftung, interner Link und Reihenfolge bearbeiten.", options: { fields: [
    { field: "label", name: "Beschriftung", type: "string", meta: { interface: "input", required: true } },
    { field: "href", name: "Linkziel", type: "string", meta: { interface: "input", required: true, note: "Interner Pfad, z. B. /kontakt" } },
  ] } })
  : field(name, "string", { required: true, translations: [{ language: "de-DE", translation: ({ menu_close_label: "Menü schließen: Beschriftung", owner_name: "Betreiber / Autor", business_description: "Betriebsbeschreibung für Suchmaschinen", street_address: "Straße und Hausnummer", postal_code: "Postleitzahl", city: "Ort", country: "Ländercode", legal_eyebrow: "Rechtstexte: Dachzeile", unpublished_message: "Hinweis bei unveröffentlichtem Inhalt", default_package_cta: "Standard-Linktext für Pakete", brand_name: "Markenname", brand_home_label: "Logo-Link: Beschreibung", menu_label: "Menü öffnen: Beschriftung", nav_label: "Navigation: Beschreibung", footer_text: "Footer-Text" })[name] || name }] }));
const galleryFilterField = field("gallery_filters", "json", {
    interface: "list", special: ["cast-json"],
    translations: [{ language: "de-DE", translation: "Galerie-Filter" }],
    note: "Beschriftung, Reihenfolge und Sichtbarkeit der Filter. Deaktivieren blendet nur den Button aus, nicht die Arbeiten. Eine leere Liste blendet die Filterleiste aus. Kategorien entsprechen den Galerieeinträgen.",
    options: { fields: [
      { field: "category", name: "Kategorie", type: "string", meta: { interface: "select-dropdown", required: true, options: { choices: siteDefaults.gallery_filters.map(({ category, label }) => ({ text: label, value: category })) } } },
      { field: "label", name: "Beschriftung", type: "string", meta: { interface: "input", required: true } },
      { field: "enabled", name: "Filter anzeigen", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean", special: ["cast-boolean"] } },
    ] },
  });
settingsFields.push(
  field("logo", "uuid", { interface: "file-image", special: ["file"], note: "Eigenes Logo auswählen oder hochladen. Ohne Datei erscheint das bisherige Logo.", translations: [{ language: "de-DE", translation: "Logo" }] }),
  field("logo_alt", "string", { note: "Bildbeschreibung; ohne Angabe wird der Markenname verwendet.", translations: [{ language: "de-DE", translation: "Logo-Beschreibung" }] }),
  field("show_footer_logo", "boolean", { interface: "boolean", special: ["cast-boolean"], translations: [{ language: "de-DE", translation: "Logo auch im Footer anzeigen" }] }, { default_value: false }),
);

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
  if (!current && collection !== "site_settings" && !Object.hasOwn(pageDefaults, collection)) throw new Error(`${policy.name}: Recht fehlt fuer ${collection}/${action}`);
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
  const folders = await request(`/folders?${new URLSearchParams({ "filter[name][_eq]": "Website", fields: "id,name", limit: "2" })}`);
  if (folders.length !== 1) throw new Error("Der Dateiordner Website fehlt oder ist nicht eindeutig.");
  const collections = new Set((await request("/collections")).map((item) => item.collection));
  for (const name of [...lists, "home_page", "contact_form"]) {
    if (!collections.has(name)) throw new Error(`Zuerst Basismodul einrichten: ${name}`);
  }
  if (!collections.has("site_settings")) {
    await request("/collections", "POST", { collection: "site_settings", schema: {}, meta: { singleton: true, icon: "web", note: "Gemeinsamer Header und Footer aller Seiten" } });
  }
  for (const name of Object.keys(pageDefaults)) {
    if (!collections.has(name)) {
      await request("/collections", "POST", { collection: name, schema: {}, meta: { singleton: true, icon: "web", note: "Seitenkopf, Texte, Bild und SEO; Listeninhalte werden separat gepflegt." }, fields: [field("id", "integer", { hidden: true, readonly: true }, { is_primary_key: true, has_auto_increment: true })] });
    }
  }
  for (const name of [...lists, ...singletons]) {
    const existing = new Set((await request(`/fields/${name}`)).map((item) => item.field));
    const definitions = [statusDefinition(singletons.includes(name))];
    const defaults = pageDefaults[name] || extraDefaults[name];
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        if (key === "gallery_filters") { definitions.push(galleryFilterField); continue; }
        const label = ({ seo_title: "SEO-Titel", seo_description: "SEO-Beschreibung", intro_eyebrow: "Einleitung: Dachzeile", intro_title: "Einleitung: Überschrift", intro_body: "Einleitung: Text", intro_image: "Einleitung: Bild", intro_image_alt: "Einleitung: Bildbeschreibung", show_intro_image: "Einleitungsbild anzeigen", section_eyebrow: "Inhalt: Dachzeile", section_title: "Inhalt: Überschrift", section_body: "Inhalt: Text", show_details: "Zusatzabschnitt anzeigen", details_eyebrow: "Zusatz: Dachzeile", details_title: "Zusatz: Überschrift", details_body: "Zusatz: Text", details_cta_label: "Zusatz: Buttontext", details_cta_href: "Zusatz: Buttonziel", filter_label: "Filter: zugängliche Beschriftung", results_message: "Ergebnistext mit {count}", read_label: "Artikel-Linktext", breadcrumb_label: "Brotkrümel: zugängliche Beschriftung", home_label: "Brotkrümel: Startseite", author_prefix: "Autor: Einleitung", reading_suffix: "Lesezeit: Einheit", packages_cta_label: "Artikel: Pakete-Button", contact_cta_label: "Artikel: Kontakt-Button", tiles_label: "Themenkacheln: zugängliche Beschriftung", privacy_intro: "Datenschutzhinweis", privacy_link_label: "Datenschutz-Linktext", noscript_message: "Hinweis ohne JavaScript" })[key] || key;
        const meta = { translations: [{ language: "de-DE", translation: label }] };
        if (key === "intro_image") definitions.push(field(key, "uuid", { ...meta, interface: "file-image", special: ["file"], options: { folder: folders[0].id } }));
        else if (typeof value === "boolean") definitions.push(field(key, "boolean", { ...meta, interface: "boolean", special: ["cast-boolean"] }, { default_value: value }));
        else definitions.push(field(key, key.endsWith("_body") || key.endsWith("_message") ? "text" : "string", { ...meta, interface: key.endsWith("_body") || key.endsWith("_message") ? "input-multiline" : "input", note: key.endsWith("_href") ? "Interner Pfad, z. B. /kontakt" : undefined }));
      }
    }
    if (name === "site_settings") definitions.push(...settingsFields.map((definition) => definition.field === "logo"
      ? { ...definition, meta: { ...definition.meta, options: { folder: folders[0].id } } }
      : definition));
    if (name === "site_settings") definitions.push({ ...galleryFilterField, meta: { ...galleryFilterField.meta, hidden: true, readonly: true } });
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
    const additions = ["status", ...(name === "site_settings" ? Object.keys(siteDefaults) : Object.keys(defaults || {})),
      ...(imageFields[name] ? [`${imageFields[name]}_copyright`, `show_${imageFields[name]}_copyright`] : [])];
    await extendGrant(request, build, name, "read", ["id", ...additions], lists.includes(name) ? { status: { _in: ["live", "preview", "published"] } } : null);
    await extendGrant(request, editor, name, "read", ["id", ...additions]);
    await extendGrant(request, editor, name, "update", additions);
    if (["gallery_items", "packages", "posts", "home_occasions", "legal_sections", "contact_options"].includes(name)) {
      await extendGrant(request, editor, name, "create", additions);
    }
  }
  for (const name of Object.keys(pageDefaults)) {
    const relations = await request(`/relations/${name}`);
    if (!relations.some((item) => item.field === "intro_image")) {
      await request("/relations", "POST", { collection: name, field: "intro_image", related_collection: "directus_files", meta: { one_deselect_action: "nullify" }, schema: { on_delete: "SET NULL" } });
    }
  }
  const relations = await request("/relations/site_settings");
  if (!relations.some((item) => item.field === "logo")) {
    await request("/relations", "POST", { collection: "site_settings", field: "logo", related_collection: "directus_files", meta: { one_deselect_action: "nullify" }, schema: { on_delete: "SET NULL" } });
  }
  // Read legacy filters before hiding their old editor field. Preserve empty and disabled lists.
  const legacySettings = await request("/items/site_settings?fields=id,status,gallery_filters");
  for (const key of ["title", "description"]) {
    await request(`/fields/gallery_items/${key}`, "PATCH", { meta: { required: false, note: "Optional. Ohne Titel/Beschreibung wird nur das Galerie-Motiv angezeigt." }, schema: { is_nullable: true } });
  }
  for (const [name, defaults] of Object.entries({ site_settings: siteDefaults, ...pageDefaults, ...extraDefaults })) {
    const item = await request(`/items/${name}?fields=id,${Object.keys(defaults).join(",")}`);
    if (!item?.id && !extraDefaults[name]) {
      const seed = { status: "live", ...defaults };
      if (name === "gallery_page" && legacySettings?.gallery_filters != null) {
        seed.gallery_filters = legacySettings.gallery_filters;
        seed.status = legacySettings.status === "preview" ? "preview" : "live";
      }
      await request(`/items/${name}`, "PATCH", seed);
    }
    else {
      const missing = Object.fromEntries(Object.entries(defaults).filter(([key, value]) => item?.[key] == null && value != null));
      if (Object.keys(missing).length) await request(`/items/${name}`, "PATCH", missing);
    }
  }
  await request("/fields/site_settings/gallery_filters", "PATCH", { meta: { hidden: true, readonly: true, note: "Galerie-Filter werden jetzt unter Galerie → Galerie-Seite gepflegt. Legacy-Feld für ältere Frontend-Versionen." } });
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
