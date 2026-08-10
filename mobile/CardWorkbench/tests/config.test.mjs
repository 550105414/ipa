import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'));
}

test('Expo iOS release configuration stays pinned', async () => {
  const appConfig = await readJson('app.json');
  const packageJson = await readJson('package.json');
  const buildProperties = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );

  assert.equal(appConfig.expo.name, 'CardWorkbench');
  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.xiaoke.salesworkspace');
  assert.equal(appConfig.expo.ios.infoPlist.CFBundleDisplayName, '个人工作台');
  assert.equal(buildProperties?.[1]?.ios?.deploymentTarget, '16.1');
  assert.ok(appConfig.expo.plugins.includes('expo-sqlite'));
  assert.match(packageJson.dependencies.expo, /^~55\./);
});
