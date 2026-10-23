import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWebsiteFeatures, lists, singletons, siteDefaults } from "./setup-website-features.mjs";

function fixture() {
  const collections = [...lists, "home_page", "contact_form"].map((collection) => ({ collection, schema: {}, meta: {} }));
  const policies = [{ id: "build", name: "Website Build", app_access: false }, { id: "editor", name: "Website Editor", app_access: true }];
  const grants = [];
  for (const collection of [...lists, "home_page", "contact_form"]) {
    for (const [policy, actions] of [["build", ["read"]], ["editor", ["read", "update", ...(["home_tiles", "legal_pages", "home_page", "contact_form"].includes(collection) ? [] : ["create"])]]]) {
      for (const action of actions) grants.push({ id: `grant-${grants.length}`, policy, collection, action, fields: ["id", "title"], validation: { retained: true }, permissions: policy === "build" && lists.includes(collection) ? { status: { _eq: "published" } } : null });
    }
  }
  const fields = new Map(collections.map((item) => [item.collection, [{ field: "id" }, ...(!singletons.includes(item.collection) ? [{ field: "status" }] : [])]]));
  const items = Object.fromEntries(collections.map((item) => [item.collection, [{ id: 1, status: "published", title: "Existing content" }]]));
  let settings = null;
  const relations = [];
  const calls = [];
  const request = async (input, method = "GET", body) => {
    calls.push({ input, method, body: structuredClone(body) });
    const url = new URL(input, "http://fixture");
    const [resource, name, key] = url.pathname.split("/").slice(1);
    if (resource === "policies") return structuredClone(policies);
    if (resource === "folders") return [{ id: "website-folder", name: "Website" }];
    if (resource === "relations") {
      if (method === "GET") return structuredClone(relations);
      assert.equal(method, "POST");
      relations.push(structuredClone(body));
      return;
    }
    if (resource === "collections") {
      if (method === "GET") return structuredClone(collections);
      if (method === "POST") {
        collections.push(structuredClone(body));
        fields.set(body.collection, [{ field: "id" }]);
      } else Object.assign(collections.find((item) => item.collection === name).meta, body.meta);
      return;
    }
    if (resource === "fields") {
      if (method === "GET") return structuredClone(fields.get(name));
      if (method === "POST") fields.get(name).push(structuredClone(body));
      else Object.assign(fields.get(name).find((item) => item.field === key), structuredClone(body));
      return;
    }
    if (resource === "permissions") {
      if (method === "GET") return structuredClone(grants.filter((item) => ["policy", "collection", "action"].every((field) => item[field] === url.searchParams.get(`filter[${field}][_eq]`))));
      if (method === "POST") grants.push({ id: `grant-${grants.length}`, ...structuredClone(body) });
      else Object.assign(grants.find((item) => item.id === name), structuredClone(body));
      return;
    }
    if (resource === "items") {
      if (name === "site_settings") {
        if (method === "GET") return settings;
        settings = { id: 1, ...settings, ...structuredClone(body) };
        return;
      }
      assert.equal(method, "PATCH");
      assert.deepEqual(body.query, { filter: { status: { _eq: "published" } } });
      for (const item of items[name]) if (item.status === "published") item.status = body.data.status;
      return;
    }
    throw new Error(`Unexpected request ${input}`);
  };
  return { request, grants, fields, items, calls, relations, settings: () => settings };
}

test("migrates publication status, adds optional credits and extends only website grants", async () => {
  const state = fixture();
  await applyWebsiteFeatures(state.request);
  assert.equal(state.settings().brand_name, siteDefaults.brand_name);
  assert.equal(state.fields.get("site_settings").find((item) => item.field === "logo").meta.options.folder, "website-folder");
  assert.deepEqual(state.relations.map((item) => [item.field, item.related_collection, item.schema.on_delete]), [["logo", "directus_files", "SET NULL"]]);
  for (const grant of state.grants.filter((item) => item.collection === "site_settings")) {
    for (const field of ["logo", "logo_alt", "show_footer_logo", "gallery_filters"]) assert.ok(grant.fields.includes(field));
  }
  for (const name of lists) assert.equal(state.items[name][0].status, "live");
  for (const name of [...lists, ...singletons]) {
    const status = state.fields.get(name).find((item) => item.field === "status");
    assert.deepEqual(status.meta.options.choices.filter((item) => item.value !== "draft").map((item) => item.value), ["preview", "live"]);
    const read = state.grants.find((item) => item.policy === "build" && item.collection === name && item.action === "read");
    assert.ok(read.fields.includes("status"));
    if (lists.includes(name)) assert.deepEqual(read.permissions, { status: { _in: ["live", "preview", "published"] } });
  }
  const credit = state.fields.get("gallery_items").find((item) => item.field === "show_image_copyright");
  assert.equal(credit.schema.default_value, false);
  for (const grant of state.grants.filter((item) => item.collection !== "site_settings")) {
    assert.deepEqual(grant.validation, { retained: true });
    assert.ok(grant.fields.includes("title"));
  }
  assert.ok(!state.grants.some((item) => item.collection === "contact_requests"));
  // A second installation preserves editorial changes and does not duplicate fields/grants.
  state.settings().brand_name = "Editorial change";
  state.settings().logo = "existing-logo";
  const grantCount = state.grants.length;
  const fieldCounts = [...state.fields].map(([name, value]) => [name, value.length]);
  await applyWebsiteFeatures(state.request);
  assert.equal(state.settings().brand_name, "Editorial change");
  assert.equal(state.settings().logo, "existing-logo");
  assert.equal(state.relations.length, 1);
  assert.equal(state.grants.length, grantCount);
  assert.deepEqual([...state.fields].map(([name, value]) => [name, value.length]), fieldCounts);
});

test("rejects an unexpected admin policy before any schema writes", async () => {
  const state = fixture();
  const request = async (...args) => args[0].startsWith("/policies") ? [{ name: "Website Build", admin_access: true }] : state.request(...args);
  await assert.rejects(applyWebsiteFeatures(request), /unerwartete Rechte/);
  assert.equal(state.calls.length, 0);
});

test("adds gallery filter defaults to an existing site without overwriting settings or disabled filters", async () => {
  const state = fixture();
  await applyWebsiteFeatures(state.request);
  state.settings().brand_name = "Bestehende Marke";
  delete state.settings().gallery_filters;
  await applyWebsiteFeatures(state.request);
  assert.equal(state.settings().brand_name, "Bestehende Marke");
  assert.deepEqual(state.settings().gallery_filters, siteDefaults.gallery_filters);
  state.settings().gallery_filters = [{ category: "event", label: "Feiern", enabled: false }];
  await applyWebsiteFeatures(state.request);
  assert.deepEqual(state.settings().gallery_filters, [{ category: "event", label: "Feiern", enabled: false }]);
  state.settings().gallery_filters = [];
  await applyWebsiteFeatures(state.request);
  assert.deepEqual(state.settings().gallery_filters, []);
});
