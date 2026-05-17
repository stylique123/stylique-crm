/**
 * STYLIQUE CRM — Weekly-First KPI Engine
 * 
 * Core philosophy: Weekly output is the truth. Daily KPI is pacing guidance.
 * SDR target = average 25 brands/working day across the week.
 * Dynamic recovery: if one day is weak, CRM recalculates required pace.
 * 
 * Supports two policy modes:
 *   A. Fixed weekly target (absence doesn't reduce target)
 *   B. Prorated weekly target (approved leave reduces working days)
 */

import { getKPIActions, todayKey, getBrandCoverage } from '@/engine/kpi-engine';
import type { KPIActionEntry } from '@/types/kpi';
import { safeRead, safeWrite } from '@/lib/safe-storage';

// ─── Types ──────────────────────────────────────────────

export type LeaveProrationMode = 'fixed' | 'prorated';

export interface WeeklyKPIConfig {
  /** Brands per working day average — default 25 */
  brandsPerWorkingDay: number;
  /** Whether approved leave reduces weekly target */
  leaveProrationMode: LeaveProrationMode;
  /** Whether blocked brands count partially */
  blockedBrandsMode: 'exclude' | 'partial' | 'count';
}

const CONFIG_KEY = 'stylique-weekly-kpi-config';

export const DEFAULT_WEEKLY_CONFIG: WeeklyKPIConfig = {
  brandsPerWorkingDay: 25,
  leaveProrationMode: 'prorated',
  blockedBrandsMode: 'exclude',
};

export function getWeeklyKPIConfig(): WeeklyKPIConfig {
  return { ...DEFAULT_WEEKLY_CONFIG, ...safeRead<Partial<WeeklyKPIConfig>>(CONFIG_KEY, {}) };
}

export function saveWeeklyKPIConfig(config: WeeklyKPIConfig) {
  safeWrite(CONFIG_KEY, config);
  // Single source of truth: propagate brands/working-day to the
  // canonical brands KPI definition (weekly target = perDay × 5).
  // Without this, Settings edits do not reach Performance, dashboards,
  // or per-SDR KPI cards.
  try {
    const KPI_KEY = 'stylique-kpi-definitions';
    const now = new Date().toISOString();
    const stored = safeRead<Array<{ code: string; targetValue: number; period?: string; updatedAt: string }> | null>(KPI_KEY, null);
    const defs = stored || [
      { code: 'brands_reached_out', targetValue: 125, period: 'weekly', updatedAt: now },
      { code: 'meetings_booked', targetValue: 10, period: 'monthly', updatedAt: now },
      { code: 'conversions', targetValue: 2, period: 'monthly', updatedAt: now },
    ];
    const brandIdx = defs.findIndex(d => d.code === 'brands_reached_out');
    if (brandIdx >= 0) {
      defs[brandIdx].targetValue = Math.max(0, Math.round(config.brandsPerWorkingDay * 5));
      defs[brandIdx].period = 'weekly';
      defs[brandIdx].updatedAt = now;
    }
    for (const code of ['meetings_booked', 'conversions']) {
      const idx = defs.findIndex(d => d.code === code);
      if (idx >= 0) {
        defs[idx].period = 'monthly';
        defs[idx].updatedAt = now;
      }
    }
    safeWrite(KPI_KEY, defs);
    const targets = safeRead<Record<string, unknown>>('stylique-kpi-targets', {});
    safeWrite('stylique-kpi-targets', { ...targets, brandsPerDay: config.brandsPerWorkingDay });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stylique:kpi-policy-updated'));
    }
  } catch (error) {
    console.warn('[WeeklyKPI] Could not sync weekly target to KPI definitions', error);
  }
}

// ─── Brand Completion Statuses ──────────────────────────

export type BrandStatus = 
  | 'not_started'
  | 'primary_reached'
  | 'secondary_pending'
  | 'secondary_blocked'
  | 'completed'
  | 'paused'
  | 'closed';

export const BRAND_STATUS_LABELS: Record<BrandStatus, string> = {
  not_started: 'Not started',
  primary_reached: 'Second contact needed',
  secondary_pending: 'Second contact needed',
  secondary_blocked: 'Blocked — reason recorded',
  completed: 'Brand complete',
  paused: 'Paused',
  closed: 'Closed',
};

