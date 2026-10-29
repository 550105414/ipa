import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import { loadTypeScript } from './helpers/load-typescript.mjs';

const hashes = await import('@noble/hashes/sha2.js');
const utils = await import('@noble/hashes/utils.js');
const ciphers = await import('@noble/ciphers/aes.js');
const pbkdf2 = await import('@noble/hashes/pbkdf2.js');
const model = await loadTypeScript('src/lib/account-sync-model.ts', {
  '@noble/hashes/sha2.js': hashes, '@noble/hashes/utils.js': utils,
});
const scope = 'a'.repeat(64);
// Include embedded NUL and lone UTF-16 surrogates. TextEncoder/Node encode the
// latter as U+FFFD; native derivation must receive those exact UTF-8 bytes.
const password = 'Synthetic-汉字-🔐-\0-\ud800-X-\udc00-2026';
const document = { version: 1, records: [] };
const rng = async (length) => new Uint8Array(randomBytes(length));

async function loadCrypto(adapters = {}) {
  return loadTypeScript('src/lib/account-sync-crypto.ts', {
    '@noble/ciphers/aes.js': ciphers,
    '@noble/hashes/pbkdf2.js': pbkdf2,
    '@noble/hashes/sha2.js': hashes,
    '@noble/hashes/utils.js': utils,
    './account-sync-model': model,
    ...adapters,
  });
}

function nodeDecrypt(envelope, value = password) {
  const key = pbkdf2Sync(Buffer.from(value, 'utf8'), Buffer.from(envelope.salt, 'base64'), 310000, 32, 'sha256');
  try {
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(Buffer.from(`cardworkbench-sync|v1|${scope}`, 'utf8'));
    decipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'));
  } finally { key.fill(0); }
}

async function loadKdf(vault, { fallback = pbkdf2.pbkdf2Async } = {}) {
  const calls = { fallback: 0 };
  const crypto = await loadCrypto();
  const kdf = await loadTypeScript('src/lib/account-sync-kdf.ts', {
    '@credential-vault': { default: vault },
    './account-sync-crypto': crypto,
    '@noble/hashes/pbkdf2.js': {
      ...pbkdf2,
      pbkdf2Async: (...args) => { calls.fallback += 1; return fallback(...args); },
    },
    '@noble/hashes/sha2.js': hashes,
  });
  return { ...kdf, calls };
}

function nativeVault(derive) {
  return { supportsSyncKeyDerivation: () => true, deriveSyncKeyAsync: derive };
}

const noFallback = () => { throw new Error('Native-capable execution must not use Noble'); };

test('default Noble fallback keeps protocol v1 and exact UTF-8 password semantics', async () => {
  let nobleCalls = 0;
  const crypto = await loadCrypto({
    '@noble/hashes/pbkdf2.js': {
      ...pbkdf2,
      pbkdf2Async: (...args) => { nobleCalls += 1; return pbkdf2.pbkdf2Async(...args); },
    },
  });
  const envelope = await crypto.encryptSyncDocument(password, scope, document, rng);
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'iterations', 'kdf', 'nonce', 'salt', 'version']);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kdf, 'pbkdf2-sha256');
  assert.equal(envelope.iterations, 310000);
  assert.deepEqual(nodeDecrypt(envelope), document);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, envelope), document);
  assert.equal(nobleCalls, 2);
});

test('native KDF receives exact UTF-8 bytes including Unicode, NUL and lone surrogates, never Noble', async () => {
  const inputs = [
    password,
    'Ascii-Password-2026',
    '组合-e\u0301-é-👩🏽‍💻-2026-Sync',
  ];
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index * 17);
  const invocations = [];
  const { deriveSyncKey, calls } = await loadKdf(nativeVault(async (passwordBase64, saltBase64) => {
    invocations.push({ passwordBase64, saltBase64 });
    return pbkdf2Sync(Buffer.from(passwordBase64, 'base64'), Buffer.from(saltBase64, 'base64'), 310000, 32, 'sha256').toString('base64');
  }), { fallback: noFallback });
  for (const value of inputs) {
    const utf8 = utils.utf8ToBytes(value);
    const original = Uint8Array.from(utf8);
    const derived = await deriveSyncKey(utf8, salt);
    const expected = pbkdf2Sync(Buffer.from(value, 'utf8'), Buffer.from(salt), 310000, 32, 'sha256');
    assert.ok(derived instanceof Uint8Array);
    assert.equal(derived.length, 32);
    assert.deepEqual(Buffer.from(derived), expected);
    assert.deepEqual(utf8, original, 'The caller owns password bytes');
    derived.fill(0);
    expected.fill(0);
  }
  assert.equal(invocations.length, inputs.length);
  assert.deepEqual(invocations.map((entry) => entry.passwordBase64), inputs.map((value) => Buffer.from(value, 'utf8').toString('base64')));
  assert.ok(invocations.every((entry) => entry.saltBase64 === Buffer.from(salt).toString('base64')));
  assert.equal(calls.fallback, 0);
});

