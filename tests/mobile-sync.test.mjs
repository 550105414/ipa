import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  MOBILE_SYNC_MAX_CIPHERTEXT_BYTES,
  MOBILE_SYNC_MAX_REQUEST_BYTES,
  createMobileSyncHandlers,
  mobileSyncScope,
  validateMobileSyncEnvelope,
} from "../lib/security/mobile-sync.ts";

const migration = await readFile(new URL("../drizzle/0008_silly_jimmy_woo.sql", import.meta.url), "utf8");
const envelope = (overrides = {}) => ({
  version: 1,
  kdf: "pbkdf2-sha256",
  iterations: 310000,
  salt: Buffer.alloc(16, 0x41).toString("base64"),
  nonce: Buffer.alloc(12, 0x42).toString("base64"),
  ciphertext: Buffer.alloc(48, 0x43).toString("base64"),
  ...overrides,
});
const url = "https://workspace.example/api/mobile-sync";
const request = (owner, method = "GET", body, extraHeaders = {}) => new Request(url, {
  method,
  headers: { ...(owner ? { "test-owner": owner } : {}), "content-type": "application/json", ...extraHeaders },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function harness() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const statements = [];
  let databaseRequests = 0;
  const db = {
    prepare(sql) {
      statements.push(sql);
      return { bind(...values) {
        return { async first() { return sqlite.prepare(sql).get(...values) ?? null; } };
      } };
    },
  };
  const handlers = createMobileSyncHandlers({
    userId: async (req) => req.headers.get("test-owner"),
    database: async () => { databaseRequests++; return db; },
    respond(body, status = 200, headers = {}) {
      return Response.json(body, { status, headers: {
        "Cache-Control": "private, no-store",
        "Vary": "Authorization, Cookie, X-Workspace-Device-Token, OAI-Sites-Authorization",
        ...headers,
      } });
    },
  });
  return { ...handlers, sqlite, statements, get databaseRequests() { return databaseRequests; } };
}

test("mobile-sync authenticates GET and PUT before opening the database or consuming a body", async () => {
  const app = harness();
  assert.equal((await app.GET(request(null))).status, 401);
  assert.equal((await app.PUT(request(null, "PUT", { expectedRevision: 0, envelope: envelope() }))).status, 401);
  assert.equal(app.databaseRequests, 0);
  assert.equal(app.statements.length, 0);
});

test("mobile-sync returns revision zero for a new owner and derives stable owner-only scopes", async () => {
  const app = harness();
  const response = await app.GET(request("owner-a"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    scope: createHash("sha256").update("cardworkbench-mobile-sync|owner-a", "utf8").digest("hex"),
    revision: 0, envelope: null, updatedAt: null,
  });
  assert.equal(body.scope, await mobileSyncScope("owner-a"));
  assert.notEqual(body.scope, await mobileSyncScope("owner-b"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("mobile-sync writes only encrypted envelope JSON and isolates owners", async () => {
  const app = harness();
  const input = envelope();
  const write = await app.PUT(request("owner-a", "PUT", { expectedRevision: 0, envelope: input }));
  assert.equal(write.status, 200);
  const written = await write.json();
  assert.equal(written.revision, 1);
  assert.equal(Number.isFinite(Date.parse(written.updatedAt)), true);
  assert.equal(app.statements.length, 1);
  const a = await (await app.GET(request("owner-a"))).json();
  assert.equal(a.revision, 1);
  assert.deepEqual(a.envelope, input);
  const b = await (await app.GET(request("owner-b"))).json();
  assert.equal(b.revision, 0);
  assert.equal(b.envelope, null);
  assert.equal(app.sqlite.prepare("SELECT count(*) AS n FROM mobile_sync_vaults").get().n, 1);
  const row = app.sqlite.prepare("SELECT * FROM mobile_sync_vaults").get();
  assert.deepEqual(Object.keys(row), ["owner_id", "revision", "envelope_json", "updated_at"]);
  assert.equal(row.envelope_json, JSON.stringify(input));
});

test("mobile-sync SQLite CAS rejects stale writers, including first creation races", async () => {
  const app = harness();
  const writes = await Promise.all([
    app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope() })),
    app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope({ nonce: Buffer.alloc(12, 0x44).toString("base64") }) })),
  ]);
  assert.deepEqual(writes.map((response) => response.status).sort(), [200, 409]);
  const updates = await Promise.all([
    app.PUT(request("owner", "PUT", { expectedRevision: 1, envelope: envelope() })),
    app.PUT(request("owner", "PUT", { expectedRevision: 1, envelope: envelope() })),
  ]);
  assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await (await app.GET(request("owner"))).json()).revision, 2);
  assert.equal((await app.PUT(request("missing", "PUT", { expectedRevision: 9, envelope: envelope() }))).status, 409);
  assert.equal((await (await app.GET(request("missing"))).json()).revision, 0);
});

