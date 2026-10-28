import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/with-android-gradle-compat.js');

const wrapper = [
  'distributionBase=GRADLE_USER_HOME',
  'distributionPath=wrapper/dists',
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.0.0-bin.zip',
  'networkTimeout=10000',
  'validateDistributionUrl=true',
  'zipStoreBase=GRADLE_USER_HOME',
  'zipStorePath=wrapper/dists',
  '',
].join('\n');

test('SDK55 Android wrapper compatibility pin uses official Gradle 8.14.3 and its verified checksum', () => {
  const result = plugin.pinGradleWrapper(wrapper);
  assert.equal(plugin.GRADLE_VERSION, '8.14.3');
  assert.equal(plugin.GRADLE_SHA256, 'bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531');
  assert.ok(result.includes('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip'));
  assert.ok(result.includes(`distributionSha256Sum=${plugin.GRADLE_SHA256}`));
  assert.ok(result.includes('validateDistributionUrl=true'));
  assert.ok(result.includes('networkTimeout=10000'));
  assert.equal(plugin.pinGradleWrapper(result), result);
});

test('wrapper pin preserves CRLF and replaces the old checksum instead of appending duplicates', () => {
  const previous = wrapper.replaceAll('\n', '\r\n') + 'distributionSha256Sum=old-checksum\r\n';
  const result = plugin.pinGradleWrapper(previous);
  assert.equal(result.split('distributionSha256Sum=').length, 2);
  assert.equal(result.includes('old-checksum'), false);
  assert.equal(result.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(plugin.pinGradleWrapper(result), result);
});

test('wrapper pin fails closed on missing or duplicated distribution properties', () => {
  assert.throws(() => plugin.pinGradleWrapper('networkTimeout=10000\n'), /distributionUrl/);
  assert.throws(() => plugin.pinGradleWrapper(wrapper + 'distributionUrl=other\n'), /distributionUrl/);
  assert.throws(() => plugin.pinGradleWrapper(wrapper + 'distributionSha256Sum=a\ndistributionSha256Sum=b\n'), /distributionSha256Sum/);
});

test('compatibility pin validates installed AGP and does not silently apply to a future SDK', async () => {
  const catalog = await readFile(new URL('../node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml', import.meta.url), 'utf8');
  assert.doesNotThrow(() => plugin.assertCompatibleAgp(catalog));
  assert.doesNotThrow(() => plugin.assertCompatibleAgp('agp = "8.12.2"'));
  assert.throws(() => plugin.assertCompatibleAgp('agp = "9.0.0"'), /Review/);
  assert.throws(() => plugin.assertCompatibleAgp(''), /Review/);
});

test('Gradle compatibility plugin registers only Android, leaving the existing iOS project untouched', () => {
  const result = plugin({ name: '工作台', slug: 'CardWorkbench' });
  assert.equal(typeof result.mods.android.dangerous, 'function');
  assert.equal(result.mods.ios, undefined);
});
