import { parseTodoDueDate, toLocalDateKey } from '@/lib/date';
import type { RepeatRule } from '@/types/todo';

export const REPEAT_RULE_LABELS: Record<RepeatRule, string> = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

function calendarDayNumber(date: Date): number {
  const calendar = new Date(0);
  calendar.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  calendar.setUTCHours(0, 0, 0, 0);
  return calendar.getTime() / 86_400_000;
}

/**
 * Advance the original local-calendar cadence, not an elapsed 24-hour duration.
 * The retained anchor restores a 31st-of-month schedule after February and
 * keeps the usual wall-clock time after a daylight-saving transition.
 * Missed occurrences are skipped; completing one task creates only one future
 * occurrence. All-day anchors stay all-day instead of acquiring a UTC time.
 */
export function getNextRecurringDueAt(
  dueAt: string | null,
  repeatRule: RepeatRule,
  now = new Date(),
  anchorDueAt: string | null = dueAt,
): string | null {
  if (repeatRule === 'none') return null;
  const due = parseTodoDueDate(dueAt);
  const anchor = parseTodoDueDate(anchorDueAt);
  if (!due || !anchor || !Number.isFinite(now.getTime())) return null;

  const threshold = new Date(Math.max(due.getTime(), now.getTime()));
  const isAllDay = anchorDueAt!.trim().length === 10;
  let occurrence: number;
  if (repeatRule === 'monthly') {
    occurrence = Math.max(1, (threshold.getFullYear() - anchor.getFullYear()) * 12 +
      threshold.getMonth() - anchor.getMonth());
  } else {
    const intervalDays = repeatRule === 'weekly' ? 7 : 1;
    occurrence = Math.max(1, Math.floor(
      (calendarDayNumber(threshold) - calendarDayNumber(anchor)) / intervalDays,
    ));
  }

  // The calendar estimate is at most one occurrence before the threshold.
  for (let attempt = 0; attempt < 3; attempt += 1, occurrence += 1) {
    const candidate = new Date(0);
    if (repeatRule === 'monthly') {
      candidate.setFullYear(anchor.getFullYear(), anchor.getMonth() + occurrence + 1, 0);
      const lastDay = candidate.getDate();
      candidate.setDate(Math.min(anchor.getDate(), lastDay));
    } else {
      const days = occurrence * (repeatRule === 'weekly' ? 7 : 1);
      candidate.setFullYear(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days);
    }
    candidate.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
    if (Number.isFinite(candidate.getTime()) && candidate.getTime() > threshold.getTime()) {
      return isAllDay ? toLocalDateKey(candidate) : candidate.toISOString();
    }
  }
  return null;
}
