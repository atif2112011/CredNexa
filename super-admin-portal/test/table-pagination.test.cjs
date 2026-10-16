const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Load the actual TypeScript modules with only Next navigation/backend replaced.
function loadSource(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "../src", relative);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  } }).outputText;
  const module = { exports: {} };
  const load = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) {
      const local = name.slice(2);
      const extension = fs.existsSync(path.resolve(__dirname, "../src", local + ".tsx")) ? ".tsx" : ".ts";
      return loadSource(local + extension, mocks);
    }
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(load, module, module.exports);
  return module.exports;
}

const { tableQuery, tableHref } = loadSource("lib/table-query.ts");

test("page navigation retains filters, search, sort, and row count", () => {
  const current = new URLSearchParams("status=failed&from=2026-08-01&search=old+device&sortBy=createdAt&sortOrder=asc&limit=50&page=1");
  const url = new URL(tableHref("/commands", current, { page: "2" }), "https://example.test");
  assert.equal(url.searchParams.get("page"), "2");
  for (const key of ["status", "from", "search", "sortBy", "sortOrder", "limit"]) assert.equal(url.searchParams.get(key), current.get(key));
});

test("clearing search or changing sort resets page without discarding filters", () => {
  const current = new URLSearchParams("status=LOCKED&page=4&search=old&limit=20");
  const url = new URL(tableHref("/devices", current, { search: undefined, page: "1", sortBy: "imei", sortOrder: "asc" }), "https://example.test");
  assert.equal(url.searchParams.get("status"), "LOCKED");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.has("search"), false);
  assert.equal(url.searchParams.get("sortBy"), "imei");
});

test("risk history tables navigate independently and invalid page sizes fall back safely", () => {
  const current = new URLSearchParams("commands_page=3&audit_page=2&audit_search=LOCK&integrity_sortBy=result");
  const url = new URL(tableHref("/risk-flags/1", current, { page: "4" }, "commands_"), "https://example.test");
  assert.equal(url.searchParams.get("audit_page"), "2");
  assert.equal(url.searchParams.get("commands_page"), "4");
  assert.equal(url.searchParams.get("audit_search"), "LOCK");
  assert.equal(tableQuery({ page: "Infinity", limit: "500" }).page, 1);
  assert.equal(tableQuery({ page: "2.5", limit: "-1" }).limit, 20);
  assert.equal(tableQuery(Object.fromEntries(url.searchParams), "commands_").page, 4);
});

function renderTable(pagination, search = "", rows = 20) {
  const { DataTable } = loadSource("components/data/data-table.tsx", {
    "next/navigation": {
      useRouter: () => ({ push() {} }), usePathname: () => "/devices",
      useSearchParams: () => new URLSearchParams(search)
    }
  });
  return renderToStaticMarkup(React.createElement(DataTable, {
    data: Array.from({ length: rows }, (_, i) => ({ imei: `unique-device-${i}` })),
    columns: [{ accessorKey: "imei", header: "IMEI" }],
    sortFields: { imei: "imei" }, pagination
  }));
}

test("server pages render the complete backend batch and true totals without filtering it again", () => {
  const html = renderTable({ page: 2, limit: 20, total: 110, pages: 6 }, "search=borrower-name");
  assert.equal((html.match(/unique-device-\d+/g) || []).length, 20);
  assert.match(html, /110 records/);
  assert.match(html, /Page 2 of 6/);
  assert.match(html, /type="submit"/);
});

test("empty server pages disable Next and local detail tables keep local pagination", () => {
  const empty = renderTable({ page: 1, limit: 20, total: 0, pages: 0 }, "", 0);
  assert.match(empty, /No records found/);
  assert.match(empty, /Page 1 of 1/);
  assert.match(empty, /disabled=""[^>]*>Next/);
  const local = renderTable(undefined, "", 25);
  assert.equal((local.match(/unique-device-\d+/g) || []).length, 10);
  assert.match(local, /Page 1 of 3/);
});

test("dropdown option loading follows every backend page despite the 100-record cap", async () => {
  const calls = [];
  const { getAllList } = loadSource("services/admin.ts", {
    "@/lib/backend": { backendFetch: async (url, { query }) => {
      calls.push({ url, query });
      const total = 205, start = (query.page - 1) * 100;
      return { items: Array.from({ length: Math.min(100, total - start) }, (_, i) => ({ _id: String(start + i) })), pagination: { page: query.page, limit: 100, total, pages: 3 } };
    } }
  });
  const result = await getAllList("/admin/tenants", { status: "active" });
  assert.equal(result.items.length, 205);
  assert.equal(new Set(result.items.map((row) => row._id)).size, 205);
  assert.deepEqual(calls.map(({ query }) => query.page), [1, 2, 3]);
  assert.ok(calls.every(({ query }) => query.status === "active" && query.limit === 100));
});
