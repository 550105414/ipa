const pad = (value: number) => value.toString().padStart(2, '0');
const DUE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Date-only values mean local midnight; explicit offsets preserve the instant. */
export function parseTodoDueDate(value: string | null): Date | null {
  if (!value) return null;
  const match = DUE_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText ?? 0);
  const minute = Number(minuteText ?? 0);
  const second = Number(secondText ?? 0);
  const millisecond = Number((fraction ?? '').padEnd(3, '0'));
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) return null;

  const date = new Date(0);
  if (zone) {
    // Validate before applying the offset: Date.parse normalizes February 30.
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, millisecond);
    if (
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) return null;

    if (zone !== 'Z') {
      const offsetHours = Number(zone.slice(1, 3));
      const offsetMinutes = Number(zone.slice(4, 6));
      if (offsetHours > 23 || offsetMinutes > 59) return null;
      const direction = zone[0] === '-' ? -1 : 1;
      date.setTime(date.getTime() - direction * (offsetHours * 60 + offsetMinutes) * 60_000);
    }
    return date;
  }

  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, millisecond);
  return date.getFullYear() === year && date.getMonth() === month - 1 &&
    date.getDate() === day && date.getHours() === hour &&
    date.getMinutes() === minute && date.getSeconds() === second
    ? date
    : null;
}

export function localDueToRemote(value: string | null): string | null {
  return parseTodoDueDate(value)?.toISOString() ?? null;
}

export function remoteDueToLocal(value: string | null): string | null {
  const date = parseTodoDueDate(value);
  if (!date) return null;
  // A timestamp never implies an all-day event, including old noon values.
  return value!.trim().length === 10 ? toLocalDateKey(date) : date.toISOString();
}

export function resolveEditedDueAt(
  originalDueAt: string | null,
  selectedDate: Date | null,
  didChangeDate: boolean,
  includeTime = false,
): string | null {
  if (!didChangeDate) return originalDueAt;
  if (!selectedDate || !Number.isFinite(selectedDate.getTime())) return null;
  if (!includeTime) return toLocalDateKey(selectedDate);
  const date = new Date(selectedDate);
  date.setSeconds(0, 0);
  return date.toISOString();
}

export function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateKeyFromNow(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function dateFromLocalDateKey(value: string | null) {
  return parseTodoDueDate(value);
}

export function formatDueDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = parseTodoDueDate(value);
  if (!date) {
    return value;
  }

  const label = `${date.getMonth() + 1}月${date.getDate()}日`;
  return value.trim().length === 10 ? label : `${label} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCompletedDate(value: string | null) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }

  const today = new Date();
  const includeYear = parsed.getFullYear() !== today.getFullYear();
  return includeYear
    ? `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日`
    : `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

export type DueSection = 'overdue' | 'today' | 'future' | 'unscheduled';

export function getDueSection(value: string | null, now = new Date()): DueSection {
  const date = parseTodoDueDate(value);
  if (!date) {
    return 'unscheduled';
  }

  const dateKey = toLocalDateKey(date);
  const today = toLocalDateKey(now);
  if (dateKey < today) {
    return 'overdue';
  }
  if (dateKey === today) {
    return 'today';
  }
  return 'future';
}
