import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LocalVaultAuthenticationError,
  LocalVaultIntegrityError,
  LocalVaultSessionRevokedError,
  LocalVaultValidationError,
  createLocalVaultSession,
  revokeLocalCustomerAccess,
  revokeLocalVaultSession,
} from "../lib/local-vault/index.ts";
import { createMemoryLocalVault } from "../lib/local-vault/testing.ts";
import { isValidBankCardNumber } from "../app/customers/bank-card.ts";
import { normalizeAndValidateCardNumber } from "../lib/security/bank-card.ts";
import { localVaultAuthenticatedUserId } from "../lib/security/local-vault-server.ts";

const PASSWORD = "correct-test-password";
const USER_SCOPE = "test-user-scope-A";
const UNLOCK_SECRET = Buffer.alloc(32, 0x5a).toString("base64url");

test("uses the trusted Sites identity consistently across phone and desktop", () => {
  const request = new Request("https://private.example.test", {
    headers: {
      "oai-authenticated-user-id": "site-user-id",
      "oai-authenticated-user-email": "Owner@Example.COM ",
    },
  });
  assert.equal(localVaultAuthenticatedUserId(request), "email:owner@example.com");
});

function session(password = PASSWORD, unlockSecret = UNLOCK_SECRET) {
  return createLocalVaultSession({ password, unlockSecret, userScope: USER_SCOPE });
}

function customerInput(overrides = {}) {
  return {
    name: "陈志强",
    shopName: "广州第一螺",
    phone: "13800138888",
    idCardFront: new Blob(["fictional-front-image"], { type: "image/png" }),
    idCardBack: new Blob(["fictional-back-image"], { type: "image/jpeg" }),
    bankCardNumber: "4111111111111111",
    machineType: "扫码王",
    machineMode: "购买",
    feeRate: 0.38,
    status: "completed",
    createdAt: "2026-08-09T02:30:00.000Z",
    ...overrides,
  };
}

test("accepts any 12-19 digit bank card value used for collection", async () => {
  const collectedCard = "11111111111111111";
  assert.equal(isValidBankCardNumber(collectedCard), true);
  assert.equal(normalizeAndValidateCardNumber(collectedCard), collectedCard);

  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(
    customerInput({ bankCardNumber: collectedCard }),
    activeSession,
  );
  const access = await vault.unlockLocalCustomer(saved.id, activeSession);
  assert.equal(access.bankCardNumber, collectedCard);
  revokeLocalCustomerAccess(access);
});

test("stores only encrypted sensitive values and a masked summary", async () => {
  const vault = createMemoryLocalVault();
  const saved = await vault.saveLocalCustomer(customerInput(), session());
  assert.equal(saved.maskedPhone, "138****8888");
  assert.equal(saved.hasBankCard, true);
  assert.equal(saved.machineType, "扫码王");
  assert.equal(saved.machineMode, "购买");
  assert.equal(saved.feeRate, 0.38);

  const snapshot = vault.snapshot();
  const strings = collectStrings(snapshot);
  assert.equal(strings.includes("13800138888"), false);
  assert.equal(strings.includes("4111111111111111"), false);
  assert.equal(strings.includes("fictional-front-image"), false);
  assert.equal(strings.includes("fictional-back-image"), false);
  assert.equal(strings.includes(UNLOCK_SECRET), false);
  assert.equal(strings.includes(PASSWORD), false);
  assert.ok(snapshot.customers[0].phoneTokens.length > 0);
  assert.equal(snapshot.vaults[0].phoneIndexKey.extractable, false);
});

test("stores and searches the optional shop name in the authenticated summary", async () => {
  const vault = createMemoryLocalVault();
  const saved = await vault.saveLocalCustomer(customerInput(), session());
  assert.equal(saved.shopName, "广州第一螺");
  const results = await vault.searchLocalCustomers(
    "第一螺",
    {},
    { userScope: USER_SCOPE },
  );
  assert.deepEqual(results.map((item) => item.id), [saved.id]);
});

