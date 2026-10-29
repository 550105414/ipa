import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const project = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, project), 'utf8');

test('Android release identity, private data backup and permissions stay explicit', async () => {
  const { expo } = JSON.parse(await read('app.json'));
  assert.equal(expo.android.package, 'com.xiaoke.salesworkspace');
  assert.equal(expo.android.versionCode, 16);
  assert.equal(expo.version, '1.6.0');
  assert.equal(expo.android.allowBackup, false);
  assert.ok(expo.android.permissions.includes('android.permission.SCHEDULE_EXACT_ALARM'));
  assert.ok(!expo.android.permissions.includes('android.permission.USE_EXACT_ALARM'));
  for (const permission of ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW']) {
    assert.ok(expo.android.blockedPermissions.includes(permission));
  }
});

test('Android release workflow stays manual-only and verifies a fixed non-debug signing certificate', async () => {
  const source = await read('../../.github/workflows/build-android.yaml');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s+(push|pull_request|schedule):/m);
  assert.match(source, /:app:assembleRelease/);
  assert.match(source, /:credential-vault:testReleaseUnitTest/);
  assert.match(source, /:cardworkbench-widget:testReleaseUnitTest/);
  const { expo } = JSON.parse(await read('app.json'));
  assert.ok(source.includes(`APP_BUILD: "${expo.android.versionCode}"`));
  assert.ok(source.includes(`CardWorkbench-${expo.version}-build${expo.android.versionCode}.apk`));
  assert.match(source, /apksigner.*sign/);
  assert.match(source, /apksigner.*verify/);
  assert.match(source, /7d3a7242735b21ba70ee25175c448c37f8eb0697d86746014d7fd802ca7ddf89/);
  assert.match(source, /application-debuggable/);
  assert.doesNotMatch(source, /\beas\s+(build|submit)/);
  const secrets = [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD']);
});

test('Android widget refresh serializes native readers and has reboot/time-change recovery', async () => {
  const source = await read('modules/cardworkbench-widget/android/src/main/java/expo/modules/cardworkbenchwidget/TodoWidgetProvider.kt');
  assert.match(source, /@Synchronized\s+fun updateAll/);
  const manifest = await read('modules/cardworkbench-widget/android/src/main/AndroidManifest.xml');
  for (const action of ['BOOT_COMPLETED', 'TIME_SET', 'TIMEZONE_CHANGED', 'MY_PACKAGE_REPLACED', 'SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED']) {
    assert.ok(manifest.includes(action));
  }
  assert.doesNotMatch(manifest, /android:exported="true"/);
});
