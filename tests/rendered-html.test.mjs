import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const TEST_PASSWORD = "test-only-sensitive-password";
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_LOCAL_VAULT_SECRET = Buffer.alloc(32, 11).toString("base64");
const DEMO_CUSTOMER_ID = "06789e3a-bbe8-4ed4-a7a5-7f395be0a58c";

process.env.SEARCH_DEMO_MODE = "true";
process.env.SEARCH_DEMO_SEED = "true";
process.env.SENSITIVE_VIEW_PASSWORD = TEST_PASSWORD;
process.env.BANK_CARD_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
process.env.SUPABASE_ID_CARD_BUCKET = "id-cards";
process.env.LOCAL_VAULT_UNLOCK_SECRET = TEST_LOCAL_VAULT_SECRET;
process.env.LOCAL_VAULT_ALLOW_UNAUTHENTICATED = "true";

async function getWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function request(path = "/", init = {}) {
  const worker = await getWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      SEARCH_DEMO_MODE: "true",
      SEARCH_DEMO_SEED: "true",
      SENSITIVE_VIEW_PASSWORD: TEST_PASSWORD,
      BANK_CARD_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      SUPABASE_ID_CARD_BUCKET: "id-cards",
      LOCAL_VAULT_UNLOCK_SECRET: TEST_LOCAL_VAULT_SECRET,
      LOCAL_VAULT_ALLOW_UNAUTHENTICATED: "true",
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished sales workspace", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>销客 · 销售工作台<\/title>/);
  assert.match(html, /录入快，找人快/);
  assert.match(html, /搜索姓名、手机号、商户/);
  assert.match(html, /新增客户/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("shop name is collected, persisted, returned, and searched", async () => {
  const [form, createRoute, detailRoute, searchRoute, migration] = await Promise.all([
    readFile(new URL("app/customers/new/NewCustomerClient.tsx", projectRoot), "utf8"),
    readFile(new URL("app/api/customers/route.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/customers/[id]/route.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/search/route.ts", projectRoot), "utf8"),
    readFile(new URL("drizzle/0003_rainy_overlord.sql", projectRoot), "utf8"),
  ]);
  assert.match(form, /店铺名字/);
  assert.match(createRoute, /shopName/);
  assert.match(detailRoute, /shopName/);
  assert.match(searchRoute, /shop_name LIKE/);
  assert.match(migration, /ADD `shop_name` text/);
});

test("machine type, purchase mode, and fee rate flow through customer storage", async () => {
  const [form, machineOptions, createRoute, detailRoute, backupRoute, migration] = await Promise.all([
    readFile(new URL("app/customers/new/NewCustomerClient.tsx", projectRoot), "utf8"),
    readFile(new URL("lib/customers/machine.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/customers/route.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/customers/[id]/route.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/backup/route.ts", projectRoot), "utf8"),
    readFile(new URL("drizzle/0004_silly_stardust.sql", projectRoot), "utf8"),
  ]);
  assert.match(machineOptions, /音响/);
  assert.match(machineOptions, /扫码王/);
  assert.match(machineOptions, /收银机/);
  assert.match(machineOptions, /购买/);
  assert.match(machineOptions, /赠送/);
  assert.match(form, /customer-fee-rate/);
  for (const source of [createRoute, detailRoute, backupRoute]) {
    assert.match(source, /machineType/);
    assert.match(source, /machineMode/);
    assert.match(source, /feeRate/);
  }
  assert.match(migration, /machine_type/);
  assert.match(migration, /machine_mode/);
  assert.match(migration, /fee_rate/);
});

test("plain JSON export visibly includes identity images, license, and machine details", async () => {
  const [settings, customers, backup] = await Promise.all([
    readFile(new URL("app/settings/data/DataSettingsClient.tsx", projectRoot), "utf8"),
    readFile(new URL("app/customers/CustomersClient.tsx", projectRoot), "utf8"),
    readFile(new URL("app/api/backup/route.ts", projectRoot), "utf8"),
  ]);
  assert.match(settings, /身份证正面与反面原始图片/);
  assert.match(settings, /机器类型、购买\/赠送模式和费率/);
  assert.match(settings, /导出未加密资料/);
  assert.match(settings, /普通 JSON/);
  assert.match(customers, /导出全部资料/);
  assert.match(backup, /readImage\(files, row\.id_card_front_key\)/);
  assert.match(backup, /readImage\(files, row\.id_card_back_key\)/);
  assert.match(backup, /readImage\(files, row\.business_license_key\)/);
  assert.match(backup, /application\/json; charset=utf-8/);
});

test("partial phone and fuzzy name searches only expose masked phones", async () => {
  for (const query of ["陈", "陈志", "8888", "1380013"]) {
    const response = await request("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, scope: "all", limit: 20 }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");

    const payload = await response.json();
    assert.ok(payload.items.length > 0, `expected results for ${query}`);
    for (const item of payload.items.filter((value) => value.kind === "customer")) {
      assert.match(item.maskedPhone, /^\d{3}\*{4}\d{4}$/);
      assert.equal("phone" in item, false);
      assert.equal("idCard" in item, false);
    }
  }
});

test("merchant identifiers participate in the unified 20-item search", async () => {
  const response = await request("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: "12345678", scope: "all", limit: 20 }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.items.length <= 20);
  assert.ok(payload.items.some((item) => item.kind === "merchant" && item.merchantNo === "M12345678"));
});

test("database migration keeps search RLS-aware and excludes identity-card content", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/202608090001_sales_workspace_search.sql", projectRoot),
    "utf8",
  );
  const route = await readFile(new URL("app/api/search/route.ts", projectRoot), "utf8");
  const rest = await readFile(new URL("lib/supabase/rest.ts", projectRoot), "utf8");

  assert.match(sql, /security invoker/gi);
  assert.match(sql, /set row_security = 'on'/gi);
  assert.match(sql, /gin_trgm_ops/);
  assert.doesNotMatch(sql, /id_card_(front|back)_url\s+ilike/i);
  assert.match(route, /Cache-Control["']?:\s*["']private, no-store/);
  assert.match(rest, /禁止使用 service role key/);
  assert.doesNotMatch(rest, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,300}Authorization/);
});

test("ordinary customer details never contain full sensitive fields", async () => {
  const response = await request(`/api/customers/${DEMO_CUSTOMER_ID}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.match(payload.customer.maskedPhone, /^\d{3}\*{4}\d{4}$/);
  assert.equal("phone" in payload.customer, false);
  assert.equal("bankCardNumber" in payload.customer, false);
  assert.equal("frontUrl" in payload.customer.idCard, false);
  assert.doesNotMatch(text, /13800138888|4111111111111111/);
});

test("password gate protects phone, identity images, and bank-card actions", async () => {
  const denied = await request(`/api/customers/${DEMO_CUSTOMER_ID}/sensitive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(await denied.text(), /13800138888|4111111111111111/);

  const unlocked = await request(`/api/customers/${DEMO_CUSTOMER_ID}/sensitive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  assert.equal(unlocked.status, 200);
  const unlockedPayload = await unlocked.json();
  assert.equal(typeof unlockedPayload.phone, "string");
  assert.equal(unlockedPayload.phone.length > 0, true);
  assert.equal(unlockedPayload.idCard.frontUrl, null);
  assert.equal(unlockedPayload.idCard.backUrl, null);
  assert.equal(typeof unlockedPayload.bankCardNumber, "string");

  const phoneWithoutPassword = await request(`/api/customers/${DEMO_CUSTOMER_ID}/phone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(phoneWithoutPassword.status, 401);

  const cardUpdate = await request(`/api/customers/${DEMO_CUSTOMER_ID}/bank-card`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: TEST_PASSWORD,
      cardNumber: "4111111111111111",
    }),
  });
  assert.equal(cardUpdate.status, 200);
  assert.deepEqual(await cardUpdate.json(), {
    last4: "1111",
    demoMode: true,
  });
});

test("demo deployment refuses to ingest real multipart identity data", async () => {
  const form = new FormData();
  form.set("name", "测试客户");
  form.set("phone", "13800130000");
  form.set("idCardFront", new File([new Uint8Array([1, 2, 3])], "front.jpg", { type: "image/jpeg" }));
  form.set("idCardBack", new File([new Uint8Array([4, 5, 6])], "back.jpg", { type: "image/jpeg" }));
  form.set("bankCardNumber", "4111111111111111");
  form.set("password", TEST_PASSWORD);

  const response = await request("/api/customers", {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  assert.match(text, /演示环境不会接收真实客户资料/);
  assert.doesNotMatch(text, /13800130000|4111111111111111/);
});

test("sensitive database functions are callable only by the trusted backend role", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/202608090002_customer_sensitive_data.sql", projectRoot),
    "utf8",
  );
  assert.match(
    sql,
    /revoke all on function public\.get_sales_workspace_customer_sensitive\(uuid\) from authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_sales_workspace_customer_sensitive\(uuid\) to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.get_sales_workspace_customer_sensitive\(uuid\) to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.update_sales_workspace_customer_bank_card\([^;]+to authenticated/i,
  );
});

test("local vault unlock material is issued only after password verification", async () => {
  const scopeResponse = await request("/api/local-vault/scope");
  assert.equal(scopeResponse.status, 200);
  const scopePayload = await scopeResponse.json();
  assert.match(scopePayload.userScope, /^[A-Za-z0-9_-]{43}$/);

  const denied = await request("/api/local-vault/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(denied.status, 401);
  assert.doesNotMatch(await denied.text(), new RegExp(TEST_LOCAL_VAULT_SECRET));

  const unlocked = await request("/api/local-vault/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.headers.get("cache-control"), "private, no-store");
  const payload = await unlocked.json();
  assert.match(payload.unlockSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.match(payload.userScope, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(payload.expiresInSeconds, 300);
  assert.notEqual(payload.unlockSecret, TEST_LOCAL_VAULT_SECRET);
  assert.notEqual(payload.userScope, payload.unlockSecret);
  assert.equal(payload.userScope, scopePayload.userScope);
});
