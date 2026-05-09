/**
 * STYLIQUE CRM — Day State Engine
 * Computes the final attendance state for a person on a given day.
 * Single source of truth for attendance display across all surfaces.
 */

export type FinalDayState =
  | 'present'
  | 'present_late'
  | 'present_early_leave'
  | 'present_late_early_leave'
  | 'on_leave'
  | 'half_day'
  | 'absent'
  | 'not_due_yet'
  | 'not_checked_in'
  | 'weekend'
  | 'holiday'
  | 'exempt';

export interface DayStateResult {
  state: FinalDayState;
  label: string;
  managerLabel: string;
  color: string;
  checkInTime?: string;
  checkOutTime?: string;
  lateByMinutes: number;
  lateByLabel?: string;
  earlyLeaveMinutes: number;
  earlyLeaveLabel?: string;
  hoursWorked: number;
  payImpacted: boolean;
  payImpactReason?: string;
  needsApproval: boolean;
  approvalReason?: string;
}

export const DAY_STATE_LABELS: Record<FinalDayState, string> = {
  present: 'Present',
  present_late: 'Present · Late',
  present_early_leave: 'Present · Early Leave',
  present_late_early_leave: 'Present · Late + Early Leave',
  on_leave: 'On Leave',
  half_day: 'Half Day',
  absent: 'Absent',
  not_due_yet: 'Not Due Yet',
  not_checked_in: 'Not Checked In',
  weekend: 'Weekend',
  holiday: 'Holiday',
  exempt: 'Exempt',
};

export const DAY_STATE_COLORS: Record<FinalDayState, string> = {
  present: 'bg-green-500/15 text-green-500 border-green-500/30',
  present_late: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  present_early_leave: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  present_late_early_leave: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  on_leave: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  half_day: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  absent: 'bg-destructive/15 text-destructive border-destructive/30',
  not_due_yet: 'bg-muted text-muted-foreground border-border',
  not_checked_in: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  weekend: 'bg-muted text-muted-foreground border-border',
  holiday: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  exempt: 'bg-muted text-muted-foreground border-border',
};

