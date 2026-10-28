import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';

import { loadTypeScript } from './helpers/load-typescript.mjs';

const root = new URL('../', import.meta.url);

test('Android symbols map to real bundled glyphs and keep a visible unknown-icon fallback', async () => {
  const { ANDROID_SYMBOLS, getAndroidSymbol } = await loadTypeScript('src/lib/android-symbols.ts');
  const glyphs = JSON.parse(await readFile(new URL(
    'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
    root,
  ), 'utf8'));
  for (const [name, glyph] of Object.entries(ANDROID_SYMBOLS)) {
    assert.equal(typeof glyphs[glyph], 'number', `${name} must use a glyph in the shipped font`);
    assert.equal(getAndroidSymbol(name), glyph);
  }
  assert.equal(getAndroidSymbol('unknown.cloud.category'), 'circle-outline');
  assert.equal(getAndroidSymbol('__proto__'), 'circle-outline');
  assert.equal(getAndroidSymbol('constructor'), 'circle-outline');
});

test('all current App literal symbols and seeded category icons have Android mappings', async () => {
  const { ANDROID_SYMBOLS } = await loadTypeScript('src/lib/android-symbols.ts');
  const symbols = new Set([
    'tray', 'megaphone', 'building.2', 'book.closed', 'film', 'cart',
    'message.fill', 'gamecontroller.fill', 'building.columns.fill',
    'briefcase.fill', 'cart.fill', 'folder.fill',
  ]);

  const collectStrings = (node) => {
    if (ts.isStringLiteral(node)) symbols.add(node.text);
    if (ts.isConditionalExpression(node)) {
      collectStrings(node.whenTrue);
      collectStrings(node.whenFalse);
      return;
    }
    ts.forEachChild(node, collectStrings);
  };
  async function collectTree(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(file.name + (file.isDirectory() ? '/' : ''), directory);
      if (file.isDirectory()) await collectTree(url);
      else if (file.name.endsWith('.tsx') && !file.name.startsWith('symbol-icon')) {
        const source = ts.createSourceFile(file.name, await readFile(url, 'utf8'),
          ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node) => {
          if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
            && node.tagName.getText(source) === 'SymbolIcon') {
            const name = node.attributes.properties.find((attribute) =>
              ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'name');
            if (name?.initializer) collectStrings(name.initializer);
          }
          if (ts.isPropertyAssignment(node) && ['icon', 'activeIcon'].includes(node.name.getText(source))
            && ts.isStringLiteral(node.initializer)) symbols.add(node.initializer.text);
          if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ICONS'
            && node.initializer) collectStrings(node.initializer);
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
  }
  await collectTree(new URL('src/app/', root));
  await collectTree(new URL('src/components/', root));
  assert.deepEqual([...symbols].filter((symbol) => !Object.hasOwn(ANDROID_SYMBOLS, symbol)), [],
    'every literal App symbol needs an Android glyph');
});

test('Android screen-lock PIN is accepted for prompting, but an unsecured device and probe errors fail closed', async () => {
  let level = 0;
  const native = {
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    getEnrolledLevelAsync: async () => level,
  };
  const { hasAndroidDeviceAuthentication } = await loadTypeScript('src/lib/android-device-auth.ts', {
    'expo-local-authentication': native,
  });
  for (const configured of [1, 2, 3]) {
    level = configured;
    assert.equal(await hasAndroidDeviceAuthentication(), true);
  }
  for (const missing of [0, -1, NaN, undefined, null]) {
    level = missing;
    assert.equal(await hasAndroidDeviceAuthentication(), false);
  }
  native.getEnrolledLevelAsync = async () => { throw new Error('native unavailable'); };
  await assert.rejects(hasAndroidDeviceAuthentication, /native unavailable/);
});

test('Android keeps the SDK55 platform picker and a light-canvas text palette', async () => {
  const picker = await readFile(new URL('src/app/add-task.tsx', root), 'utf8');
  assert.match(picker, /from '@expo\/ui\/datetimepicker'/);
  assert.doesNotMatch(picker, /@expo\/ui\/swift-ui/);
  assert.match(picker, /mode="time"[\s\S]*?is24Hour/);
  assert.match(picker, /positiveButton=\{\{ label: '确定' \}\}/);
  assert.match(picker, /negativeButton=\{\{ label: '取消' \}\}/);

  const { colors } = await loadTypeScript('src/theme/colors.ts', {
    'expo-router': { Color: { ios: { label: 'ios-label', secondaryLabel: 'ios-secondary',
      tertiaryLabel: 'ios-tertiary', separator: 'ios-separator' } } },
    'react-native': { Platform: { select: (values) => values.android ?? values.default } },
  });
  assert.equal(colors.card, '#FFFFFF');
  assert.equal(colors.label, '#111114');
  assert.equal(colors.secondaryLabel, '#73737B');
});

test('Android privacy gate unlocks only after the system prompt succeeds, including PIN-only devices', async () => {
  const previousPlatform = process.env.EXPO_OS;
  process.env.EXPO_OS = 'android';
  try {
    for (const scenario of [
      { configured: false, accepted: true, expectedPrompts: 0, expectedSessions: 0 },
      { configured: true, accepted: false, expectedPrompts: 1, expectedSessions: 0 },
      { configured: true, accepted: true, expectedPrompts: 1, expectedSessions: 1 },
    ]) {
      const state = [];
      const effects = [];
      let prompts = 0;
      let sessions = 0;
      let savedOptions;
      const jsx = (type, props) => ({ type, props });
      const { PrivacyGate } = await loadTypeScript('src/components/privacy-gate.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx },
        react: {
          useState(initial) {
            const index = state.length;
            state.push(typeof initial === 'function' ? initial() : initial);
            return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
          },
          useRef: (current) => ({ current }),
          useEffect: (effect) => effects.push(effect),
          useCallback: (callback) => callback,
        },
        'react-native': {
          AppState: { addEventListener: () => ({ remove() {} }) },
          Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { absoluteFillObject: {} },
        },
        'expo-local-authentication': {
          // PIN-only Android phones must not be rejected by these biometric-only probes.
          hasHardwareAsync: async () => { throw new Error('must not probe biometrics'); },
          isEnrolledAsync: async () => { throw new Error('must not probe biometrics'); },
          authenticateAsync: async (options) => {
            prompts += 1;
            savedOptions = options;
            return { success: scenario.accepted };
          },
        },
        '@/lib/android-device-auth': { hasAndroidDeviceAuthentication: async () => scenario.configured },
        '@/lib/face-id-session': {
          loadValidFaceIdSession: async () => null,
          createFaceIdSession: async () => { sessions += 1; return Date.now() + 3600000; },
          subscribeToFaceIdSessionRevocation: () => () => {},
        },
        '@/theme/colors': { colors: { background: '#fff', blueTint: '#eee', label: '#111', blue: '#00f' } },
      });
      PrivacyGate({ children: null });
      const cleanup = effects[0]();
      try {
        await setImmediate();
        assert.equal(prompts, scenario.expectedPrompts);
        assert.equal(sessions, scenario.expectedSessions);
        assert.equal(state[0], scenario.expectedSessions === 0);
        if (prompts > 0) {
          assert.equal(savedOptions.disableDeviceFallback, false);
          assert.equal(savedOptions.biometricsSecurityLevel, 'strong');
        }
      } finally {
        cleanup();
      }
    }
  } finally {
    if (previousPlatform === undefined) delete process.env.EXPO_OS;
    else process.env.EXPO_OS = previousPlatform;
  }
});
