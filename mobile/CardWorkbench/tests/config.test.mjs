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

  assert.equal(appConfig.expo.name, '工作台');
  assert.equal(appConfig.expo.version, '1.3.3');
  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.xiaoke.salesworkspace');
  assert.equal(appConfig.expo.ios.buildNumber, '8');
  assert.equal(appConfig.expo.ios.infoPlist.CFBundleDisplayName, '工作台');
  assert.equal(buildProperties?.[1]?.ios?.deploymentTarget, '16.1');
  assert.ok(appConfig.expo.plugins.includes('expo-sqlite'));
  assert.match(packageJson.dependencies.expo, /^~55\./);
  assert.equal(packageJson.version, '1.3.3');
  assert.equal(packageLock.version, '1.3.3');
  assert.equal(packageLock.packages[''].version, '1.3.3');

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
  assert.match(packageJson.dependencies['expo-local-authentication'], /^~55\./);
  assert.match(appConfig.expo.ios.infoPlist.NSFaceIDUsageDescription, /保护个人客户资料/);
});

test('Face ID session is fail-closed and expires after exactly one hour', async () => {
  const [sessionSource, gateSource, workspaceApiSource] = await Promise.all([
    readFile(new URL('src/lib/face-id-session.ts', projectRoot), 'utf8'),
    readFile(new URL('src/components/privacy-gate.tsx', projectRoot), 'utf8'),
    readFile(new URL('src/lib/workspace-api.ts', projectRoot), 'utf8'),
  ]);

  assert.match(sessionSource, /FACE_ID_SESSION_DURATION_MS = 60 \* 60 \* 1000/);
  assert.match(sessionSource, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(sessionSource, /session\.expiresAt - session\.issuedAt === FACE_ID_SESSION_DURATION_MS/);
  assert.match(sessionSource, /session\.expiresAt > now/);
  assert.match(gateSource, /loadValidFaceIdSession\(\)/);
  assert.match(gateSource, /authenticateAsync\(/);
  assert.match(gateSource, /disableDeviceFallback: false/);
  assert.match(gateSource, /if \(!hasHardware\)[\s\S]*?无法解锁个人资料/);
  assert.match(gateSource, /if \(!enrolled\)[\s\S]*?录入 Face ID/);
  assert.match(gateSource, /setTimeout\(\(\) => lock\(\), remaining\)/);
  assert.match(gateSource, /state === 'active'[\s\S]*?restoreOrUnlock\(\)/);
  assert.match(gateSource, /accessibilityElementsHidden=\{locked\}/);
  assert.match(gateSource, /pointerEvents=\{locked \? 'none' : 'auto'\}/);
  assert.match(gateSource, /opacity: locked \? 0 : 1/);
  assert.ok(gateSource.indexOf('{children}') < gateSource.indexOf('{locked ? ('));
  assert.match(workspaceApiSource, /revokeFaceIdSession\(\)/);
});

test('personal workspace improvements include dashboard, follow-up history, ledger, and daily backup restore', async () => {
  const [home, today, detail, edit, backup, layout] = await Promise.all([
    readFile(new URL('src/app/index.tsx', projectRoot), 'utf8'),
    readFile(new URL('src/app/today.tsx', projectRoot), 'utf8'),
    readFile(new URL('src/app/customer/[id].tsx', projectRoot), 'utf8'),
    readFile(new URL('src/app/customer/[id]/edit.tsx', projectRoot), 'utf8'),
    readFile(new URL('src/lib/auto-backup.ts', projectRoot), 'utf8'),
    readFile(new URL('src/app/_layout.tsx', projectRoot), 'utf8'),
  ]);

  assert.match(home, /label="今日工作"/);
  assert.match(home, /runDailyWorkspaceBackup\(\)/);
  assert.match(layout, /name="today"/);
  assert.match(today, /\/api\/workspace-dashboard/);
  assert.match(today, /到期跟进/);
  assert.match(today, /数据体检/);
  assert.match(detail, /记录本次跟进/);
  assert.match(detail, /\/activity/);
  assert.match(detail, /机器台账与收益/);
  assert.match(edit, /客户阶段/);
  assert.match(edit, /机器序列号/);
  assert.match(edit, /分润比例/);
  assert.match(backup, /Paths\.document/);
  assert.match(backup, /工作台-自动备份-最新\.json/);
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
  assert.match(compatibilityPlugin, /defaults\.synchronize\(\)/);
  assert.match(
    compatibilityPlugin,
    /policy: \.after\(Date\(\)\.addingTimeInterval\(15 \* 60\)\)/,
  );
  assert.doesNotMatch(compatibilityPlugin, /policy: \.never/);
  assert.match(compatibilityPlugin, /static let preview/);
  assert.match(compatibilityPlugin, /redactionReasons\.contains\(\.placeholder\)/);
  assert.match(compatibilityPlugin, /打开工作台完成连接/);
  assert.match(compatibilityPlugin, /同步失败，打开工作台重试/);
  assert.match(iosWidgetSource, /DEFERRED_RELOAD_DELAY_MS/);
  assert.match(iosWidgetSource, /VERIFY_RETRY_DELAYS_MS/);
  assert.match(iosWidgetSource, /await TodoWidget\.getTimeline\(\)/);
  assert.match(iosWidgetSource, /entry\.props\.updatedAt === snapshot\.updatedAt/);
});

test('TrollStore signing keeps the widget container entitlement extension-only', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/build.yaml', projectRoot),
    'utf8',
  );

  assert.match(
    workflow,
    /container_entitlement = "com\.apple\.private\.security\.container-required"/,
  );
  assert.match(
    workflow,
    /expected_widget_container = os\.environ\["WIDGET_BUNDLE_ID"\]/,
  );
  assert.match(workflow, /values\.pop\(container_entitlement, None\)/);
  assert.match(
    workflow,
    /values\[container_entitlement\] = container_identifier/,
  );
  assert.match(
    workflow,
    /name == "app" and container_entitlement in values/,
  );
  assert.match(
    workflow,
    /name == "widget" and values\.get\(container_entitlement\) != expected_widget_container/,
  );
  assert.match(workflow, /verified-widget-entitlements\.plist/);
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
  assert.equal('com.apple.private.security.container-required' in entitlements, false);
});

