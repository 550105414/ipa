import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/date.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;

function inTimeZone(expression, timeZone = 'Asia/Shanghai') {
  const script = `const date = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify(${expression}));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8',
  }));
}

test('date-only uploads use local midnight, including positive and negative offsets', () => {
  assert.equal(inTimeZone("date.localDueToRemote('2026-11-06')"), '2026-11-05T16:00:00.000Z');
  assert.equal(
    inTimeZone("date.localDueToRemote('2026-07-06')", 'America/New_York'),
    '2026-07-06T04:00:00.000Z',
  );
  assert.equal(inTimeZone("date.localDueToRemote('2026-11-06')", 'UTC'), '2026-11-06T00:00:00.000Z');
});

test('explicit times keep their instant through download and re-upload', () => {
  assert.deepEqual(inTimeZone(`(() => {
    const values = ['2026-11-06T15:30:00+08:00', '2026-11-06T00:05:32.123-04:00'];
    return values.map((value) => {
      const downloaded = date.remoteDueToLocal(value);
      return [downloaded, date.localDueToRemote(downloaded)];
    });
  })()`), [
    ['2026-11-06T07:30:00.000Z', '2026-11-06T07:30:00.000Z'],
    ['2026-11-06T04:05:32.123Z', '2026-11-06T04:05:32.123Z'],
  ]);
});

test('strict parsing rejects invalid calendar dates, times, suffixes and offsets', () => {
  assert.deepEqual(inTimeZone(`[
    '2026-02-29', '2026-02-30T12:00:00Z', '2026-04-31T12:00:00+08:00',
    '2026-13-01', '0000-01-01', '2026-01-01T24:00:00Z', '2026-01-01T12:60:00Z',
    '2026-01-01T12:00:60Z', '2026-01-01T12:00:00+24:00',
    '2026-01-01T12:00:00+08:60', '2026-1-1', '2026-01-01junk',
  ].map((value) => date.parseTodoDueDate(value))`), Array(12).fill(null));
  assert.equal(inTimeZone("date.localDueToRemote('2028-02-29')"), '2028-02-28T16:00:00.000Z');
});

test('local time parsing respects DST and rejects a nonexistent local time', () => {
  assert.deepEqual(inTimeZone(`[
    date.localDueToRemote('2026-03-08 01:30:00'),
    date.localDueToRemote('2026-03-08 02:30:00'),
    date.localDueToRemote('2026-03-08 03:30:00'),
  ]`, 'America/New_York'), [
    '2026-03-08T06:30:00.000Z',
    null,
    '2026-03-08T07:30:00.000Z',
  ]);
});

test('labels, calendar selection and due sections use the local date of timestamps', () => {
  assert.deepEqual(inTimeZone(`(() => {
    const timestamp = '2026-11-05T23:30:00Z';
    const now = new Date('2026-11-06T01:00:00+08:00');
    return [
      date.formatDueDate(timestamp),
      date.formatDueDate('2026-11-06'),
      date.toLocalDateKey(date.dateFromLocalDateKey(timestamp)),
      date.getDueSection(timestamp, now),
      date.getDueSection('2026-11-05', now),
      date.getDueSection('2026-11-07', now),
      date.getDueSection('2026-02-30', now),
    ];
  })()`), ['11月6日 07:30', '11月6日', '2026-11-06', 'today', 'overdue', 'future', 'unscheduled']);
});

test('editing only title or notes preserves the original time and offset', () => {
  assert.deepEqual(inTimeZone(`(() => {
    const original = '2026-11-06T15:30:00+08:00';
    const selected = date.dateFromLocalDateKey(original);
    return [
      date.resolveEditedDueAt(original, selected, false),
      date.resolveEditedDueAt(original, new Date(2026, 10, 7), true),
      date.resolveEditedDueAt(original, null, true),
      date.resolveEditedDueAt(null, new Date(2026, 10, 7), true),
    ];
  })()`), ['2026-11-06T15:30:00+08:00', '2026-11-07', null, '2026-11-07']);
});

test('a cloud timestamp is never guessed to be all-day, including legacy noon values', () => {
  assert.deepEqual(inTimeZone(`[
    date.remoteDueToLocal('2026-11-06'),
    date.remoteDueToLocal('2026-11-06T12:00:00+08:00'),
    date.remoteDueToLocal(date.localDueToRemote('2026-11-06')),
    date.localDueToRemote(null),
    date.remoteDueToLocal('bad date'),
  ]`), ['2026-11-06', '2026-11-06T04:00:00.000Z', '2026-11-05T16:00:00.000Z', null, null]);
});