export const BRAND_STATUS_COLORS: Record<BrandStatus, string> = {
  not_started: 'bg-muted text-muted-foreground border-border',
  primary_reached: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  secondary_pending: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  secondary_blocked: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  completed: 'bg-green-500/15 text-green-500 border-green-500/30',
  paused: 'bg-muted text-muted-foreground border-border',
  closed: 'bg-muted text-muted-foreground border-border',
};

// ─── Week Date Helpers ──────────────────────────────────

export function getWeekStartDate(date?: Date): Date {
  const d = new Date(date || new Date());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getWeekDates(weekStart: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) { // Mon-Fri
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(toDateKey(d));
  }
  return dates;
}

function getDayOfWeek(dateKey: string): number {
  return new Date(dateKey + 'T12:00:00').getDay(); // 0=Sun
}

function isWorkingDay(dateKey: string): boolean {
  const dow = getDayOfWeek(dateKey);
  return dow >= 1 && dow <= 5;
}

function isDatePassed(dateKey: string): boolean {
  return dateKey < todayKey();
}

function isDateToday(dateKey: string): boolean {
  return dateKey === todayKey();
}

// ─── Weekly KPI Snapshot ────────────────────────────────

export interface WeeklyBrandSnapshot {
  weekStart: string;
  weekDates: string[];
  /** Total working days in the week */
  totalWorkingDays: number;
  /** Working days with approved leave */
  leaveDays: number;
  /** Effective working days (total - leave if prorated) */
  effectiveWorkingDays: number;
  /** Weekly brand target (may be prorated) */
  weeklyTarget: number;
  /** Brands completed this week (2-contact rule) */
  brandsCompleted: number;
  /** Brands in progress (primary done, secondary pending) */
  brandsInProgress: number;
  /** Brands blocked */
  brandsBlocked: number;
  /** Total brands touched (any contact) */
  brandsTouched: number;
  /** Working days elapsed so far (past + today) */
  daysElapsed: number;
  /** Working days remaining (today counts as remaining) */
  daysRemaining: number;
  /** Expected brands completed by now (pace check) */
  expectedByNow: number;
  /** Brands behind/ahead of pace */
  paceDelta: number;
  /** Required average per remaining working day to hit target */
  requiredPacePerDay: number;
  /** Daily brand counts by date */
  dailyCounts: Record<string, { completed: number; inProgress: number; touched: number }>;
  /** Manager guidance message */
  guidanceMessage: string;
  /** Pacing status */
  pacingStatus: 'on_track' | 'ahead' | 'behind' | 'at_risk' | 'missed';
  /** Brand detail list */
  brandDetails: BrandDetail[];
}

export interface BrandDetail {
  leadId: string;
  companyName: string;
  status: BrandStatus;
  contactsReached: number;
  contactsRequired: number;
  primaryDone: boolean;
  secondaryDone: boolean;
  dayKey: string; // which day this brand was first touched
}

// ─── Core Computation ───────────────────────────────────

/**
 * Compute the weekly brand KPI snapshot for a given SDR.
 * @param sdrId - SDR user ID
 * @param leaveDates - dates with approved leave (YYYY-MM-DD)
 * @param config - weekly KPI configuration
 * @param contactsRequired - contacts required per brand (default 2)
 */
