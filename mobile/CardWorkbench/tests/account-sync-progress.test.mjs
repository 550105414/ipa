import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';

const text = (node) => Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node) : text(node?.props?.children ?? []);
const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
const status = (patch = {}) => ({ phase: 'syncing', progress: { stage: 'download', startedAt: 100_000, attempt: 1 }, ...patch });

async function fixture(t, initial = status()) {
  let now = 100_000, nextTimer = 0, cursor = 0, dirty = false, current = initial;
  const timers = new Map(), cleared = [], slots = [], effects = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    assert.equal(delay, 1000);
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, 'clearInterval', (id) => { cleared.push(id); timers.delete(id); });
  const react = {
    useState(initialValue) {
      const index = cursor++;
      slots[index] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[index].value, (value) => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (slots[index] && same(slots[index].dependencies, dependencies)) return;
      effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: callback() };
      });
    },
  };
  const element = (type, props) => ({ type, props });
  const module = await loadTypeScript('src/components/account-sync-progress.tsx', {
    react,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Text: 'Text', View: 'View' },
    '@/theme/colors': { colors: { secondaryLabel: '#777', orange: '#f90' } },
  });
  const render = (next = current) => {
    current = next;
    let output;
    do {
      dirty = false;
      cursor = 0;
      output = module.AccountSyncProgress({ status: current });
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
    return output;
  };
  const unmount = () => { for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; } };
  t.after(unmount);
  return { render, unmount, timers, cleared, tick(milliseconds) { now += milliseconds; for (const callback of [...timers.values()]) callback(); return render(); } };
}

test('sync progress ticks and warns after thirty seconds without rendering any record, scope or secret', async (t) => {
  const ui = await fixture(t, status({ scope: 'synthetic-private-scope', conflictContext: { conflictKeys: ['private-record-id'] },
    password: 'synthetic-do-not-render', progress: { stage: 'synthetic-private-stage', startedAt: 100_000, attempt: 2 } }));
  assert.match(text(ui.render()), /本阶段 0 秒 · 第 2\/3 次/);
  assert.match(text(ui.tick(7_000)), /本阶段 7 秒/);
  assert.doesNotMatch(text(ui.tick(22_000)), /耗时较长/);
  const output = text(ui.tick(1_000));
  assert.match(output, /本阶段 30 秒/);
  assert.match(output, /前台并解锁.*不要重新设置同步密码.*尚未确认同步完成/);
  assert.doesNotMatch(output, /synthetic|private-record/);
});

test('a new stage resets its clock and replaces its timer; completion and unmount clear timers', async (t) => {
  const ui = await fixture(t);
  ui.render();
  assert.match(text(ui.tick(35_000)), /耗时较长/);
  const next = status({ progress: { stage: 'encrypt', startedAt: 135_000, attempt: 3 } });
  const output = text(ui.render(next));
  assert.match(output, /本阶段 0 秒 · 第 3\/3 次/);
  assert.doesNotMatch(output, /耗时较长/);
  assert.equal(ui.cleared.length, 1);
  assert.equal(ui.timers.size, 1);
  assert.match(text(ui.tick(1_000)), /本阶段 1 秒/);
  assert.match(text(ui.render({ phase: 'error', progress: null, lastDurationMs: 36_000 })), /最近一轮耗时：36 秒/);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.cleared.length, 2);
  ui.render(status({ progress: { stage: 'download', startedAt: 136_000, attempt: 1 } }));
  assert.equal(ui.timers.size, 1);
  ui.unmount();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.cleared.length, 3);
});

test('optional or invalid diagnostics are hidden and terminal duration never claims success', async (t) => {
  const ui = await fixture(t, { phase: 'syncing' });
  assert.equal(ui.render(), null);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.render(status({ progress: { stage: 'download', startedAt: Number.NaN, attempt: 1 } })), null);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.render({ phase: 'error', lastDurationMs: Number.NaN }), null);
  const output = text(ui.render({ phase: 'error', lastDurationMs: 12_600, lastVaultSyncedAt: 'private-success-value' }));
  assert.match(output, /最近一轮耗时：13 秒/);
  assert.doesNotMatch(output, /成功|private-success-value/);
});
