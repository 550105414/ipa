import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticateWorkspaceDevice,
  buildPairingDeepLink,
  constantTimeHashEqual,
  hashCredentialSecret,
  issueDeviceToken,
  issuePairingCode,
  verifyPairingCode,
  workspaceDeviceToken,
} from "../lib/workspace/device-auth.ts";

test("pairing credentials are high entropy and only their hashes need storage", async () => {
  const pairing = issuePairingCode();
  const hash = await hashCredentialSecret(pairing.secret);
  assert.match(pairing.code, /^wpp_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash.includes(pairing.secret), false);

  const row = {
    id: pairing.id,
    owner_id: "email:owner@example.com",
    code_hash: hash,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    revoked_at: null,
  };
  assert.equal(await verifyPairingCode(pairing.code, row), true);
  row.redeemed_at = new Date().toISOString();
  assert.equal(await verifyPairingCode(pairing.code, row), false);
});

test("expired, revoked, and tampered pairing codes are rejected", async () => {
  const pairing = issuePairingCode();
  const base = {
    id: pairing.id,
    owner_id: "owner",
    code_hash: await hashCredentialSecret(pairing.secret),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    revoked_at: null,
  };
  const tampered = `${pairing.code.slice(0, -1)}${pairing.code.endsWith("A") ? "B" : "A"}`;
  assert.equal(await verifyPairingCode(tampered, base), false);
  assert.equal(
    await verifyPairingCode(pairing.code, {
      ...base,
      expires_at: new Date(Date.now() - 1).toISOString(),
    }),
    false,
  );
  assert.equal(
    await verifyPairingCode(pairing.code, {
      ...base,
      revoked_at: new Date().toISOString(),
    }),
    false,
  );
});

test("device tokens map to an owner only after constant-time hash verification", async () => {
  const issued = issueDeviceToken();
  const row = {
    id: issued.id,
    owner_id: "email:owner@example.com",
    token_hash: await hashCredentialSecret(issued.secret),
    revoked_at: null,
  };
  const updates = [];
  const db = fakeDeviceDatabase(row, updates);

  assert.equal(
    await authenticateWorkspaceDevice(db, issued.token),
    "email:owner@example.com",
  );
  assert.equal(updates.length, 1);
  const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith("A") ? "B" : "A"}`;
  assert.equal(await authenticateWorkspaceDevice(db, tampered), null);
  assert.equal(updates.length, 1);
});

test("device header rejects oversized values and deep links keep protocol fields explicit", () => {
  const token = issueDeviceToken().token;
  assert.equal(workspaceDeviceToken(new Headers({ "X-Workspace-Device-Token": token })), token);
  assert.equal(
    workspaceDeviceToken(new Headers({ "X-Workspace-Device-Token": "x".repeat(257) })),
    null,
  );

  const link = new URL(
    buildPairingDeepLink({
      baseUrl: "https://workspace.example",
      code: "one-time-code",
      dispatchToken: "dispatch-secret",
    }),
  );
  assert.equal(link.protocol, "cardworkbench:");
  assert.equal(link.searchParams.get("base_url"), "https://workspace.example");
  assert.equal(link.searchParams.get("code"), "one-time-code");
  assert.equal(link.searchParams.get("dispatch_token"), "dispatch-secret");
});

test("hash comparison handles malformed inputs without throwing", async () => {
  const valid = await hashCredentialSecret("secret");
  assert.equal(constantTimeHashEqual(valid, valid), true);
  assert.equal(constantTimeHashEqual(valid, "not-base64!"), false);
  assert.equal(constantTimeHashEqual(valid, `${valid}A`), false);
});

function fakeDeviceDatabase(row, updates) {
  return {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          return sql.includes("FROM device_tokens") && this.values[0] === row.id
            ? { ...row }
            : null;
        },
        async run() {
          if (sql.includes("UPDATE device_tokens")) updates.push(this.values);
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}