export function computeWeeklyBrandKPI(
  sdrId: string,
  leaveDates: string[] = [],
  config?: WeeklyKPIConfig,
  contactsRequired: number = 2,
): WeeklyBrandSnapshot {
  const cfg = config || getWeeklyKPIConfig();
  const today = todayKey();
  const weekStart = getWeekStartDate();
  const weekStartKey = toDateKey(weekStart);
  const weekDates = getWeekDates(weekStart);

  // Working days calculation
  const totalWorkingDays = weekDates.filter(d => isWorkingDay(d)).length;
  const leaveDaysInWeek = weekDates.filter(d => leaveDates.includes(d)).length;
  const effectiveWorkingDays = cfg.leaveProrationMode === 'prorated'
    ? Math.max(0, totalWorkingDays - leaveDaysInWeek)
    : totalWorkingDays;

  // Weekly target
  const weeklyTarget = Math.ceil(cfg.brandsPerWorkingDay * effectiveWorkingDays);

  // Get all actions for this week
  const allActions = getKPIActions().filter(a => 
    a.sdrId === sdrId && weekDates.includes(a.date)
  );

  // Build brand coverage across the week
  const brandMap = new Map<string, BrandDetail>();
  const dailyCounts: Record<string, { completed: number; inProgress: number; touched: number }> = {};
  
  for (const date of weekDates) {
    dailyCounts[date] = { completed: 0, inProgress: 0, touched: 0 };
  }

  for (const action of allActions) {
    const key = action.leadId;
    if (!brandMap.has(key)) {
      brandMap.set(key, {
        leadId: action.leadId,
        companyName: action.companyName,
        status: 'not_started',
        contactsReached: 0,
        contactsRequired,
        primaryDone: false,
        secondaryDone: false,
        dayKey: action.date,
      });
    }
    const brand = brandMap.get(key)!;
    // Count distinct contacts
    const dayActions = allActions.filter(a => a.leadId === key);
    const distinctContacts = new Set(dayActions.map(a => a.contactName));
    brand.contactsReached = distinctContacts.size;
    brand.primaryDone = brand.contactsReached >= 1;
    brand.secondaryDone = brand.contactsReached >= contactsRequired;
    
    if (brand.secondaryDone) {
      brand.status = 'completed';
    } else if (brand.primaryDone) {
      brand.status = 'primary_reached';
    }
  }

  const brandDetails = Array.from(brandMap.values());
  const brandsCompleted = brandDetails.filter(b => b.status === 'completed').length;
  const brandsInProgress = brandDetails.filter(b => b.status === 'primary_reached' || b.status === 'secondary_pending').length;
  const brandsBlocked = brandDetails.filter(b => b.status === 'secondary_blocked').length;
  const brandsTouched = brandDetails.length;

  // Compute daily counts  
  for (const brand of brandDetails) {
    const dc = dailyCounts[brand.dayKey];
    if (dc) {
      dc.touched++;
      if (brand.status === 'completed') dc.completed++;
      else dc.inProgress++;
    }
  }

  // Pacing calculation
  const pastWorkingDays = weekDates.filter(d => 
    isWorkingDay(d) && isDatePassed(d) && !leaveDates.includes(d)
  ).length;
  const todayIsWorkingDay = weekDates.some(d => isDateToday(d) && isWorkingDay(d) && !leaveDates.includes(d));
  const daysElapsed = pastWorkingDays + (todayIsWorkingDay ? 1 : 0);
  const daysRemaining = Math.max(0, effectiveWorkingDays - pastWorkingDays);
  
  const expectedByNow = daysElapsed > 0 
    ? Math.round(cfg.brandsPerWorkingDay * pastWorkingDays) 
    : 0;
  const paceDelta = brandsCompleted - expectedByNow;
  
  const requiredPacePerDay = daysRemaining > 0
    ? Math.max(0, Math.ceil((weeklyTarget - brandsCompleted) / daysRemaining * 100) / 100)
    : 0;

  // Pacing status
  let pacingStatus: WeeklyBrandSnapshot['pacingStatus'];
  if (daysRemaining === 0 && brandsCompleted >= weeklyTarget) pacingStatus = 'on_track';
  else if (daysRemaining === 0 && brandsCompleted < weeklyTarget) pacingStatus = 'missed';
  else if (paceDelta >= 5) pacingStatus = 'ahead';
  else if (paceDelta >= -3) pacingStatus = 'on_track';
  else if (requiredPacePerDay <= cfg.brandsPerWorkingDay * 1.3) pacingStatus = 'behind';
  else pacingStatus = 'at_risk';

  // Guidance message
  const guidanceMessage = buildGuidanceMessage({
    brandsCompleted, weeklyTarget, daysRemaining, requiredPacePerDay,
    brandsInProgress, paceDelta, pacingStatus, leaveDaysInWeek, effectiveWorkingDays,
    cfg,
  });

  return {
    weekStart: weekStartKey,
    weekDates,
    totalWorkingDays,
    leaveDays: leaveDaysInWeek,
    effectiveWorkingDays,
    weeklyTarget,
    brandsCompleted,
    brandsInProgress,
    brandsBlocked,
    brandsTouched,
    daysElapsed,
    daysRemaining,
    expectedByNow,
    paceDelta,
    requiredPacePerDay,
    dailyCounts,
    guidanceMessage,
    pacingStatus,
    brandDetails,
  };
}

// ─── Guidance Builder ───────────────────────────────────

