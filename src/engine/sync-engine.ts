/**
 * STYLIQUE CRM — Attendance × Leave × Payroll × KPI Sync Engine
 *
 * Single source of truth that computes how a single employee's leave,
 * attendance, and KPI data flow into compensation for a given month.
 *
 * Used by the Employee Profile Drawer (Compensation tab) and any
 * leadership payroll view to produce a deterministic line-by-line
 * payroll breakdown.
 *
 * Contracts enforced here (matches policy memory):
 *   - Probation: first 3 months → no paid leave; max 2 unpaid leaves/month
 *     (over-limit requires manager override flag, not a hard block here).
 *   - Confirmed: paid leave deducts from annual balance; unpaid leave
 *     deducts a full day rate from salary.
 *   - Approved leave reduces the weekly KPI target if proration is on.
 *   - Late beyond grace count → fractional or fixed deduction per policy.
 *   - Absence → full day deduction.
 */
import type { EmployeeProfile, LeavePolicy, CommissionRule } from '@/lib/employee-store';
import { calculatePayroll, type PayrollEntry } from '@/lib/employee-store';
import type { LeaveRequest } from '@/lib/leave-store';
import type { AttendanceEntry } from '@/lib/attendance-store';
import {
  calculateAttendanceCompImpact,
  getAttendanceCompPolicy,
  type AttendanceCompPolicy,
} from '@/engine/weekly-kpi-engine';

// ─── Probation context ────────────────────────────────────

export interface ProbationContext {
  isProbationary: boolean;
  withinProbationWindow: boolean;
  probationEndDate?: string;
  /** Unpaid leave records used in the given YYYY-MM bucket. */
  monthlyUnpaidUsed: number;
  /** Hard cap during probation. */
  monthlyUnpaidLimit: number;
  /** True when monthly cap has been crossed and a manager override is needed. */
  exceedsMonthlyLimit: boolean;
}

export function getProbationContext(
  emp: EmployeeProfile,
  leaveRequests: LeaveRequest[],
  yearMonth: string,
): ProbationContext {
  const isProb = emp.employmentStatus === 'probationary';
  const monthlyLimit = 2;
  if (!isProb) {
    return {
      isProbationary: false,
      withinProbationWindow: false,
      monthlyUnpaidUsed: 0,
      monthlyUnpaidLimit: monthlyLimit,
      exceedsMonthlyLimit: false,
    };
  }

  // 3-month probation window from joining date (or explicit dates)
  let withinWindow = true;
  let endStr = emp.probationEndDate;
  if (!endStr && emp.joiningDate) {
    const start = new Date(emp.joiningDate + 'T00:00:00');
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    endStr = end.toISOString().slice(0, 10);
  }
  if (endStr) {
    const monthStart = new Date(yearMonth + '-01T00:00:00');
    withinWindow = monthStart < new Date(endStr + 'T00:00:00');
  }

  const monthlyUnpaidUsed = leaveRequests.filter(
    r =>
      r.userId === emp.id &&
      r.startDate.startsWith(yearMonth) &&
      r.status === 'approved' &&
      r.paidOrUnpaid === 'unpaid',
  ).length;

  return {
    isProbationary: true,
    withinProbationWindow: withinWindow,
    probationEndDate: endStr,
    monthlyUnpaidUsed,
    monthlyUnpaidLimit: monthlyLimit,
    exceedsMonthlyLimit: withinWindow && monthlyUnpaidUsed > monthlyLimit,
  };
}

// ─── Monthly leave + attendance roll-up ──────────────────

export interface MonthlyTotals {
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  halfDays: number;
  absenceDays: number;
  lateDays: number;
  earlyLeaveDays: number;
}

function daysInMonth(period: string): string[] {
  const [y, m] = period.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    const dd = String(d).padStart(2, '0');
    out.push(`${period}-${dd}`);
  }
  return out;
}

function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return dow === 0 || dow === 6;
}

