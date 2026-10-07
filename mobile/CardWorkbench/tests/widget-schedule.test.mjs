import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function compileModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
}
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dateUrl = dataUrl(await compileModule('../src/lib/date.ts'));
const scheduleUrl = dataUrl((await compileModule('../src/widgets/widget-schedule.ts'))
  .replace("'../lib/date'", JSON.stringify(dateUrl)));
const schedule = await import(scheduleUrl);
const now = new Date('2026-10-07T10:00:00+08:00');
const due = new Date('2026-10-07T10:30:00+08:00');
const task = (id, dueAt, extra = {}) => ({ id, title: id, dueAt, ...extra });
const ids = (tasks) => tasks.map((item) => item.id);

test('widget hides future tasks until the exact boundary, keeping app input intact', () => {
  const tasks = [task('undated', null), task('past', '2026-10-06'),
    task('future', due.toISOString()), task('invalid', '2026-02-30')];
  const original = structuredClone(tasks);
  const snapshot = schedule.createWidgetSnapshot(tasks, 'ready', now);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.tasks.length, 4);
  assert.deepEqual(ids(schedule.getVisibleWidgetTasks(snapshot, new Date(due.getTime() - 1))), ['undated', 'past']);
  assert.deepEqual(ids(schedule.getVisibleWidgetTasks(snapshot, due)), ['undated', 'past', 'future']);
  assert.deepEqual(tasks, original);
});

test('completed/blank tasks are excluded and snapshot preserves title, star, date and colour edits', () => {
  const snapshot = schedule.createWidgetSnapshot([
    task('a', null, { completedAt: now.toISOString() }),
    task('b', null, { isCompleted: true }),
    task('c', null, { title: '  ' }),
    task('edited', due.toISOString(), { title: ' 修改后的待办 ', color: '#112233', isStarred: true, dueLabel: '10月7日 10:30' }),
  ], 'ready', now);
  assert.equal(snapshot.total, 0);
  assert.deepEqual(snapshot.tasks, [{ id: 'edited', title: '修改后的待办', accent: '#112233', starred: true,
    dueAt: due.toISOString(), dueLabel: '10月7日 10:30' }]);
});

test('editing a visible task to a future date hides it again; completing it removes future entries', () => {
  const original = [task('edited', null)];
  assert.equal(schedule.createWidgetSnapshot(original, 'ready', now).total, 1);
  const rescheduled = schedule.createWidgetSnapshot([task('edited', due.toISOString())], 'ready', now);
  assert.equal(rescheduled.total, 0);
  assert.equal(schedule.buildWidgetTimeline(rescheduled, now)[1].props.total, 1);
  const completed = schedule.createWidgetSnapshot([task('edited', due.toISOString(), { isCompleted: true })], 'ready', now);
  assert.equal(completed.tasks.length, 0);
  assert.equal(schedule.buildWidgetTimeline(completed, now).length, 1);
});

test('timeline contains ordered unique future entries and recalculates visible counts', () => {
  const snapshot = schedule.createWidgetSnapshot([
    task('undated', null), task('future', due.toISOString()),
    task('same-instant', '2026-10-07T10:30:00+08:00'),
    task('later', '2026-10-07T12:00:00+08:00'),
  ], 'ready', now);
  const before = structuredClone(snapshot);
  const timeline = schedule.buildWidgetTimeline(snapshot, now);
  assert.deepEqual(timeline.map((entry) => entry.date), [now.getTime(), due.getTime(), new Date('2026-10-07T12:00:00+08:00').getTime()]);
  assert.deepEqual(timeline.map((entry) => entry.props.total), [1, 3, 4]);
  assert.deepEqual(ids(timeline[0].props.tasks), ['undated']);
  assert.deepEqual(snapshot, before);
});

test('future tasks never displace due tasks before filtering, even beyond eight items', () => {
  const tasks = Array.from({ length: 100 }, (_, index) => task(String(index), new Date(now.getTime() + (index + 1) * 60_000).toISOString()));
  tasks.push(task('visible-after-100', null));
  const snapshot = schedule.createWidgetSnapshot(tasks, 'ready', now);
  assert.equal(snapshot.tasks.length, 101);
  assert.equal(snapshot.total, 1);
  assert.deepEqual(ids(schedule.getVisibleWidgetTasks(snapshot, now)), ['visible-after-100']);
  assert.equal(schedule.buildWidgetTimeline(snapshot, now).length, 65);
  const later = new Date(now.getTime() + 64 * 60_000);
  assert.equal(schedule.buildWidgetTimeline(snapshot, later).length, 37);
});

test('date-only becomes visible at local midnight in multiple time zones, never earlier', () => {
  for (const zone of ['Asia/Shanghai', 'America/Los_Angeles', 'UTC']) {
    const script = `const s=await import(${JSON.stringify(scheduleUrl)});
      const midnight = new Date(2026, 10, 6);
      const snapshot = s.createWidgetSnapshot([{id:'date',title:'日期待办',dueAt:'2026-11-06'}], 'ready', new Date(midnight.getTime()-1));
      console.log(JSON.stringify([snapshot.total,s.getVisibleWidgetTasks(snapshot,midnight).length,s.parseWidgetDueAt('2026-11-06').getTime()===midnight.getTime()]));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8',
    }));
    assert.deepEqual(result, [0, 1, true], zone);
  }
});

test('invalid dates are fail-closed, offset timestamps match the same instant, empty dates remain visible', () => {
  assert.equal(schedule.parseWidgetDueAt('2026-02-30'), null);
  assert.equal(schedule.parseWidgetDueAt('2026-10-07T24:00:00Z'), null);
  assert.equal(schedule.parseWidgetDueAt('2026-10-07T10:30:00+08:00').getTime(), due.getTime());
  const snapshot = schedule.createWidgetSnapshot([task('invalid', 'not-a-date'), task('empty', ' ')], 'ready', now);
  assert.deepEqual(ids(schedule.getVisibleWidgetTasks(snapshot, now)), ['empty']);
  assert.equal(schedule.buildWidgetTimeline(snapshot, now).length, 1);
});
