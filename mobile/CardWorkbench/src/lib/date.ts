const pad = (value: number) => value.toString().padStart(2, '0');

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
  if (!value) {
    return null;
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function formatDueDate(value: string | null) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }

  return `${month}月${day}日`;
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

export function getDueSection(value: string | null): DueSection {
  if (!value) {
    return 'unscheduled';
  }

  const dateKey = value.slice(0, 10);
  const today = toLocalDateKey(new Date());
  if (dateKey < today) {
    return 'overdue';
  }
  if (dateKey === today) {
    return 'today';
  }
  return 'future';
}