function buildGuidanceMessage(params: {
  brandsCompleted: number;
  weeklyTarget: number;
  daysRemaining: number;
  requiredPacePerDay: number;
  brandsInProgress: number;
  paceDelta: number;
  pacingStatus: string;
  leaveDaysInWeek: number;
  effectiveWorkingDays: number;
  cfg: WeeklyKPIConfig;
}): string {
  const { brandsCompleted, weeklyTarget, daysRemaining, requiredPacePerDay, 
    brandsInProgress, paceDelta, pacingStatus, leaveDaysInWeek, effectiveWorkingDays, cfg } = params;

  const parts: string[] = [];

  if (weeklyTarget <= 0) return 'No target this week.';

  if (daysRemaining <= 0) {
    if (brandsCompleted >= weeklyTarget) {
      parts.push(`✓ Weekly target met: ${brandsCompleted}/${weeklyTarget} brands completed.`);
    } else {
      parts.push(`Weekly target missed: ${brandsCompleted}/${weeklyTarget} brands completed.`);
    }
    return parts.join(' ');
  }

  if (leaveDaysInWeek > 0 && cfg.leaveProrationMode === 'prorated') {
    parts.push(`Approved leave reduced working days this week. Revised target: ${weeklyTarget} brands across ${effectiveWorkingDays} working days.`);
  }

  const remaining = weeklyTarget - brandsCompleted;

  if (pacingStatus === 'ahead') {
    parts.push(`Ahead by ${Math.abs(paceDelta)} brands. Keep going.`);
  } else if (pacingStatus === 'on_track') {
    parts.push(`On track. ${remaining} brands to go across ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`);
  } else if (pacingStatus === 'behind') {
    parts.push(`Behind by ${Math.abs(paceDelta)} brands. Complete ${Math.ceil(requiredPacePerDay)}/day for ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} to recover.`);
  } else if (pacingStatus === 'at_risk') {
    parts.push(`At risk — need ${Math.ceil(requiredPacePerDay)} brands/day to hit ${weeklyTarget}. Prioritize fastest completions.`);
  }

  if (brandsInProgress > 0) {
    parts.push(`${brandsInProgress} brand${brandsInProgress > 1 ? 's' : ''} still need a second contact to count.`);
  }

  return parts.join(' ');
}

// ─── Attendance/Compensation Policy Engine ──────────────

export interface AttendanceCompPolicy {
  /** Max minor lates per month before deductions start */
  lateGracePeriodCount: number;
  /** Minutes threshold for "minor" late */
  minorLateThresholdMinutes: number;
  /** Deduction per late entry after grace (fixed amount or fraction of daily rate) */
  lateDeductionType: 'fixed' | 'daily_fraction';
  lateDeductionValue: number;
  /** Early leave threshold in minutes before deduction */
  earlyLeaveThresholdMinutes: number;
  /** Deduction per early leave event */
  earlyLeaveDeductionType: 'fixed' | 'daily_fraction';
  earlyLeaveDeductionValue: number;
  /** Absence deduction = 1 full day rate */
  absenceDeductionFullDay: boolean;
  /** Unpaid leave = 1 full day rate deduction */
  unpaidLeaveDeductionFullDay: boolean;
  /** Approved paid leave = no deduction */
  paidLeaveNoDeduction: boolean;
  /** Probation = all leave is unpaid */
  probationAllLeaveUnpaid: boolean;
}

const COMP_POLICY_KEY = 'stylique-attendance-comp-policy';

export const DEFAULT_ATTENDANCE_COMP_POLICY: AttendanceCompPolicy = {
  lateGracePeriodCount: 2, // first 2 lates per month = no deduction
  minorLateThresholdMinutes: 30,
  lateDeductionType: 'daily_fraction',
  lateDeductionValue: 0.1, // 10% of daily rate per late after grace
  earlyLeaveThresholdMinutes: 30,
  earlyLeaveDeductionType: 'daily_fraction',
  earlyLeaveDeductionValue: 0.1,
  absenceDeductionFullDay: true,
  unpaidLeaveDeductionFullDay: true,
  paidLeaveNoDeduction: true,
  probationAllLeaveUnpaid: true,
};

export function getAttendanceCompPolicy(): AttendanceCompPolicy {
  return { ...DEFAULT_ATTENDANCE_COMP_POLICY, ...safeRead<Partial<AttendanceCompPolicy>>(COMP_POLICY_KEY, {}) };
}

export function saveAttendanceCompPolicy(policy: AttendanceCompPolicy) {
  safeWrite(COMP_POLICY_KEY, policy);
}

/**
 * Calculate attendance-based compensation impact for a month.
 */