function minutesBetween(time1: string, time2: string): number {
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function nowTimeInTZ(timezone?: string): string {
  try {
    const tz = timezone || 'UTC';
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function dayOfWeekInTZ(timezone?: string): number {
  try {
    const dayStr = new Date().toLocaleDateString('en-US', { timeZone: timezone || 'UTC', weekday: 'short' });
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[dayStr] ?? new Date().getDay();
  } catch {
    return new Date().getDay();
  }
}

export interface DayStateInput {
  checkInTime?: string;
  checkOutTime?: string;
  hoursLogged?: number;
  isLate?: boolean;
  isEarlyLeave?: boolean;
  hasApprovedLeave?: boolean;
  leaveType?: string;
  hasLeaveRequest?: boolean;
  overrideStatus?: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  timezone?: string;
  attendanceExempt?: boolean;
  isProbationary?: boolean;
  isToday?: boolean;
}

export function computeDayState(input: DayStateInput): DayStateResult {
  const base: DayStateResult = {
    state: 'not_checked_in',
    label: 'Not Checked In',
    managerLabel: 'Not checked in',
    color: DAY_STATE_COLORS.not_checked_in,
    lateByMinutes: 0,
    earlyLeaveMinutes: 0,
    hoursWorked: 0,
    payImpacted: false,
    needsApproval: false,
  };

  if (input.attendanceExempt) {
    return { ...base, state: 'exempt', label: 'Exempt', managerLabel: 'Attendance exempt', color: DAY_STATE_COLORS.exempt };
  }

  if (input.hasApprovedLeave) {
    const lt = input.leaveType || 'full_day';
    const isHalf = lt === 'half_day';
    return {
      ...base,
      state: isHalf ? 'half_day' : 'on_leave',
      label: isHalf ? 'Half Day Leave' : 'On Leave',
      managerLabel: isHalf ? 'Half day leave' : 'On approved leave',
      color: isHalf ? DAY_STATE_COLORS.half_day : DAY_STATE_COLORS.on_leave,
      payImpacted: input.isProbationary || false,
      payImpactReason: input.isProbationary ? 'Probationary — unpaid leave deducted' : undefined,
    };
  }

  if (!input.isToday && !input.checkInTime) {
    return {
      ...base,
      state: 'absent', label: 'Absent',
      managerLabel: 'Absent — no check-in recorded',
      color: DAY_STATE_COLORS.absent,
      payImpacted: true, payImpactReason: 'Full day deduction',
    };
  }

  if (input.isToday && !input.checkInTime) {
    const dow = dayOfWeekInTZ(input.timezone);
    if (dow === 0 || dow === 6) {
      return { ...base, state: 'weekend', label: 'Weekend', managerLabel: 'Weekend', color: DAY_STATE_COLORS.weekend };
    }

    const localTime = nowTimeInTZ(input.timezone);
    const [h, m] = localTime.split(':').map(Number);
    const nowMins = h * 60 + m;
    const [sh, sm] = input.shiftStart.split(':').map(Number);
    const shiftMins = sh * 60 + sm;
    const [eh, em] = input.shiftEnd.split(':').map(Number);
    const shiftEndMins = eh * 60 + em;

    if (nowMins < shiftMins) {
      return { ...base, state: 'not_due_yet', label: 'Not Due Yet', managerLabel: `Shift starts at ${input.shiftStart}`, color: DAY_STATE_COLORS.not_due_yet };
    }
    if (nowMins <= shiftMins + input.graceMinutes) {
      return { ...base, state: 'not_checked_in', label: 'Not Checked In', managerLabel: `Within grace period (${input.graceMinutes}min)`, color: DAY_STATE_COLORS.not_checked_in };
    }
    if (nowMins > shiftEndMins) {
      return {
        ...base, state: 'absent', label: 'Absent',
        managerLabel: 'Shift ended — no check-in',
        color: DAY_STATE_COLORS.absent,
        payImpacted: true, payImpactReason: 'Full day deduction',
        needsApproval: true, approvalReason: 'Override if excused absence',
      };
    }
    const lateBy = nowMins - shiftMins;
    return {
      ...base, state: 'not_checked_in',
      label: `Not Checked In · ${formatMinutes(lateBy)} past shift`,
      managerLabel: `Late — ${formatMinutes(lateBy)} past shift start`,
      color: DAY_STATE_COLORS.not_checked_in,
      needsApproval: lateBy > 30,
      approvalReason: lateBy > 30 ? 'Late by >30 min, may need override' : undefined,
    };
  }

  if (input.checkInTime) {
    const [sh, sm] = input.shiftStart.split(':').map(Number);
    const shiftStartMins = sh * 60 + sm;
    const [ch, cm] = input.checkInTime.split(':').map(Number);
    const checkInMins = ch * 60 + cm;
    const lateBy = Math.max(0, checkInMins - shiftStartMins - input.graceMinutes);
    const isLate = lateBy > 0;

    let earlyLeaveBy = 0;
    let isEarly = false;
    let hoursWorked = 0;

    if (input.checkOutTime) {
      const [oh, om] = input.checkOutTime.split(':').map(Number);
      const checkOutMins = oh * 60 + om;
      const [eh, em] = input.shiftEnd.split(':').map(Number);
      const shiftEndMins = eh * 60 + em;
      earlyLeaveBy = Math.max(0, shiftEndMins - checkOutMins);
      isEarly = earlyLeaveBy > 15;
      hoursWorked = Math.max(0, (checkOutMins - checkInMins) / 60);
    } else if (input.hoursLogged) {
      hoursWorked = input.hoursLogged;
    }

    const isHalfDay = hoursWorked > 0 && hoursWorked < 5;

    let state: FinalDayState;
    if (isHalfDay) state = 'half_day';
    else if (isLate && isEarly) state = 'present_late_early_leave';
    else if (isLate) state = 'present_late';
    else if (isEarly) state = 'present_early_leave';
    else state = 'present';

    const lateLbl = isLate ? `Late by ${formatMinutes(lateBy)}` : '';
    const earlyLbl = isEarly ? `Early leave by ${formatMinutes(earlyLeaveBy)}` : '';

    let payImpacted = false;
    let payImpactReason: string | undefined;
    if (isHalfDay) {
      payImpacted = true;
      payImpactReason = 'Half-day deduction (0.5 day)';
    } else if (isLate && lateBy > 60) {
      payImpacted = true;
      payImpactReason = 'Late deduction may apply (>1h)';
    }

    return {
      state, label: DAY_STATE_LABELS[state],
      managerLabel: [lateLbl, earlyLbl].filter(Boolean).join(' · ') || 'Present — on time',
      color: DAY_STATE_COLORS[state],
      checkInTime: input.checkInTime, checkOutTime: input.checkOutTime,
      lateByMinutes: isLate ? lateBy : 0,
      lateByLabel: isLate ? formatMinutes(lateBy) : undefined,
      earlyLeaveMinutes: isEarly ? earlyLeaveBy : 0,
      earlyLeaveLabel: isEarly ? formatMinutes(earlyLeaveBy) : undefined,
      hoursWorked: Math.round(hoursWorked * 10) / 10,
      payImpacted, payImpactReason,
      needsApproval: isLate && lateBy > 30,
      approvalReason: isLate && lateBy > 30 ? 'Late arrival needs manager acknowledgement' : undefined,
    };
  }

  return base;
}

/**
 * Get leave balance context string for display.
 * Policy-aware explanation instead of mysterious numbers.
 */
export function getLeaveBalanceLabel(
  remaining: number,
  total: number,
  isProbationary: boolean,
  probationMode?: string,
): string {
  if (isProbationary) {
    if (probationMode === 'no_paid_leave') return 'Probationary — no paid leave. Up to 2 unpaid leaves/month with prior approval.';
    if (probationMode === 'pro_rata') return `${remaining} remaining (pro-rata accrual)`;
    if (probationMode === 'manager_approved_bucket') return `${remaining} remaining (manager bucket)`;
    if (probationMode === 'unpaid_unless_approved') return 'Unpaid unless manager approves';
    return 'Probationary — policy pending';
  }
  if (total === 0) return 'No leave allowance configured';
  return `${remaining} remaining of ${total} yearly`;
}

/**
 * Get payroll base salary display.
 * Never show "PKR 0" — show "Not configured" instead.
 */
export function getSalaryDisplay(baseSalary: number, currency: string): string {
  if (baseSalary <= 0) return 'Base salary not configured';
  return `${currency} ${baseSalary.toLocaleString()}`;
}

/** Format ISO timestamp for human display */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const year = d.getFullYear();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${month} ${day}, ${year} at ${time}`;
  } catch {
    return iso;
  }
}
