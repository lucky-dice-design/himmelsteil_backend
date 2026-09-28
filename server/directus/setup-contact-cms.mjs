import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const baseUrl = "http://127.0.0.1:8055";
const serviceTokenPath = "/tmp/contact_directus_token";
if (!process.stdin.isTTY) throw new Error("Dieses Skript benoetigt ein interaktives Terminal.");
const serviceToken = fs.readFileSync(serviceTokenPath, "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(serviceToken)) throw new Error("Ungueltiger Contact-Service-Token.");

async function prompt(label, hidden = false) {
  const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const input = createInterface({ input: process.stdin, output, terminal: true });
  if (hidden) process.stdout.write(label);
  try { return await input.question(hidden ? "" : label); }
  finally { input.close(); if (hidden) process.stdout.write("\n"); }
}

async function request(path, method = "GET", body, token) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.errors?.[0]?.message || response.statusText}`);
    return payload.data;
  }
}

function listPath(name, fieldName, value, fields) {
  const query = new URLSearchParams({ [`filter[${fieldName}][_eq]`]: value, fields, limit: "100" });
  return `/${name}?${query}`;
}
async function findUnique(name, fieldName, value, fields, token) {
  const items = await request(listPath(name, fieldName, value, fields), "GET", undefined, token);
  if (items.length > 1) throw new Error(`${name}: ${value} ist nicht eindeutig.`);
  return items[0];
}
const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: type === "text" ? "input-multiline" : "input", ...meta }, schema });
const publishedStatus = field("status", "string", {
  interface: "select-dropdown", required: true,
  options: { choices: [{ text: "Entwurf", value: "draft" }, { text: "Veroeffentlicht", value: "published" }] },
}, { default_value: "draft" });
const imageField = (name) => field(name, "uuid", { interface: "file-image", special: ["file"] });

const formFields = [
  "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_body", "intro_image", "intro_image_alt",
  "contact_eyebrow", "contact_title", "contact_body", "contact_details", "contact_email", "name_label", "email_label",
  "occasion_label", "occasion_placeholder", "timeframe_label", "timeframe_placeholder", "message_label", "consent_label",
  "submit_label", "sending_message", "success_message", "error_message",
];
const formDefaults = {
  seo_title: "Papeterie anfragen | himmelsteil Papeterie Weilheim",
  seo_description: "Individuelle Papeterie fuer Hochzeit, Taufe, Geburtstag oder Business-Event unverbindlich bei himmelsteil Papeterie in Weilheim anfragen.",
  intro_eyebrow: "Deine Anfrage", intro_title: "Lass uns etwas Schoenes gestalten.",
  intro_body: "Erzaehl kurz vom Anlass, der gewuenschten Papeterie und eurem Zeitrahmen. Eine erste Rueckmeldung folgt in der Regel innerhalb weniger Werktage.",
  intro_image_alt: "Individuelle Einladung als Beispiel fuer eine Anfrage",
  contact_eyebrow: "Kontakt", contact_title: "Worum geht es?",
  contact_body: "Schick uns deine Anfrage direkt ueber das Formular. Die Angaben werden ausschliesslich zur Bearbeitung deiner Anfrage verwendet.",
  contact_details: "Anna Dahlenburg\nhimmelsteil Papeterie\nParadeisstr. 7\n82362 Weilheim", contact_email: "info@himmelsteil.de",
  name_label: "Name", email_label: "E-Mail", occasion_label: "Anlass", occasion_placeholder: "Bitte auswaehlen",
  timeframe_label: "Gewuenschter Zeitraum", timeframe_placeholder: "z. B. Juni 2027", message_label: "Nachricht",
  consent_label: "Ich stimme zu, dass meine Angaben zur Bearbeitung der Anfrage verarbeitet werden.", submit_label: "Anfrage senden",
  sending_message: "Anfrage wird gesendet ...", success_message: "Danke! Deine Anfrage wurde gesendet.",
  error_message: "Die Anfrage konnte nicht gesendet werden. Bitte versuche es erneut oder schreibe uns direkt eine E-Mail.",
};
const optionDefaults = ["Hochzeit", "Taufe / Kommunion", "Geburtstag / Event", "Business", "Anderes Projekt"];

const collections = [
  {
    name: "contact_form", icon: "contact_mail", singleton: true, note: "Texte und Beschriftungen des Kontaktformulars",
    fields: formFields.map((name) => name === "intro_image" ? imageField(name) : field(name, ["seo_description", "intro_body", "contact_body", "contact_details", "consent_label", "error_message"].includes(name) ? "text" : "string", { required: name !== "intro_image" })),
  },
  {
    name: "contact_options", icon: "list", singleton: false, note: "Auswahlmoeglichkeiten im Feld Anlass",
    fields: [publishedStatus, field("sort", "integer"), field("seed_key", "string", { hidden: true }, { is_unique: true }), field("label", "string", { required: true })],
  },
  {
    name: "contact_requests", icon: "inbox", singleton: false, note: "Personenbezogene Kontaktanfragen; nicht oeffentlich",
    fields: [
      field("request_id", "string", { hidden: true }, { is_unique: true }),
      field("status", "string", { interface: "select-dropdown", required: true, options: { choices: [
        { text: "Offen", value: "open" }, { text: "In Bearbeitung", value: "in_progress" }, { text: "Erledigt", value: "done" },
      ] } }, { default_value: "open" }),
      field("notification_status", "string", { interface: "select-dropdown", readonly: true, options: { choices: [
        { text: "Ausstehend", value: "pending" }, { text: "Gesendet", value: "sent" }, { text: "Fehlgeschlagen", value: "failed" },
      ] } }, { default_value: "pending" }),
      field("created_at", "timestamp", { readonly: true }), field("consent_at", "timestamp", { readonly: true }),
      field("name", "string", { required: true }), field("email", "string", { required: true }),
      field("occasion", "string", { required: true }), field("timeframe", "string"), field("message", "text", { required: true }),
      field("internal_note", "text", { note: "Nur intern; wird nicht per E-Mail versendet." }),
    ],
  },
];

const adminEmail = await prompt("Directus-Admin-E-Mail: ");
const adminPassword = await prompt("Directus-Admin-Passwort: ", true);
const auth = await request("/auth/login", "POST", { email: adminEmail, password: adminPassword, mode: "json" });
const adminToken = auth.access_token;
if (!adminToken) throw new Error("Admin-Anmeldung fehlgeschlagen.");

const existingCollections = new Set((await request("/collections", "GET", undefined, adminToken)).map((item) => item.collection));
for (const collection of collections) {
  if (!existingCollections.has(collection.name)) {
    await request("/collections", "POST", { collection: collection.name, schema: {}, meta: { icon: collection.icon, note: collection.note, singleton: collection.singleton } }, adminToken);
    console.log(`Collection angelegt: ${collection.name}`);
  }
  const existingFields = new Set((await request(`/fields/${collection.name}`, "GET", undefined, adminToken)).map((item) => item.field));
  for (const definition of collection.fields) {
    if (!existingFields.has(definition.field)) await request(`/fields/${collection.name}`, "POST", definition, adminToken);
  }
  if (collection.name === "contact_options") await request(`/collections/${collection.name}`, "PATCH", { meta: { sort_field: "sort" } }, adminToken);
}

const relations = await request("/relations/contact_form", "GET", undefined, adminToken);
if (!relations.some((item) => item.field === "intro_image")) {
  await request("/relations", "POST", { collection: "contact_form", field: "intro_image", related_collection: "directus_files", meta: { one_deselect_action: "nullify" }, schema: { on_delete: "SET NULL" } }, adminToken);
}
const singletonResponse = await fetch(`${baseUrl}/items/contact_form?fields=id`, { headers: { Authorization: `Bearer ${adminToken}` } });
const singleton = singletonResponse.ok ? (await singletonResponse.json()).data : null;
if (!singleton?.id) await request("/items/contact_form", "PATCH", formDefaults, adminToken);
for (let index = 0; index < optionDefaults.length; index++) {
  const seedKey = `option-${index + 1}`;
  if (!await findUnique("items/contact_options", "seed_key", seedKey, "id,seed_key", adminToken)) {
    await request("/items/contact_options", "POST", { status: "published", sort: index + 1, seed_key: seedKey, label: optionDefaults[index] }, adminToken);
  }
}

async function ensurePolicy(name, appAccess, icon, description) {
  const policy = await findUnique("policies", "name", name, "id,name,admin_access,app_access", adminToken);
  if (!policy || policy.admin_access || Boolean(policy.app_access) !== appAccess) throw new Error(`Policy ${name} fehlt oder ist unerwartet konfiguriert.`);
  return policy;
}
async function ensureGrant(policy, grant) {
  const existing = await request(listPath("permissions", "policy", policy.id, "id,collection,action"), "GET", undefined, adminToken);
  const current = existing.find((item) => item.collection === grant.collection && item.action === grant.action);
  if (current) {
    await request(`/permissions/${current.id}`, "PATCH", { policy: policy.id, ...grant }, adminToken);
    return;
  }
  await request("/permissions", "POST", { policy: policy.id, ...grant }, adminToken);
  console.log(`Recht angelegt: ${policy.name} ${grant.collection}/${grant.action}`);
}

const buildPolicy = await ensurePolicy("Website Build", false);
await ensureGrant(buildPolicy, { collection: "contact_form", action: "read", permissions: null, fields: ["id", ...formFields] });
await ensureGrant(buildPolicy, { collection: "contact_options", action: "read", permissions: { status: { _eq: "published" } }, fields: ["id", "status", "sort", "label"] });

const editorPolicy = await ensurePolicy("Website Editor", true);
for (const grant of [
  { collection: "contact_form", action: "read", permissions: null, fields: ["id", ...formFields] },
  { collection: "contact_form", action: "update", permissions: null, fields: formFields },
  { collection: "contact_options", action: "read", permissions: null, fields: ["id", "status", "sort", "label"] },
  { collection: "contact_options", action: "create", permissions: null, fields: ["status", "sort", "label"] },
  { collection: "contact_options", action: "update", permissions: null, fields: ["status", "sort", "label"] },
  { collection: "contact_requests", action: "read", permissions: null, fields: ["id", "request_id", "status", "notification_status", "created_at", "consent_at", "name", "email", "occasion", "timeframe", "message", "internal_note"] },
  { collection: "contact_requests", action: "update", permissions: null, fields: ["status", "internal_note"] },
]) await ensureGrant(editorPolicy, grant);

const roleName = "Website Contact Service";
let serviceRole = await findUnique("roles", "name", roleName, "id,name,parent", adminToken);
if (!serviceRole) serviceRole = await request("/roles", "POST", { name: roleName, icon: "send", description: "Technischer Schreibzugriff fuer Kontaktanfragen" }, adminToken);
let servicePolicy = await findUnique("policies", "name", roleName, "id,name,admin_access,app_access", adminToken);
if (!servicePolicy) servicePolicy = await request("/policies", "POST", { name: roleName, icon: "send", description: "Nur Anfragen anlegen und Benachrichtigungsstatus setzen", admin_access: false, app_access: false, roles: [{ role: serviceRole.id }] }, adminToken);
if (servicePolicy.admin_access || servicePolicy.app_access) throw new Error("Contact-Service-Policy ist zu weitreichend.");
const linked = await request(`/policies/${servicePolicy.id}?fields=roles.role`, "GET", undefined, adminToken);
if (!(linked.roles || []).some((entry) => (typeof entry === "string" ? entry : entry.role) === serviceRole.id)) {
  await request(`/policies/${servicePolicy.id}`, "PATCH", { roles: { create: [{ role: serviceRole.id }] } }, adminToken);
}
await ensureGrant(servicePolicy, { collection: "contact_requests", action: "create", permissions: null, fields: ["request_id", "status", "notification_status", "created_at", "consent_at", "name", "email", "occasion", "timeframe", "message"] });
await ensureGrant(servicePolicy, { collection: "contact_requests", action: "read", permissions: null, fields: ["id", "notification_status"] });
await ensureGrant(servicePolicy, { collection: "contact_requests", action: "update", permissions: null, fields: ["notification_status"] });

const serviceEmail = "website-contact@himmelsteil.de";
let serviceUser = await findUnique("users", "email", serviceEmail, "id,email,role,status,token", adminToken);
if (!serviceUser) {
  serviceUser = await request("/users", "POST", { email: serviceEmail, first_name: "Website", last_name: "Contact", status: "active", role: serviceRole.id, password: randomBytes(48).toString("hex"), token: serviceToken }, adminToken);
} else if (serviceUser.token !== serviceToken || serviceUser.role !== serviceRole.id || serviceUser.status !== "active") {
  await request(`/users/${serviceUser.id}`, "PATCH", { token: serviceToken, role: serviceRole.id, status: "active" }, adminToken);
}

const serviceDetails = await request(`/users/${serviceUser.id}?fields=policies.policy`, "GET", undefined, adminToken);
if (!(serviceDetails.policies || []).some((entry) => (typeof entry === "string" ? entry : entry.policy) === servicePolicy.id)) {
  await request(`/users/${serviceUser.id}`, "PATCH", { policies: { create: [{ policy: servicePolicy.id }] } }, adminToken);
}

const effectiveResponse = await fetch(`${baseUrl}/permissions/me`, { headers: { Authorization: `Bearer ${serviceToken}` } });
const effectivePayload = await effectiveResponse.json().catch(() => ({}));
if (!effectiveResponse.ok || effectivePayload.data?.contact_requests?.create?.access === "none" || !effectivePayload.data?.contact_requests?.create) {
  throw new Error("Contact-Service hat nach der Einrichtung kein wirksames Anlegerecht.");
}

fs.unlinkSync(serviceTokenPath);
console.log("Kontaktformular, Anfrageverwaltung und eingeschraenkte Rechte sind bereit.");