for (const [name, vault] of [
  ['missing capability on old native module / Web', {}],
  ['explicit unsupported capability on API 24', { supportsSyncKeyDerivation: () => false, deriveSyncKeyAsync: () => { throw new Error('Unsupported native must not run'); } }],
]) {
  test(`${name} uses the unchanged Noble protocol`, async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const { deriveSyncKey, calls } = await loadKdf(vault);
    const result = await deriveSyncKey(utils.utf8ToBytes(password), salt);
    const expected = pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt), 310000, 32, 'sha256');
    assert.deepEqual(Buffer.from(result), expected);
    assert.equal(calls.fallback, 1);
    result.fill(0);
    expected.fill(0);
  });
}

test('native derivation failure is propagated without silently switching to Noble', async () => {
  const failure = new Error('Synthetic native KDF failure');
  const { deriveSyncKey, calls } = await loadKdf(nativeVault(async () => { throw failure; }), { fallback: noFallback });
  await assert.rejects(deriveSyncKey(utils.utf8ToBytes(password), new Uint8Array(16)), (error) => error === failure);
  assert.equal(calls.fallback, 0);
});

test('a capability probe failure is not treated as unsupported or silently downgraded', async () => {
  const failure = new Error('Synthetic capability failure');
  const { deriveSyncKey, calls } = await loadKdf({ supportsSyncKeyDerivation: () => { throw failure; } }, { fallback: noFallback });
  await assert.rejects(deriveSyncKey(utils.utf8ToBytes(password), new Uint8Array(16)), (error) => error === failure);
  assert.equal(calls.fallback, 0);
});

test('native capability without its required derivation method fails closed', async () => {
  const { deriveSyncKey, calls } = await loadKdf({ supportsSyncKeyDerivation: () => true }, { fallback: noFallback });
  await assert.rejects(deriveSyncKey(utils.utf8ToBytes(password), new Uint8Array(16)));
  assert.equal(calls.fallback, 0);
});

test('native malformed, noncanonical or non-32-byte key responses are refused without fallback', async () => {
  const canonical = Buffer.alloc(32).toString('base64');
  const responses = [
    '',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
    'a===',
    `${canonical.slice(0, -2)}B=`,
    `${canonical}\n`,
    null,
    undefined,
    { key: canonical },
  ];
  for (const response of responses) {
    const { deriveSyncKey, calls } = await loadKdf(nativeVault(async () => response), { fallback: noFallback });
    await assert.rejects(deriveSyncKey(utils.utf8ToBytes(password), new Uint8Array(16)));
    assert.equal(calls.fallback, 0);
  }
});

test('encrypt and decrypt use the injected native provider and clear derived key buffers on success', async () => {
  const nativeInputs = [];
  const keys = [];
  const { deriveSyncKey, calls } = await loadKdf(nativeVault(async (passwordBase64, saltBase64) => {
    nativeInputs.push({ passwordBase64, saltBase64 });
    return pbkdf2Sync(Buffer.from(passwordBase64, 'base64'), Buffer.from(saltBase64, 'base64'), 310000, 32, 'sha256').toString('base64');
  }), { fallback: noFallback });
  const injected = async (utf8, salt) => {
    const key = await deriveSyncKey(utf8, salt);
    keys.push(key);
    return key;
  };
  const crypto = await loadCrypto({ '@noble/hashes/pbkdf2.js': { ...pbkdf2, pbkdf2Async: noFallback } });
  const envelope = await crypto.encryptSyncDocument(password, scope, document, rng, undefined, injected);
  assert.deepEqual(nodeDecrypt(envelope), document);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, envelope, injected), document);
  assert.equal(nativeInputs.length, 2);
  assert.ok(nativeInputs.every((input) => input.passwordBase64 === Buffer.from(password, 'utf8').toString('base64')));
  assert.equal(nativeInputs[0].saltBase64, envelope.salt);
  assert.equal(nativeInputs[1].saltBase64, envelope.salt);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((key) => key.length === 32 && key.every((byte) => byte === 0)));
  assert.equal(calls.fallback, 0);
});