export function calculateAttendanceCompImpact(
  baseSalary: number,
  workingDaysInMonth: number,
  lateCount: number,
  earlyLeaveCount: number,
  absenceDays: number,
  unpaidLeaveDays: number,
  policy?: AttendanceCompPolicy,
): { totalDeduction: number; lateDeduction: number; earlyLeaveDeduction: number; absenceDeduction: number; unpaidLeaveDeduction: number; details: string[] } {
  const p = policy || getAttendanceCompPolicy();
  const dailyRate = workingDaysInMonth > 0 ? baseSalary / workingDaysInMonth : 0;
  const details: string[] = [];
  
  // Late deductions
  const deductibleLates = Math.max(0, lateCount - p.lateGracePeriodCount);
  let lateDeduction = 0;
  if (deductibleLates > 0) {
    if (p.lateDeductionType === 'fixed') {
      lateDeduction = deductibleLates * p.lateDeductionValue;
    } else {
      lateDeduction = Math.round(deductibleLates * dailyRate * p.lateDeductionValue);
    }
    details.push(`${lateCount} late entries this month (${p.lateGracePeriodCount} grace). ${deductibleLates} deductible.`);
  }

  // Early leave deductions
  let earlyLeaveDeduction = 0;
  if (earlyLeaveCount > 0) {
    if (p.earlyLeaveDeductionType === 'fixed') {
      earlyLeaveDeduction = earlyLeaveCount * p.earlyLeaveDeductionValue;
    } else {
      earlyLeaveDeduction = Math.round(earlyLeaveCount * dailyRate * p.earlyLeaveDeductionValue);
    }
    details.push(`${earlyLeaveCount} early leaves affecting payroll.`);
  }

  // Absence deduction
  const absenceDeduction = p.absenceDeductionFullDay ? Math.round(absenceDays * dailyRate) : 0;
  if (absenceDays > 0) details.push(`${absenceDays} absent day${absenceDays > 1 ? 's' : ''} — full day deduction.`);

  // Unpaid leave deduction
  const unpaidLeaveDeduction = p.unpaidLeaveDeductionFullDay ? Math.round(unpaidLeaveDays * dailyRate) : 0;
  if (unpaidLeaveDays > 0) details.push(`${unpaidLeaveDays} unpaid leave day${unpaidLeaveDays > 1 ? 's' : ''} deducted.`);

  return {
    totalDeduction: lateDeduction + earlyLeaveDeduction + absenceDeduction + unpaidLeaveDeduction,
    lateDeduction,
    earlyLeaveDeduction,
    absenceDeduction,
    unpaidLeaveDeduction,
    details,
  };
}

/**
 * Get pacing status color classes
 */
export function getPacingColor(status: WeeklyBrandSnapshot['pacingStatus']): string {
  switch (status) {
    case 'ahead': return 'bg-green-500/15 text-green-500 border-green-500/30';
    case 'on_track': return 'bg-green-500/15 text-green-500 border-green-500/30';
    case 'behind': return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    case 'at_risk': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case 'missed': return 'bg-destructive/15 text-destructive border-destructive/30';
  }
}

export function getPacingLabel(status: WeeklyBrandSnapshot['pacingStatus']): string {
  // Locked SDR pacing vocabulary: On Track / Behind / Missed (no vague "Needs Review")
  switch (status) {
    case 'ahead': return 'On Track';
    case 'on_track': return 'On Track';
    case 'behind': return 'Behind';
    case 'at_risk': return 'Behind';
    case 'missed': return 'Missed';
  }
}

/**
 * Leadership-friendly status language. Collapses operational nuance into
 * four scannable states: Healthy / On track / Behind / Needs review.
 * Use this on CEO/COO surfaces where SDR detail (pace, 2nd contact) is noise.
 */
export function getLeadershipPacingLabel(status: WeeklyBrandSnapshot['pacingStatus']): string {
  switch (status) {
    case 'ahead': return 'Healthy';
    case 'on_track': return 'On track';
    case 'behind': return 'Behind';
    case 'at_risk': return 'Needs review';
    case 'missed': return 'Needs review';
  }
}

export function getLeadershipPacingColor(status: WeeklyBrandSnapshot['pacingStatus']): string {
  switch (status) {
    case 'ahead':
    case 'on_track':
      return 'bg-green-500/15 text-green-500 border-green-500/30';
    case 'behind':
      return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    case 'at_risk':
    case 'missed':
      return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  }
}
