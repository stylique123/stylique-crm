/**
 * STYLIQUE CRM — Safe date helpers.
 *
 * Never call format()/parseISO() on undefined/null/invalid values.
 * Use these helpers for any user-facing date rendering.
 */
import { format as fnsFormat, formatDistanceToNow as fnsDistance } from 'date-fns';

export function isValidDateValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const d = new Date(value as string | number | Date);
  return !Number.isNaN(d.getTime());
}

export function safeDate(value: unknown): Date | null {
  if (!isValidDateValue(value)) return null;
  return new Date(value as string | number | Date);
}

/** format(new Date(value), pattern) but safe. */
export function safeFormatDate(
  value: unknown,
  pattern: string = 'MMM d, yyyy',
  fallback: string = '—',
): string {
  const d = safeDate(value);
  if (!d) return fallback;
  try {
    return fnsFormat(d, pattern);
  } catch {
    return fallback;
  }
}

/** Relative — "3 days ago" with safe handling. */
export function safeFormatRelative(
  value: unknown,
  fallback: string = '—',
): string {
  const d = safeDate(value);
  if (!d) return fallback;
  try {
    return fnsDistance(d, { addSuffix: true });
  } catch {
    return fallback;
  }
}

/** Numeric ms — safe. Returns 0 if invalid. */
export function safeTime(value: unknown): number {
  const d = safeDate(value);
  return d ? d.getTime() : 0;
}