test('native-injected authentication failure never imports plaintext and still clears the key', async () => {
  const keys = [];
  const injected = async (utf8, salt) => {
    const key = new Uint8Array(pbkdf2Sync(utf8, salt, 310000, 32, 'sha256'));
    keys.push(key);
    return key;
  };
  const crypto = await loadCrypto({ '@noble/hashes/pbkdf2.js': { ...pbkdf2, pbkdf2Async: noFallback } });
  const envelope = await crypto.encryptSyncDocument(password, scope, document, rng, undefined, injected);
  await assert.rejects(crypto.decryptSyncDocument(password, 'b'.repeat(64), envelope, injected), /密码不正确|密文/);
  const tampered = Buffer.from(envelope.ciphertext, 'base64');
  tampered[0] ^= 1;
  await assert.rejects(crypto.decryptSyncDocument(password, scope, { ...envelope, ciphertext: tampered.toString('base64') }, injected), /密码不正确|密文/);
  assert.equal(keys.length, 3);
  assert.ok(keys.every((key) => key.every((byte) => byte === 0)));
});

test('crypto propagates an injected native failure without running Noble or returning an envelope', async () => {
  const failure = new Error('Synthetic native failure before encryption');
  let passwordBytes;
  const crypto = await loadCrypto({ '@noble/hashes/pbkdf2.js': { ...pbkdf2, pbkdf2Async: noFallback } });
  await assert.rejects(crypto.encryptSyncDocument(password, scope, document, rng, undefined, async (utf8) => { passwordBytes = utf8; throw failure; }), (error) => error === failure);
  assert.ok(passwordBytes.length > 0);
  assert.ok(passwordBytes.every((byte) => byte === 0), 'An ephemeral UTF-8 password buffer must be cleared even when native rejects');
});

test('injected wrong-length keys fail closed and both the bad key and UTF-8 password are cleared', async () => {
  const crypto = await loadCrypto({ '@noble/hashes/pbkdf2.js': { ...pbkdf2, pbkdf2Async: noFallback } });
  for (const length of [0, 31, 33]) {
    const key = new Uint8Array(length).fill(99);
    let passwordBytes;
    await assert.rejects(crypto.encryptSyncDocument(password, scope, document, rng, undefined, async (utf8) => { passwordBytes = utf8; return key; }), /密钥.*无效/);
    assert.ok(key.every((byte) => byte === 0));
    assert.ok(passwordBytes.every((byte) => byte === 0));
  }
});

test('KDF parameter bounds reject malformed input before touching native or Noble', async () => {
  let nativeCalls = 0;
  const { deriveSyncKey, calls } = await loadKdf(nativeVault(async () => { nativeCalls += 1; return Buffer.alloc(32).toString('base64'); }), { fallback: noFallback });
  for (const [utf8, salt] of [
    [new Uint8Array(0), new Uint8Array(16)],
    [new Uint8Array(3073), new Uint8Array(16)],
    [new Uint8Array(12), new Uint8Array(15)],
    [new Uint8Array(12), new Uint8Array(17)],
  ]) await assert.rejects(deriveSyncKey(utf8, salt), /参数无效/);
  assert.equal(nativeCalls, 0);
  assert.equal(calls.fallback, 0);
});

test('every production cloud encrypt/decrypt call explicitly selects the native-capable KDF', async () => {
  const source = await readFile(new URL('../src/lib/account-sync.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('account-sync.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = [];
  const imported = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === './account-sync-kdf') {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) imported.push(...bindings.elements.map((element) => element.name.text));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['encryptSyncDocument', 'decryptSyncDocument'].includes(node.expression.text)) {
      calls.push(node);
      const expectedArguments = node.expression.text === 'encryptSyncDocument' ? 6 : 4;
      const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      assert.equal(node.arguments.length, expectedArguments, `${node.expression.text} at line ${position.line + 1} must pass the KDF provider`);
      assert.equal(node.arguments.at(-1).getText(tree), 'deriveSyncKey', `A production call at line ${position.line + 1} must not fall back to pure JS implicitly`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(imported.includes('deriveSyncKey'));
  assert.equal(calls.filter((call) => call.expression.text === 'decryptSyncDocument').length, 3, 'Current/pending cloud password and setup validation all need the native-capable provider');
  assert.equal(calls.filter((call) => call.expression.text === 'encryptSyncDocument').length, 1);
});