export function rollupMonth(
  emp: EmployeeProfile,
  period: string, // YYYY-MM
  leaveRequests: LeaveRequest[],
  attendanceEntries: AttendanceEntry[],
  policy: LeavePolicy | undefined,
): MonthlyTotals {
  const totals: MonthlyTotals = {
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    halfDays: 0,
    absenceDays: 0,
    lateDays: 0,
    earlyLeaveDays: 0,
  };

  const probationAllUnpaid =
    emp.employmentStatus === 'probationary' &&
    (policy?.probationMode === 'no_paid_leave' ||
      policy?.probationMode === 'unpaid_unless_approved');

  // Walk approved leave requests overlapping this month
  for (const r of leaveRequests) {
    if (r.userId !== emp.id || r.status !== 'approved') continue;
    const start = r.startDate;
    const end = r.endDate || r.startDate;
    if (end < period + '-01' || start > period + '-31') continue;

    // Iterate days in the request that fall in this period
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      if (!k.startsWith(period)) continue;
      if (isWeekend(k)) continue;

      if (r.type === 'half_day') {
        totals.halfDays += 1;
        continue;
      }
      // Determine paid vs unpaid
      const declaredUnpaid = r.paidOrUnpaid === 'unpaid';
      const isUnpaid = probationAllUnpaid || declaredUnpaid;
      if (isUnpaid) totals.unpaidLeaveDays += 1;
      else totals.paidLeaveDays += 1;
    }
  }

  // Attendance entries (absent / late / early leave)
  for (const a of attendanceEntries) {
    if (a.userId !== emp.id) continue;
    if (!a.date.startsWith(period)) continue;
    if (isWeekend(a.date)) continue;

    if (a.status === 'absent') totals.absenceDays += 1;
    if (a.isLate) totals.lateDays += 1;
    if (a.isEarlyLeave) totals.earlyLeaveDays += 1;
  }

  return totals;
}

// ─── Full payroll breakdown ──────────────────────────────

export interface PayrollLine {
  label: string;
  detail?: string;
  amount: number; // positive = addition, negative = deduction
  kind: 'base' | 'addition' | 'deduction' | 'commission' | 'total';
}

export interface PayrollBreakdown {
  emp: EmployeeProfile;
  period: string;
  policy?: LeavePolicy;
  totals: MonthlyTotals;
  probation: ProbationContext;
  /** Computed payroll entry shape (without persistence ids). */
  computed: Omit<PayrollEntry, 'id' | 'locked' | 'lockedAt' | 'lockedBy' | 'createdAt' | 'updatedAt'>;
  /** Pretty line items for display. */
  lines: PayrollLine[];
  /** Notes about how each number was derived. */
  derivationNotes: string[];
  /** True when payroll should not be generated (e.g., not applicable). */
  notApplicable: boolean;
  notApplicableReason?: string;
}

/**
 * Compute the full live payroll breakdown for an employee for a month.
 * No persistence — callers persist via empStore.savePayrollEntry if desired.
 */
