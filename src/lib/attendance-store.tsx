/**
 * STYLIQUE CRM — Attendance Store
 * Full check-in/check-out, leave management, and attendance tracking.
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { getApiToken, getStateBucket, saveStateBucket } from '@/lib/backend-api';

export type AttendanceStatus =
  | 'present' | 'late' | 'absent' | 'half_day'
  | 'leave_requested' | 'leave_approved' | 'leave_rejected'
  | 'holiday' | 'weekend' | 'remote' | 'field_work'
  | 'manual_override'
  | 'not_due_yet' | 'not_checked_in' | 'short_leave' | 'early_leave_approved' | 'checked_out';

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half Day',
  leave_requested: 'Leave Requested',
  leave_approved: 'On Leave',
  leave_rejected: 'Leave Rejected',
  holiday: 'Holiday',
  weekend: 'Weekend',
  remote: 'Remote',
  field_work: 'Field Work',
  manual_override: 'Manual Override',
  not_due_yet: 'Not Due Yet',
  not_checked_in: 'Not Checked In',
  short_leave: 'Short Leave',
  early_leave_approved: 'Early Leave',
  checked_out: 'Checked Out',
};

export const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-500/15 text-green-500 border-green-500/30',
  late: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  absent: 'bg-destructive/15 text-destructive border-destructive/30',
  half_day: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  leave_requested: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  leave_approved: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  leave_rejected: 'bg-destructive/15 text-destructive border-destructive/30',
  holiday: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  weekend: 'bg-muted text-muted-foreground border-border',
  remote: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  field_work: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  manual_override: 'bg-muted text-foreground border-border',
  not_due_yet: 'bg-muted text-muted-foreground border-border',
  not_checked_in: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  short_leave: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  early_leave_approved: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  checked_out: 'bg-muted text-foreground border-border',
};

export interface AttendanceEntry {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  checkInTime?: string; // HH:mm
  checkOutTime?: string;
  hoursLogged?: number;
  isLate?: boolean;
  isEarlyLeave?: boolean;
  leaveReason?: string;
  managerNote?: string;
  overrideBy?: string;
  overrideAt?: string;
  notes?: string;
  lastActiveTime?: string;
}

const STORAGE_KEY = 'stylique-attendance';

function loadEntries(): AttendanceEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveEntries(entries: AttendanceEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function syncAttendance(entries: AttendanceEntry[]) {
  if (!getApiToken()) return;
  saveStateBucket('attendance', entries).catch(error => {
    console.warn('[Attendance persistence] Could not sync attendance', error);
  });
}

function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Get current HH:mm in the employee's timezone */
function nowTimeInTZ(timezone?: string): string {
  try {
    const tz = timezone || 'UTC';
    const now = new Date();
    const localTimeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
    return localTimeStr;
  } catch {
    return nowTime();
  }
}

/** Get today's date key in the employee's timezone */
function todayKeyInTZ(timezone?: string): string {
  try {
    const tz = timezone || 'UTC';
    const now = new Date();
    // Format as YYYY-MM-DD in the employee's timezone
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
  } catch {
    return todayKey();
  }
}

/** Get current day-of-week (0=Sun) in the employee's timezone */
function dayOfWeekInTZ(timezone?: string): number {
  try {
    const tz = timezone || 'UTC';
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[dayStr] ?? now.getDay();
  } catch {
    return new Date().getDay();
  }
}

/**
 * Derive the real-time attendance status for display, considering shift times.
 * Does NOT mutate the store — pure derivation for UI.
 */
