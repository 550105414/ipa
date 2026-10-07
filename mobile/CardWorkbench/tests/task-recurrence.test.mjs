import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function sourceModuleUrl(relativePath, imports = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const [specifier, url] of Object.entries(imports)) {
    outputText = outputText.replaceAll(`from '${specifier}'`, `from '${url}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const dateUrl = await sourceModuleUrl('../src/lib/date.ts');
const recurrenceUrl = await sourceModuleUrl('../src/lib/task-recurrence.ts', { '@/lib/date': dateUrl });

function inTimeZone(expression, timeZone = 'Asia/Shanghai') {
  const script = `const recurrence = await import(${JSON.stringify(recurrenceUrl)});
    console.log(JSON.stringify(${expression}));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: timeZone }, encoding: 'utf8',
  }));
}

test('daily/weekly all-day tasks remain all-day and missed periods produce one future occurrence', () => {
  assert.deepEqual(inTimeZone(`[
    recurrence.getNextRecurringDueAt('2026-10-07', 'daily', new Date('2026-10-07T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2026-10-07', 'weekly', new Date('2026-10-07T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2020-01-01', 'daily', new Date('2026-10-07T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2026-01-07', 'weekly', new Date('2026-10-07T12:00:00+08:00')),
  ]`), ['2026-10-08', '2026-10-14', '2026-10-08', '2026-10-14']);
});

test('a monthly 31st anchor clamps February and restores the original day next month', () => {
  assert.deepEqual(inTimeZone(`[
    recurrence.getNextRecurringDueAt('2026-01-31', 'monthly', new Date('2026-01-31T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2026-02-28', 'monthly', new Date('2026-02-28T12:00:00+08:00'), '2026-01-31'),
    recurrence.getNextRecurringDueAt('2028-01-31', 'monthly', new Date('2028-01-31T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2028-02-29', 'monthly', new Date('2028-02-29T12:00:00+08:00'), '2028-01-31'),
    recurrence.getNextRecurringDueAt('2026-01-31', 'monthly', new Date('2026-10-07T12:00:00+08:00')),
  ]`), ['2026-02-28', '2026-03-31', '2028-02-29', '2028-03-31', '2026-10-31']);
});

test('exact local hour, minutes, seconds, and milliseconds survive each cadence', () => {
  assert.deepEqual(inTimeZone(`[
    recurrence.getNextRecurringDueAt('2026-10-07T15:42:31.123+08:00', 'daily', new Date('2026-10-07T16:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2026-10-07T15:42:31.123+08:00', 'weekly', new Date('2026-10-07T16:00:00+08:00')),
    recurrence.getNextRecurringDueAt('2026-10-31T15:42:31.123+08:00', 'monthly', new Date('2026-10-31T16:00:00+08:00')),
  ]`), ['2026-10-08T07:42:31.123Z', '2026-10-14T07:42:31.123Z', '2026-11-30T07:42:31.123Z']);
});

test('daylight-saving changes preserve wall-clock time, not a fixed 24-hour offset', () => {
  assert.deepEqual(inTimeZone(`[
    recurrence.getNextRecurringDueAt('2026-03-07T09:30:00-05:00', 'daily', new Date('2026-03-07T10:00:00-05:00')),
    recurrence.getNextRecurringDueAt('2026-10-31T09:30:00-04:00', 'daily', new Date('2026-10-31T10:00:00-04:00')),
    recurrence.getNextRecurringDueAt('2026-03-07', 'daily', new Date('2026-03-07T12:00:00-05:00')),
  ]`, 'America/New_York'), ['2026-03-08T13:30:00.000Z', '2026-11-01T14:30:00.000Z', '2026-03-08']);
});

test('a nonexistent DST local time advances through the gap without permanently changing its anchor', () => {
  assert.deepEqual(inTimeZone(`(() => {
    const anchor = '2026-03-07T02:30:00-05:00';
    const gap = recurrence.getNextRecurringDueAt(anchor, 'daily', new Date('2026-03-07T03:00:00-05:00'));
    return [gap, recurrence.getNextRecurringDueAt(gap, 'daily', new Date('2026-03-08T04:00:00-04:00'), anchor)];
  })()`, 'America/New_York'), ['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z']);
});

test('completion before its scheduled date still advances from that date, with invalid values rejected', () => {
  assert.deepEqual(inTimeZone(`[
    recurrence.getNextRecurringDueAt('2026-11-06', 'daily', new Date('2026-10-07T12:00:00+08:00')),
    recurrence.getNextRecurringDueAt(null, 'daily'),
    recurrence.getNextRecurringDueAt('2026-02-30', 'monthly'),
    recurrence.getNextRecurringDueAt('2026-10-07', 'none'),
    recurrence.getNextRecurringDueAt('2026-10-07', 'daily', new Date('invalid')),
  ]`), ['2026-11-07', null, null, null, null]);
});