export function computePayrollBreakdown(params: {
  emp: EmployeeProfile;
  period: string; // YYYY-MM
  policy: LeavePolicy | undefined;
  leaveRequests: LeaveRequest[];
  attendanceEntries: AttendanceEntry[];
  commissionRules: CommissionRule[];
  outboundMeetings?: number;
  conversionCount?: number;
  manualAdditions?: number;
  manualDeductions?: number;
  compPolicy?: AttendanceCompPolicy;
}): PayrollBreakdown {
  const {
    emp, period, policy, leaveRequests, attendanceEntries, commissionRules,
    outboundMeetings = 0, conversionCount = 0,
    manualAdditions = 0, manualDeductions = 0,
  } = params;

  const probation = getProbationContext(emp, leaveRequests, period);
  const totals = rollupMonth(emp, period, leaveRequests, attendanceEntries, policy);

  // Not-applicable cases
  if (emp.payrollApplicable === false || emp.baseSalary <= 0) {
    return {
      emp, period, policy, totals, probation,
      computed: {
        employeeId: emp.id, period,
        baseSalary: emp.baseSalary, proratedSalary: 0,
        paidLeaveDays: totals.paidLeaveDays, unpaidLeaveDays: totals.unpaidLeaveDays,
        absenceDays: totals.absenceDays, halfDayDeductions: 0,
        lateDeductions: 0, unpaidLeaveDeduction: 0, absenceDeduction: 0,
        outboundMeetingCommissions: 0, conversionCommissions: 0,
        manualAdditions: 0, manualDeductions: 0, finalPayable: 0,
      },
      lines: [],
      derivationNotes: [],
      notApplicable: true,
      notApplicableReason: emp.baseSalary <= 0
        ? 'Base salary not configured.'
        : 'Payroll not applicable for this employee.',
    };
  }

  // Use the existing payroll math + attendance comp engine
  const computed = calculatePayroll(
    emp, period, policy,
    totals.paidLeaveDays, totals.unpaidLeaveDays, totals.absenceDays,
    totals.halfDays, totals.lateDays,
    outboundMeetings, conversionCount,
    commissionRules, manualAdditions, manualDeductions,
  );

  // Layer the attendance comp policy on top for richer narration
  const compPolicy = params.compPolicy || getAttendanceCompPolicy();
  const workingDays = (() => {
    const [y, m] = period.split('-').map(Number);
    let w = 0;
    const total = new Date(y, m, 0).getDate();
    for (let d = 1; d <= total; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6) w++;
    }
    return w;
  })();
  const compImpact = calculateAttendanceCompImpact(
    emp.baseSalary, workingDays,
    totals.lateDays, totals.earlyLeaveDays,
    totals.absenceDays, totals.unpaidLeaveDays,
    compPolicy,
  );

  // Build line items
  const lines: PayrollLine[] = [
    {
      label: 'Base salary',
      detail: emp.salaryEffectiveDate ? `Effective ${emp.salaryEffectiveDate}` : undefined,
      amount: emp.baseSalary,
      kind: 'base',
    },
  ];

  if (computed.proratedSalary !== emp.baseSalary) {
    lines.push({
      label: 'Pro-ration adjustment',
      detail: `Joined ${emp.joiningDate} mid-period`,
      amount: computed.proratedSalary - emp.baseSalary,
      kind: 'deduction',
    });
  }

  if (computed.outboundMeetingCommissions > 0) {
    lines.push({
      label: 'Outbound meeting commission',
      detail: `${outboundMeetings} qualifying meeting${outboundMeetings === 1 ? '' : 's'}`,
      amount: computed.outboundMeetingCommissions,
      kind: 'commission',
    });
  }
  if (computed.conversionCommissions > 0) {
    lines.push({
      label: 'Conversion commission',
      detail: `${conversionCount} conversion${conversionCount === 1 ? '' : 's'}`,
      amount: computed.conversionCommissions,
      kind: 'commission',
    });
  }
  if (manualAdditions > 0) {
    lines.push({ label: 'Manual addition', amount: manualAdditions, kind: 'addition' });
  }

  if (computed.unpaidLeaveDeduction > 0) {
    lines.push({
      label: 'Unpaid leave deduction',
      detail: `${totals.unpaidLeaveDays} day${totals.unpaidLeaveDays === 1 ? '' : 's'} × daily rate${probation.isProbationary ? ' · probation policy' : ''}`,
      amount: -computed.unpaidLeaveDeduction,
      kind: 'deduction',
    });
  }
  if (computed.absenceDeduction > 0) {
    lines.push({
      label: 'Absence deduction',
      detail: `${totals.absenceDays} unexcused absence${totals.absenceDays === 1 ? '' : 's'}`,
      amount: -computed.absenceDeduction,
      kind: 'deduction',
    });
  }
  if (computed.halfDayDeductions > 0) {
    lines.push({
      label: 'Half-day deduction',
      detail: `${totals.halfDays} half-day${totals.halfDays === 1 ? '' : 's'}`,
      amount: -computed.halfDayDeductions,
      kind: 'deduction',
    });
  }
  if (compImpact.lateDeduction > 0) {
    lines.push({
      label: 'Late deduction',
      detail: `${totals.lateDays} late · ${compPolicy.lateGracePeriodCount} grace`,
      amount: -compImpact.lateDeduction,
      kind: 'deduction',
    });
  }
  if (compImpact.earlyLeaveDeduction > 0) {
    lines.push({
      label: 'Early-leave deduction',
      detail: `${totals.earlyLeaveDays} early leave${totals.earlyLeaveDays === 1 ? '' : 's'}`,
      amount: -compImpact.earlyLeaveDeduction,
      kind: 'deduction',
    });
  }
  if (manualDeductions > 0) {
    lines.push({ label: 'Manual deduction', amount: -manualDeductions, kind: 'deduction' });
  }

  // Final payable line — recompute including comp engine extras (late/early)
  const finalPayable = Math.max(
    0,
    computed.finalPayable - compImpact.lateDeduction - compImpact.earlyLeaveDeduction,
  );
  lines.push({
    label: 'Final payable',
    amount: finalPayable,
    kind: 'total',
  });

  // Mutate computed.finalPayable so persistence stays in sync
  computed.finalPayable = finalPayable;
  computed.lateDeductions = compImpact.lateDeduction;

  const derivationNotes: string[] = [];
  if (totals.paidLeaveDays > 0)
    derivationNotes.push(`${totals.paidLeaveDays} approved paid leave day${totals.paidLeaveDays === 1 ? '' : 's'} — no salary impact, deducted from annual balance.`);
  if (probation.isProbationary && probation.withinProbationWindow) {
    derivationNotes.push(
      `Probationary: ${probation.monthlyUnpaidUsed}/${probation.monthlyUnpaidLimit} unpaid leaves used this month${probation.exceedsMonthlyLimit ? ' — over the cap, requires manager override.' : '.'}`,
    );
  }
  derivationNotes.push(...compImpact.details);

  return {
    emp, period, policy, totals, probation,
    computed, lines, derivationNotes, notApplicable: false,
  };
}

// ─── Helpers ─────────────────────────────────────────────

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMoney(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currency} ${Math.abs(amount).toLocaleString()}`;
}