export function deriveAttendanceStatus(
  entry: AttendanceEntry | undefined,
  shiftStart?: string,
  shiftEnd?: string,
  graceMinutes?: number,
  timezone?: string,
  hasApprovedLeave?: boolean,
): { status: AttendanceStatus; label: string } {
  // If approved leave exists for this date, always show leave
  if (hasApprovedLeave) {
    return { status: 'leave_approved', label: 'On Leave' };
  }

  // If there's a stored entry with explicit status, use it
  if (entry) {
    // Override check: if checked out, show checked_out
    if (entry.checkOutTime && !['absent', 'leave_approved', 'leave_requested'].includes(entry.status)) {
      return { status: 'checked_out', label: `Checked Out (${entry.checkOutTime})` };
    }
    return { status: entry.status, label: ATTENDANCE_LABELS[entry.status] };
  }

  // No entry — derive from current time vs shift
  const shift = shiftStart || '09:00';
  const grace = graceMinutes ?? 15;

  // Get current time in employee's timezone
  const localTime = nowTimeInTZ(timezone);
  const [h, m] = localTime.split(':').map(Number);
  const nowMinutes = h * 60 + m;

  const [sh, sm] = shift.split(':').map(Number);
  const shiftStartMin = sh * 60 + sm;

  // Parse shift end
  const end = shiftEnd || '17:00';
  const [eh, em] = end.split(':').map(Number);
  const shiftEndMin = eh * 60 + em;

  // Check weekend in employee's timezone
  const day = dayOfWeekInTZ(timezone);
  if (day === 0 || day === 6) {
    return { status: 'weekend', label: 'Weekend' };
  }

  // Before shift start
  if (nowMinutes < shiftStartMin) {
    return { status: 'not_due_yet', label: 'Not Due Yet' };
  }

  // Within grace period
  if (nowMinutes <= shiftStartMin + grace) {
    return { status: 'not_checked_in', label: 'Not Checked In' };
  }

  // Past grace but before shift end — late / absent
  if (nowMinutes <= shiftEndMin) {
    return { status: 'not_checked_in', label: 'Not Checked In' };
  }

  // Past shift end with no check-in — absent
  return { status: 'absent', label: 'Absent' };
}

interface AttendanceContextValue {
  entries: AttendanceEntry[];
  getToday: (userId: string, timezone?: string) => AttendanceEntry | undefined;
  getForDate: (userId: string, date: string) => AttendanceEntry | undefined;
  checkIn: (userId: string, shiftStart?: string, graceMinutes?: number, hasApprovedLeave?: boolean, timezone?: string) => { success: boolean; message?: string };
  checkOut: (userId: string, timezone?: string, shiftEnd?: string) => void;
  requestLeave: (userId: string, date: string, reason: string) => void;
  approveLeave: (userId: string, date: string, approver: string) => void;
  rejectLeave: (userId: string, date: string, approver: string, note?: string) => void;
  markStatus: (userId: string, date: string, status: AttendanceStatus, by: string, note?: string) => void;
  addManagerNote: (userId: string, date: string, note: string) => void;
  getDateEntries: (date: string) => AttendanceEntry[];
  refresh: () => void;
}

const AttendanceContext = createContext<AttendanceContextValue | null>(null);