test('paired task sync remains offline-first and updates the widget from merged data', async () => {
  const [databaseSource, providerSource, syncSource] = await Promise.all([
    readFile(new URL('src/lib/database.ts', projectRoot), 'utf8'),
    readFile(new URL('src/providers/todo-provider.tsx', projectRoot), 'utf8'),
    readFile(new URL('src/lib/task-sync.ts', projectRoot), 'utf8'),
  ]);

  assert.match(databaseSource, /const DATABASE_VERSION = 4/);
  assert.match(databaseSource, /remote_id TEXT/);
  assert.match(databaseSource, /sync_state TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(providerSource, /cloud = await syncWorkspaceTasks\(database\)/);
  assert.ok(
    providerSource.indexOf('syncWorkspaceTasks(database)') <
      providerSource.indexOf('publishLocalState('),
  );
  assert.match(providerSource, /const widget = await syncTodoWidget\(widgetTasks, widgetState\)/);
  assert.match(providerSource, /setTasks\(nextTasks\)[\s\S]*?await syncTodoWidget/);
  assert.match(providerSource, /await toggleTaskCompletion\(database, id\)[\s\S]*?await publishMutationImmediately\(\)/);
  assert.match(providerSource, /void refresh\(\)\.catch/);
  assert.match(syncSource, /loadWorkspaceSession\(\)/);
  assert.match(syncSource, /fetchAllRemoteTasks\(\)/);
  assert.match(syncSource, /pageSize: '200'/);
  assert.match(syncSource, /seenCursors\.has\(cursor\)/);
  assert.match(syncSource, /INSERT OR IGNORE INTO todo_items/);
  assert.match(syncSource, /is_starred/);
  assert.match(syncSource, /status: local\.completed_at \? 'done' : 'open'/);
  assert.match(syncSource, /AND sync_state = 'synced' AND updated_at = \?/);
  assert.match(syncSource, /sync_state = 'local_only'/);
  assert.match(databaseSource, /updated_at = \?/);
});

test('device pairing pins every authenticated request and confirms credential replacement', async () => {
  const [workspaceConfig, workspaceApi, pairScreen] = await Promise.all([
    readFile(new URL('src/config/workspace.ts', projectRoot), 'utf8'),
    readFile(new URL('src/lib/workspace-api.ts', projectRoot), 'utf8'),
    readFile(new URL('src/app/pair.tsx', projectRoot), 'utf8'),
  ]);

  assert.match(
    workspaceConfig,
    /WORKSPACE_PRODUCTION_ORIGIN\s*=\s*\n?\s*'https:\/\/xiaoke-sales-workspace\.rich-mug-8653\.chatgpt\.site'/,
  );
  assert.match(workspaceConfig, /url\.origin !== WORKSPACE_PRODUCTION_ORIGIN/);
  assert.match(workspaceConfig, /url\.username !== ''/);
  assert.match(workspaceConfig, /url\.password !== ''/);
  assert.match(workspaceConfig, /future Universal Link migration/);
  assert.match(workspaceApi, /normalizePinnedWorkspaceBaseUrl\(baseUrl\)/);
  assert.match(workspaceApi, /normalizePinnedWorkspaceBaseUrl\(value\)/);
  assert.match(workspaceApi, /workspaceUrl\(path, session\.baseUrl\)/);
  assert.match(workspaceApi, /normalizePinnedWorkspaceBaseUrl\(url\.toString\(\)\)/);

  const confirmationStart = pairScreen.indexOf('const requestPairing');
  const confirmationEnd = pairScreen.indexOf('useEffect(', confirmationStart);
  const confirmation = pairScreen.slice(confirmationStart, confirmationEnd);
  assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart);
  assert.match(confirmation, /hasStoredWorkspaceCredentials\(\)/);
  assert.match(confirmation, /if \(!hasExistingCredentials\) \{\s*await pair\(\)/);
  assert.match(confirmation, /Alert\.alert\(/);
  assert.match(confirmation, /text: '确认替换'/);
  assert.match(confirmation, /onPress: \(\) => void pair\(\)/);
  assert.match(pairScreen, /WORKSPACE_PRODUCTION_BASE_URL/);
});

test('fresh installs stay empty and legacy demo cleanup is all-or-nothing', async () => {
  const databaseSource = await readFile(
    new URL('src/lib/database.ts', projectRoot),
    'utf8',
  );
  const signatureMatch = databaseSource.match(
    /const LEGACY_DEMO_TASKS:[\s\S]*?= \[([\s\S]*?)\n\];/,
  );

  assert.match(databaseSource, /const DATABASE_VERSION = 4/);
  assert.match(databaseSource, /SELECT '订购桶装水',[\s\S]*?WHERE 0;/);
  assert.ok(signatureMatch);
  const ids = [...signatureMatch[1].matchAll(/\bid: (\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(ids, Array.from({ length: 23 }, (_, index) => index + 1));
  assert.match(databaseSource, /rows\.length !== LEGACY_DEMO_TASKS\.length/);
  assert.match(databaseSource, /row\.created_at === row\.updated_at/);
  assert.match(databaseSource, /row\.remote_id === null/);
  assert.match(databaseSource, /row\.sync_state === 'pending'/);
  assert.match(databaseSource, /if \(!isExactUntouchedSeed\) return;/);
  assert.match(databaseSource, /DELETE FROM todo_items[\s\S]*?id BETWEEN 1 AND 23/);
});