test("finds 3-11 digit phone fragments without an unlocked session", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  await vault.saveLocalCustomer(customerInput(), activeSession);
  revokeLocalVaultSession(activeSession);

  for (const query of ["138", "0013", "8888", "13800138888"]) {
    const results = await vault.searchLocalCustomers(
      query,
      { status: "completed", period: "all", limit: 20 },
      { userScope: USER_SCOPE },
    );
    assert.equal(results.length, 1, `expected a match for ${query}`);
  }
  assert.equal(
    (
      await vault.searchLocalCustomers("999", {}, { userScope: USER_SCOPE })
    ).length,
    0,
  );
  assert.equal(
    (
      await vault.searchLocalCustomers("陈志", {}, { userScope: USER_SCOPE })
    ).length,
    1,
  );
});

test("saves draft customers, filters categories, updates classification, and clears the vault", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(
    customerInput({
      name: "待补客户",
      phone: "13700001234",
      category: "汇来米",
      idCardFront: null,
      idCardBack: null,
      bankCardNumber: null,
    }),
    activeSession,
  );
  assert.equal(saved.profileStatus, "draft");
  assert.equal(saved.category, "汇来米");
  assert.deepEqual(saved.idCard, {
    frontUploaded: false,
    backUploaded: false,
  });

  const filtered = await vault.searchLocalCustomers(
    "",
    { status: "draft", category: "汇来米", limit: 20 },
    { userScope: USER_SCOPE },
  );
  assert.deepEqual(filtered.map((customer) => customer.id), [saved.id]);

  assert.deepEqual(
    await vault.updateLocalCustomerCategory(saved.id, activeSession, "代理"),
    { category: "代理" },
  );
  assert.equal(
    (await vault.getLocalCustomer(saved.id, { userScope: USER_SCOPE })).category,
    "代理",
  );

  await vault.clearLocalVault(activeSession);
  assert.deepEqual(
    await vault.searchLocalCustomers("", {}, { userScope: USER_SCOPE }),
    [],
  );
});

test("paginates 25 authenticated summaries without duplicates", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  for (let index = 0; index < 25; index += 1) {
    await vault.saveLocalCustomer(
      customerInput({
        name: `分页客户${String(index).padStart(2, "0")}`,
        phone: String(13800000000 + index),
        bankCardNumber: null,
        createdAt: `2026-08-09T02:30:${String(index).padStart(2, "0")}.000Z`,
      }),
      activeSession,
    );
  }

  const first = await vault.searchLocalCustomersPage(
    "分页",
    { status: "all", period: "all", limit: 20 },
    { userScope: USER_SCOPE },
  );
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 25);
  assert.equal(typeof first.nextCursor, "string");

  const second = await vault.searchLocalCustomersPage(
    "分页",
    { status: "all", period: "all", limit: 20 },
    { userScope: USER_SCOPE, cursor: first.nextCursor },
  );
  assert.equal(second.items.length, 5);
  assert.equal(second.total, 25);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(new Set(ids).size, 25);

  const compatibleFirstPage = await vault.searchLocalCustomers(
    "分页",
    { limit: 20 },
    { userScope: USER_SCOPE },
  );
  assert.deepEqual(
    compatibleFirstPage.map((item) => item.id),
    first.items.map((item) => item.id),
  );

  const tamperedCursor = `${first.nextCursor.slice(0, -1)}${
    first.nextCursor.endsWith("A") ? "B" : "A"
  }`;
  await assert.rejects(
    vault.searchLocalCustomersPage(
      "分页",
      { limit: 20 },
      { userScope: USER_SCOPE, cursor: tamperedCursor },
    ),
    LocalVaultValidationError,
  );
});