export function AttendanceProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<AttendanceEntry[]>(loadEntries);

  const persist = useCallback((updated: AttendanceEntry[]) => {
    setEntries(updated);
    saveEntries(updated);
    syncAttendance(updated);
  }, []);

  useEffect(() => {
    if (!getApiToken()) return;
    let cancelled = false;
    getStateBucket<AttendanceEntry>('attendance')
      .then(remote => {
        if (cancelled || !Array.isArray(remote)) return;
        saveEntries(remote);
        setEntries(remote);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const upsert = useCallback((userId: string, date: string, patch: Partial<AttendanceEntry>) => {
    const current = loadEntries();
    const idx = current.findIndex(e => e.userId === userId && e.date === date);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...patch };
    } else {
      current.push({
        id: crypto.randomUUID(),
        userId,
        date,
        status: 'present',
        ...patch,
      });
    }
    persist(current);
  }, [persist]);

  const getToday = useCallback((userId: string, timezone?: string) => {
    const dateKey = todayKeyInTZ(timezone);
    return entries.find(e => e.userId === userId && e.date === dateKey);
  }, [entries]);

  const getForDate = useCallback((userId: string, date: string) => {
    return entries.find(e => e.userId === userId && e.date === date);
  }, [entries]);

  const checkIn = useCallback((userId: string, employeeShiftStart?: string, employeeGraceMinutes?: number, hasApprovedLeave?: boolean, employeeTimezone?: string): { success: boolean; message?: string } => {
    // Block check-in if approved leave exists for today
    if (hasApprovedLeave) {
      return { success: false, message: 'You are on approved leave for this shift. Check-in is blocked. Contact admin for override.' };
    }
    
    // Use employee's timezone for accurate lateness calculation
    const time = nowTimeInTZ(employeeTimezone);
    const dateKey = todayKeyInTZ(employeeTimezone);
    const shiftStart = employeeShiftStart || '09:00';
    const grace = employeeGraceMinutes ?? 15;
    const [sh, sm] = shiftStart.split(':').map(Number);
    const thresholdMinutes = sh * 60 + sm + grace;
    const [ch, cm] = time.split(':').map(Number);
    const currentMinutes = ch * 60 + cm;
    const isLate = currentMinutes > thresholdMinutes;
    upsert(userId, dateKey, {
      status: isLate ? 'late' : 'present',
      checkInTime: time,
      isLate,
    });
    return { success: true };
  }, [upsert]);

  const checkOut = useCallback((userId: string, employeeTimezone?: string, employeeShiftEnd?: string) => {
    const dateKey = todayKeyInTZ(employeeTimezone);
    const entry = loadEntries().find(e => e.userId === userId && e.date === dateKey);
    const time = nowTimeInTZ(employeeTimezone);
    let hours = 0;
    if (entry?.checkInTime) {
      const [ih, im] = entry.checkInTime.split(':').map(Number);
      const [oh, om] = time.split(':').map(Number);
      hours = Math.max(0, (oh * 60 + om - ih * 60 - im) / 60);
    }
    const shiftEnd = employeeShiftEnd || '17:00';
    const isEarlyLeave = time < shiftEnd;
    upsert(userId, dateKey, {
      checkOutTime: time,
      hoursLogged: Math.round(hours * 10) / 10,
      isEarlyLeave,
      status: entry?.status === 'late' ? 'late' : (hours < 5 ? 'half_day' : entry?.status || 'present'),
    });
  }, [upsert]);

  const requestLeave = useCallback((userId: string, date: string, reason: string) => {
    upsert(userId, date, { status: 'leave_requested', leaveReason: reason });
  }, [upsert]);

  const approveLeave = useCallback((userId: string, date: string, approver: string) => {
    upsert(userId, date, { status: 'leave_approved', overrideBy: approver, overrideAt: new Date().toISOString() });
  }, [upsert]);

  const rejectLeave = useCallback((userId: string, date: string, approver: string, note?: string) => {
    upsert(userId, date, { status: 'leave_rejected', overrideBy: approver, overrideAt: new Date().toISOString(), managerNote: note });
  }, [upsert]);

  const markStatus = useCallback((userId: string, date: string, status: AttendanceStatus, by: string, note?: string) => {
    upsert(userId, date, { status, overrideBy: by, overrideAt: new Date().toISOString(), managerNote: note || undefined });
  }, [upsert]);

  const addManagerNote = useCallback((userId: string, date: string, note: string) => {
    upsert(userId, date, { managerNote: note });
  }, [upsert]);

  const getDateEntries = useCallback((date: string) => {
    return entries.filter(e => e.date === date);
  }, [entries]);

  const refresh = useCallback(() => setEntries(loadEntries()), []);

  // Listen for cross-store sync events (e.g., leave approval writes attendance entries)
  // This ensures React state updates when another store writes to localStorage
  useEffect(() => {
    const handler = () => setEntries(loadEntries());
    window.addEventListener('stylique-attendance-sync', handler);
    return () => window.removeEventListener('stylique-attendance-sync', handler);
  }, []);

  const value = useMemo(() => ({
    entries, getToday, getForDate, checkIn, checkOut, requestLeave,
    approveLeave, rejectLeave, markStatus, addManagerNote, getDateEntries, refresh,
  }), [entries, getToday, getForDate, checkIn, checkOut, requestLeave,
    approveLeave, rejectLeave, markStatus, addManagerNote, getDateEntries, refresh]);

  return <AttendanceContext.Provider value={value}>{children}</AttendanceContext.Provider>;
}

export function useAttendance() {
  const ctx = useContext(AttendanceContext);
  if (!ctx) throw new Error('useAttendance must be within AttendanceProvider');
  return ctx;
}
