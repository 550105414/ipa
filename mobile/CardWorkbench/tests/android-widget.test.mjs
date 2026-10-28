import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = async (path, module = ts.ModuleKind.ES2022) => ts.transpileModule(
  await readFile(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module } },
).outputText;
const dateUrl = dataUrl(await compile('../src/lib/date.ts'));
const schedule = await import(dataUrl((await compile('../src/widgets/widget-schedule.ts'))
  .replace("'../lib/date'", JSON.stringify(dateUrl))));
const adapterCode = await compile('../src/widgets/todo-widget.android.tsx', ts.ModuleKind.CommonJS);
function adapter(updateSnapshot) {
  const exports = {};
  new Function('require', 'exports', adapterCode)((specifier) => {
    if (specifier === '../../modules/cardworkbench-widget') return { default: { updateSnapshot } };
    if (specifier === './widget-schedule') return schedule;
    throw new Error(`Unexpected adapter dependency: ${specifier}`);
  }, exports);
  return exports;
}
const task = (id, extra = {}) => ({ id, title: `待办 ${id}`, ...extra });

test('Android widget writes title/date/star changes and future rows without changing App data', async () => {
  const writes = [];
  const widget = adapter(async (json) => writes.push(JSON.parse(json)));
  const tasks = [task('1'), task('2', { dueAt: '2099-01-01T10:00:00Z', isStarred: true }),
    task('3', { isCompleted: true })];
  const before = structuredClone(tasks);
  const result = await widget.syncTodoWidget(tasks, 'ready');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].schemaVersion, 2);
  assert.equal(writes[0].tasks.length, 2);
  assert.equal(writes[0].tasks[1].dueAt, '2099-01-01T10:00:00Z');
  assert.equal(writes[0].tasks[1].starred, true);
  assert.equal(result.total, 1);
  assert.deepEqual(tasks, before);
});

test('Android widget preserves write order during rapid edits', async () => {
  const writes = [];
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const widget = adapter(async (json) => {
    writes.push(JSON.parse(json).tasks[0].title);
    if (writes.length === 1) await first;
  });
  const a = widget.syncTodoWidget([task('1', { title: '旧标题' })]);
  const b = widget.syncTodoWidget([task('1', { title: '新标题' })]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(writes, ['旧标题']);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(writes, ['旧标题', '新标题']);
});

test('Android widget reports native failure and still accepts the next completed/empty snapshot', async () => {
  let attempts = 0;
  let last;
  const widget = adapter(async (json) => {
    attempts++;
    if (attempts === 1) throw new Error('storage unavailable');
    last = JSON.parse(json);
  });
  await assert.rejects(widget.syncTodoWidget([task('1')]), /storage unavailable/);
  await widget.syncTodoWidget([task('1', { isCompleted: true })], 'unpaired');
  assert.deepEqual(last.tasks, []);
  assert.equal(last.syncState, 'unpaired');
});

test('Android widget persists only shared widget fields, never arbitrary App credentials', async () => {
  let raw;
  const widget = adapter(async (json) => { raw = json; });
  await widget.syncTodoWidget([task('1', { password: 'do-not-copy', token: 'do-not-copy' })]);
  assert.equal(raw.includes('do-not-copy'), false);
  assert.equal(raw.includes('password'), false);
  assert.equal(raw.includes('token'), false);
});