test("wrong password or server unlock secret cannot unwrap the master key", async () => {
  const vault = createMemoryLocalVault();
  const saved = await vault.saveLocalCustomer(customerInput(), session());
  await assert.rejects(
    vault.getLocalPhone(saved.id, session("wrong-test-password")),
    LocalVaultAuthenticationError,
  );
  const otherSecret = Buffer.alloc(32, 0x33).toString("base64url");
  await assert.rejects(
    vault.getLocalPhone(saved.id, session(PASSWORD, otherSecret)),
    LocalVaultAuthenticationError,
  );
});

test("AES-GCM detects ciphertext tampering", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(customerInput(), activeSession);
  await vault.tamperCustomer(USER_SCOPE, saved.id, (record) => {
    record.encrypted.phone.ciphertext[0] ^= 0xff;
  });
  await assert.rejects(
    vault.getLocalPhone(saved.id, activeSession),
    LocalVaultIntegrityError,
  );
});

test("authenticated summaries reject offline list/index tampering", async () => {
  const vault = createMemoryLocalVault();
  const saved = await vault.saveLocalCustomer(customerInput(), session());
  await vault.tamperCustomer(USER_SCOPE, saved.id, (record) => {
    record.name = "伪造客户";
    record.phoneTokens.length = 1;
  });
  await assert.rejects(
    vault.searchLocalCustomers("伪造", {}, { userScope: USER_SCOPE }),
    LocalVaultIntegrityError,
  );
});

test("rejects attacker-controlled KDF work factors before PBKDF2", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(customerInput(), activeSession);
  await vault.tamperVault(USER_SCOPE, (metadata) => {
    metadata.iterations = 2_000_000_000;
  });
  await assert.rejects(
    vault.getLocalPhone(saved.id, activeSession),
    LocalVaultIntegrityError,
  );
});

test("concurrent first writes retry without zeroing either image", async () => {
  const vault = createMemoryLocalVault();
  const [first, second] = await Promise.all([
    vault.saveLocalCustomer(customerInput({ name: "并发客户甲" }), session()),
    vault.saveLocalCustomer(
      customerInput({
        name: "并发客户乙",
        phone: "13900139999",
        idCardFront: new Blob(["second-front"], { type: "image/png" }),
        idCardBack: new Blob(["second-back"], { type: "image/jpeg" }),
        bankCardNumber: null,
      }),
      session(),
    ),
  ]);
  const firstAccess = await vault.unlockLocalCustomer(first.id, session());
  const secondAccess = await vault.unlockLocalCustomer(second.id, session());
  assert.equal(await firstAccess.idCard.frontBlob.text(), "fictional-front-image");
  assert.equal(await secondAccess.idCard.frontBlob.text(), "second-front");
  firstAccess.revoke();
  secondAccess.revoke();
});

test("unlocks blobs and central revocation invalidates object URLs", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(customerInput(), activeSession);
  const access = await vault.unlockLocalCustomer(saved.id, activeSession);
  assert.equal(access.phone, "13800138888");
  assert.equal(access.bankCardNumber, "4111111111111111");
  assert.equal(await access.idCard.frontBlob.text(), "fictional-front-image");
  assert.match(access.idCard.frontUrl, /^blob:nodedata:/);
  revokeLocalCustomerAccess(access);
  access.revoke();
});

test("revoked sessions cannot decrypt and bank updates return last4 only", async () => {
  const vault = createMemoryLocalVault();
  const activeSession = session();
  const saved = await vault.saveLocalCustomer(
    customerInput({ bankCardNumber: null }),
    activeSession,
  );
  assert.deepEqual(
    await vault.updateLocalBankCard(saved.id, activeSession, "4242-4242-4242-4242"),
    { last4: "4242" },
  );
  revokeLocalVaultSession(activeSession);
  await assert.rejects(
    vault.getLocalPhone(saved.id, activeSession),
    LocalVaultSessionRevokedError,
  );
});

function collectStrings(value, seen = new Set()) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return [];
  if (value instanceof CryptoKey || value instanceof Blob) return [];
  return Object.values(value).flatMap((entry) => collectStrings(entry, seen));
}