test("mobile-sync ignores neither owner spoofing nor accidental plaintext: unknown top-level fields are rejected", async () => {
  const app = harness();
  for (const extra of [{ ownerId: "victim" }, { scope: "forged" }, { password: "plaintext" }, { records: [] }]) {
    assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope(), ...extra }))).status, 400);
  }
  assert.equal(app.databaseRequests, 0);
});

test("mobile-sync accepts only fixed algorithms, canonical base64, proper nonce/salt/tag sizes and exact envelope fields", async () => {
  const invalid = [
    null, [], {}, envelope({ version: 2 }), envelope({ kdf: "argon2" }), envelope({ iterations: 1 }),
    envelope({ salt: Buffer.alloc(15).toString("base64") }), envelope({ nonce: Buffer.alloc(11).toString("base64") }),
    envelope({ ciphertext: Buffer.alloc(15).toString("base64") }), envelope({ ciphertext: "bad!!" }),
    envelope({ salt: "QUFBQUFBQUFBQUFBQUFBQf==" }), // same decoded bytes, non-canonical pad bits
    envelope({ nonce: "QUFBQUFBQUFBQUFB\n" }), envelope({ ciphertext: Buffer.alloc(16).toString("base64url") }),
    envelope({ password: "not-allowed" }), envelope({ plaintext: "not-allowed" }),
  ];
  const app = harness();
  for (const input of invalid) {
    assert.equal(validateMobileSyncEnvelope(input), null);
    assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: input }))).status, 400);
  }
  assert.equal(app.databaseRequests, 0);
  assert.deepEqual(validateMobileSyncEnvelope(envelope()), envelope());
});

test("mobile-sync rejects invalid revisions, malformed JSON and non-JSON content types", async () => {
  const app = harness();
  for (const revision of [-1, 0.5, "0", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: revision, envelope: envelope() }))).status, 400);
  }
  assert.equal((await app.PUT(new Request(url, {
    method: "PUT", headers: { "test-owner": "owner", "content-type": "application/json" }, body: "{invalid",
  }))).status, 400);
  assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope() }, { "content-type": "text/plain" }))).status, 415);
});

test("mobile-sync rejects external/null browser Origins and cross-site Fetch Metadata, but accepts native and same-origin", async () => {
  const app = harness();
  for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await app.GET(request("owner", "GET", undefined, headers))).status, 403);
    assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope() }, headers))).status, 403);
  }
  assert.equal(app.databaseRequests, 0);
  assert.equal((await app.GET(request("owner", "GET", undefined, { Origin: "https://workspace.example" }))).status, 200);
  assert.equal((await app.GET(request("owner"))).status, 200);
});

test("mobile-sync bounds streamed bytes despite a forged Content-Length and cancels an oversized upload", async () => {
  const app = harness();
  let sent = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { sent++; controller.enqueue(new Uint8Array(64 * 1024)); },
    cancel() { cancelled = true; },
  });
  const response = await app.PUT(new Request(url, {
    method: "PUT", duplex: "half", body: stream,
    headers: { "test-owner": "owner", "content-type": "application/json", "content-length": "1" },
  }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(sent <= Math.ceil(MOBILE_SYNC_MAX_REQUEST_BYTES / (64 * 1024)) + 2, true);
  assert.equal(app.databaseRequests, 0);
});

test("mobile-sync accepts a maximum-size ciphertext and rejects one byte above its limit", async () => {
  const app = harness();
  const maximum = envelope({ ciphertext: Buffer.alloc(MOBILE_SYNC_MAX_CIPHERTEXT_BYTES).toString("base64") });
  assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: maximum }))).status, 200);
  const tooLarge = envelope({ ciphertext: Buffer.alloc(MOBILE_SYNC_MAX_CIPHERTEXT_BYTES + 1).toString("base64") });
  assert.equal(validateMobileSyncEnvelope(tooLarge), null);
  assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: 1, envelope: tooLarge }))).status, 400);
});

test("mobile-sync does not increment past safe revision range or leak internal database errors", async () => {
  const app = harness();
  await app.PUT(request("owner", "PUT", { expectedRevision: 0, envelope: envelope() }));
  app.sqlite.exec(`UPDATE mobile_sync_vaults SET revision = ${Number.MAX_SAFE_INTEGER}`);
  assert.equal((await app.PUT(request("owner", "PUT", { expectedRevision: Number.MAX_SAFE_INTEGER, envelope: envelope() }))).status, 409);
  app.sqlite.exec("DROP TABLE mobile_sync_vaults");
  const response = await app.GET(request("owner"));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes("no such table"), false);
  assert.equal(text.includes("mobile_sync_vaults"), false);
  assert.equal(app.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'mobile_sync_vaults'").get(), undefined);
});

test("mobile-sync generated migration touches only its new vault table", () => {
  assert.match(migration, /CREATE TABLE `mobile_sync_vaults`/);
  assert.doesNotMatch(migration, /ALTER TABLE|DROP TABLE|customers|tasks|device_tokens/);
});
