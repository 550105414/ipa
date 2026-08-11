import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const projectRoot = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'));
}

test('Expo iOS release configuration stays pinned', async () => {
  const appConfig = await readJson('app.json');
  const packageJson = await readJson('package.json');
  const packageLock = await readJson('package-lock.json');
  const buildProperties = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );

  assert.equal(appConfig.expo.name, '牛马');
  assert.equal(appConfig.expo.version, '1.1.0');
  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.xiaoke.salesworkspace');
  assert.equal(appConfig.expo.ios.buildNumber, '3');
  assert.equal(appConfig.expo.ios.infoPlist.CFBundleDisplayName, '牛马');
  assert.equal(buildProperties?.[1]?.ios?.deploymentTarget, '16.1');
  assert.ok(appConfig.expo.plugins.includes('expo-sqlite'));
  assert.match(packageJson.dependencies.expo, /^~55\./);
  assert.equal(packageJson.version, '1.1.0');
  assert.equal(packageLock.version, '1.1.0');
  assert.equal(packageLock.packages[''].version, '1.1.0');

  const widgetPluginIndex = appConfig.expo.plugins.findIndex(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-widgets',
  );
  const compatibilityPluginIndex = appConfig.expo.plugins.indexOf(
    './plugins/with-widget-deployment-target',
  );
  const widgetPlugin = appConfig.expo.plugins[widgetPluginIndex];

  assert.ok(widgetPluginIndex > compatibilityPluginIndex);
  assert.equal(widgetPlugin[1].bundleIdentifier, 'com.xiaoke.salesworkspace.TodoWidget');
  assert.equal(widgetPlugin[1].groupIdentifier, 'group.com.xiaoke.salesworkspace');
  assert.equal(widgetPlugin[1].enablePushNotifications, false);
  assert.equal(widgetPlugin[1].widgets[0].name, 'TodoWidget');
  assert.match(packageJson.dependencies['expo-widgets'], /^~55\./);
  assert.match(packageJson.dependencies['@expo/ui'], /^~55\./);
});

test('iOS widget implementation wins Metro platform resolution', async () => {
  const genericTs = new URL('src/widgets/todo-widget.ts', projectRoot);
  const genericTsx = new URL('src/widgets/todo-widget.tsx', projectRoot);
  const iosTsx = new URL('src/widgets/todo-widget.ios.tsx', projectRoot);
  const compatibilityPlugin = await readFile(
    new URL('plugins/with-widget-deployment-target.js', projectRoot),
    'utf8',
  );
  const iosWidgetSource = await readFile(iosTsx, 'utf8');

  await assert.rejects(access(genericTs));
  await access(genericTsx);
  await access(iosTsx);
  assert.match(iosWidgetSource, /createWidget<TodoWidgetSnapshot>\('TodoWidget'/);
  assert.match(iosWidgetSource, /TodoWidget\.updateSnapshot\(/);
  assert.match(iosWidgetSource, /TodoWidget\.reload\(\)/);
  assert.match(compatibilityPlugin, /CardWorkbenchTodoWidgetView/);
  assert.match(compatibilityPlugin, /TodoWidgetResilientTimelineProvider/);
  assert.match(compatibilityPlugin, /ENABLE_DEBUG_DYLIB = 'NO'/);
  assert.match(compatibilityPlugin, /SWIFT_OPTIMIZATION_LEVEL = '\"-O\"'/);
});

test('generated iOS entitlements keep App Group without push capability', async () => {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd.exe' : 'npx';
  const args = isWindows
    ? ['/d', '/s', '/c', 'npx.cmd expo config --type introspect --json']
    : ['expo', 'config', '--type', 'introspect', '--json'];
  const { stdout } = await execFileAsync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const introspection = JSON.parse(stdout);
  const entitlements = introspection._internal.modResults.ios.entitlements;

  assert.deepEqual(entitlements['com.apple.security.application-groups'], [
    'group.com.xiaoke.salesworkspace',
  ]);
  assert.equal('aps-environment' in entitlements, false);
});
