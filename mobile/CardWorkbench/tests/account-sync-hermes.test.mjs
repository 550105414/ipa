import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';

import { loadTypeScript } from './helpers/load-typescript.mjs';

const hashes = await import('@noble/hashes/sha2.js');
const utils = await import('@noble/hashes/utils.js');
const ciphers = await import('@noble/ciphers/aes.js');
const pbkdf2 = await import('@noble/hashes/pbkdf2.js');
const model = await loadTypeScript('src/lib/account-sync-model.ts', {
  '@noble/hashes/sha2.js': hashes, '@noble/hashes/utils.js': utils,
});
const source = await readFile(new URL('../src/lib/account-sync-crypto.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

// Give only the application crypto module a constrained String facade. This
// models Hermes' argument ceiling without modifying global built-ins or tests.
function hermesCrypto() {
  let largestCall = 0;
  const limitedString = new Proxy(String, {
    get(target, property, receiver) {
      if (property !== 'fromCharCode') return Reflect.get(target, property, receiver);
      return (...values) => {
        largestCall = Math.max(largestCall, values.length);
        if (values.length > 4096) throw new RangeError('Hermes argument limit exceeded');
        return Reflect.apply(String.fromCharCode, String, values);
      };
    },
  });
  const adapters = {
    '@noble/ciphers/aes.js': ciphers, '@noble/hashes/pbkdf2.js': pbkdf2,
    '@noble/hashes/sha2.js': hashes, '@noble/hashes/utils.js': utils,
    './account-sync-model': model,
  };
  const module = { exports: {} };
  const execute = runInThisContext(`(function(module, exports, require, String) {\n${outputText}\n})`,
    { filename: 'account-sync-crypto.hermes-test.ts' });
  execute(module, module.exports, (specifier) => {
    assert.ok(specifier in adapters, `Unexpected crypto import: ${specifier}`);
    return adapters[specifier];
  }, limitedString);
  return { crypto: module.exports, largestCall: () => largestCall };
}

const scope = 'a'.repeat(64);
const password = 'Synthetic-Hermes-sync-password-2026';
const rng = async (length) => new Uint8Array(randomBytes(length));
const fixture = (count, notes = '') => ({
  version: 1,
  records: Array.from({ length: count }, (_, index) => ({
    kind: 'credential', id: `entry-${String(index).padStart(4, '0')}`, deleted: false,
    data: {
      platformName: `测试平台 ${index} 🚀`, categoryId: 'work', icon: 'key.fill',
      createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
      secret: { account: `测试账号${index}`, password: `非真实密码-${index}-🔐`,
        email: 'fixture@example.com', nickname: '测试昵称', website: 'https://example.com',
        notes, tags: ['测试', '🔑'] },
    },
  })),
});

function nodeDecrypt(envelope) {
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), 310000, 32, 'sha256');
  const combined = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
  decipher.setAAD(Buffer.from(`cardworkbench-sync|v1|${scope}`));
  decipher.setAuthTag(combined.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

test('Hermes-limited Base64 preserves every byte across 4096/8192 boundaries and the 1 MiB limit', () => {
  const { crypto, largestCall } = hermesCrypto();
  for (const length of [0, 4095, 4096, 4097, 8191, 8192, 8193, 16385, crypto.MAX_CIPHERTEXT_BYTES]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    const encoded = crypto.bytesToBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString('base64'), `Base64 mismatch at ${length} bytes`);
    assert.deepEqual(crypto.base64ToBytes(encoded), bytes);
  }
  assert.ok(largestCall() <= 4096);
  const oversized = Buffer.alloc(crypto.MAX_CIPHERTEXT_BYTES + 1).toString('base64');
  assert.throws(() => crypto.base64ToBytes(oversized), /容量|编码无效/);
});

test('a valid multi-credential Chinese/emoji vault over 8 KiB uploads and downloads under Hermes limits', async () => {
  const { crypto, largestCall } = hermesCrypto();
  const input = fixture(40, '中文备注与表情🚀🔐'.repeat(40));
  assert.ok(Buffer.byteLength(model.canonicalJson(input), 'utf8') > 8192);
  const envelope = await crypto.encryptSyncDocument(password, scope, input, rng);
  assert.deepEqual(nodeDecrypt(envelope), input);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, envelope), input);

  // The other platform need not use this encoder: independently created Node
  // AES-GCM ciphertext must still authenticate and decode without protocol changes.
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), 310000, 32, 'sha256');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`cardworkbench-sync|v1|${scope}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(input), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, {
    ...envelope, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'),
  }), input);
  assert.ok(largestCall() <= 4096);
});

test('exactly 1 MiB of authenticated ciphertext remains valid and one extra plaintext byte stops before RNG', async () => {
  const { crypto } = hermesCrypto();
  const input = fixture(11);
  let remaining = crypto.MAX_CIPHERTEXT_BYTES - 16 - Buffer.byteLength(model.canonicalJson(input), 'utf8');
  for (const record of input.records) {
    const size = Math.min(100000, remaining);
    record.data.secret.notes = 'n'.repeat(size);
    remaining -= size;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(model.canonicalJson(input), 'utf8') + 16, crypto.MAX_CIPHERTEXT_BYTES);
  const envelope = await crypto.encryptSyncDocument(password, scope, input, rng);
  assert.equal(Buffer.from(envelope.ciphertext, 'base64').length, crypto.MAX_CIPHERTEXT_BYTES);
  assert.deepEqual(nodeDecrypt(envelope), input);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, envelope), input);

  const oversized = structuredClone(input);
  oversized.records.find((record) => record.data.secret.notes.length < 100000).data.secret.notes += 'n';
  let generated = false;
  await assert.rejects(crypto.encryptSyncDocument(password, scope, oversized, async () => {
    generated = true;
    return new Uint8Array(16);
  }), /1 MiB/);
  assert.equal(generated, false);
});
