/**
 * STYLIQUE CRM — KPI Engine
 * 
 * Derives KPI counts from logged actions stored in localStorage.
 * Enforces 2-contact brand coverage rule.
 * Links attendance to KPI interpretation.
 */

import type {
  KPIActionEntry, KPISnapshot, KPITargetConfig,
  ActionKPIMetric, AttendanceRecord, BrandContactRecord,
} from '@/types/kpi';
import { DEFAULT_KPI_TARGETS } from '@/types/kpi';
import { safeRead, safeWrite } from '@/lib/safe-storage';
import { getApiToken, saveStateBucket } from '@/lib/backend-api';

const KEYS = {
  actions: 'stylique-kpi-actions',
  attendance: 'stylique-kpi-attendance',
  targets: 'stylique-kpi-targets',
};

// ─── Persistence ────────────────────────────────────────

function readJSON<T>(key: string): T[] {
  return safeRead<T[]>(key, []);
}

function writeJSON<T>(key: string, data: T[]) {
  safeWrite(key, data);
}

function syncKPIActions(actions: KPIActionEntry[]) {
  if (!getApiToken()) return;
  saveStateBucket('kpi-actions', actions).catch(error => {
    console.warn('[KPI persistence] Could not sync KPI actions', error);
  });
}

// ─── Action Log ─────────────────────────────────────────

export function getKPIActions(): KPIActionEntry[] {
  return readJSON<KPIActionEntry>(KEYS.actions);
}

export function logKPIAction(entry: KPIActionEntry) {
  const actions = getKPIActions();
  // Prevent exact duplicate (same id)
  if (actions.some(a => a.id === entry.id)) return;
  // Deterministic dedupe: if dedupeKey is set, refuse to log a second entry
  // with the same key for the same metric on the same lead. This protects
  // against double-clicks, mirrored handlers (PipelinePage + TasksActivityPage),
  // and dual paths (page handler + engine).
  if (entry.dedupeKey) {
    const collision = actions.some(a =>
      a.dedupeKey === entry.dedupeKey &&
      a.metric === entry.metric &&
      a.leadId === entry.leadId,
    );
    if (collision) {
      console.warn(`[KPI] Dedupe blocked: ${entry.metric} on ${entry.companyName} (key=${entry.dedupeKey})`);
      return;
    }
  }
  actions.push(entry);
  writeJSON(KEYS.actions, actions);
  syncKPIActions(actions);
}

/** Create and log a KPI action entry */
export function recordKPIAction(
  sdrId: string,
  leadId: string,
  companyName: string,
  contactName: string,
  metric: ActionKPIMetric,
  channel: KPIActionEntry['channel'],
  outcome?: string,
  notes?: string,
  dedupeKey?: string,
) {
  const now = new Date();
  logKPIAction({
    id: crypto.randomUUID(),
    sdrId,
    timestamp: now.toISOString(),
    date: toDateKey(now),
    leadId,
    companyName,
    contactName,
    metric,
    channel,
    outcome,
    notes,
    dedupeKey,
  });
}

// ─── Attendance ─────────────────────────────────────────

export function getAttendanceRecords(): AttendanceRecord[] {
  return readJSON<AttendanceRecord>(KEYS.attendance);
}

export function logAttendance(record: AttendanceRecord) {
  const records = getAttendanceRecords();
  // Upsert by sdrId + date
  const idx = records.findIndex(r => r.sdrId === record.sdrId && r.date === record.date);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  writeJSON(KEYS.attendance, records);
}

export function getAttendanceForDate(sdrId: string, date: string): AttendanceRecord | undefined {
  return getAttendanceRecords().find(r => r.sdrId === sdrId && r.date === date);
}

// ─── Targets ────────────────────────────────────────────

export function getKPITargets(): KPITargetConfig {
  return { ...DEFAULT_KPI_TARGETS, ...safeRead<Partial<KPITargetConfig>>(KEYS.targets, {}) };
}

export function saveKPITargets(config: KPITargetConfig) {
  safeWrite(KEYS.targets, config);
}

// ─── Date Helpers ───────────────────────────────────────

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  return toDateKey(d);
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const d = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 5; i++) { // Mon-Fri
    dates.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ─── Brand Coverage ─────────────────────────────────────

export function getBrandCoverage(sdrId: string, date: string): BrandContactRecord[] {
  const actions = getKPIActions().filter(a => a.sdrId === sdrId && a.date === date);
  const brandMap = new Map<string, BrandContactRecord>();

  for (const action of actions) {
    const key = action.leadId;
    if (!brandMap.has(key)) {
      brandMap.set(key, {
        leadId: action.leadId,
        companyName: action.companyName,
        contactsReached: [],
      });
    }
    const brand = brandMap.get(key)!;
    // Only count distinct contacts
    if (!brand.contactsReached.some(c => c.contactName === action.contactName)) {
      brand.contactsReached.push({
        contactName: action.contactName,
        channel: action.channel,
        timestamp: action.timestamp,
        actionId: action.id,
      });
    }
  }

  return Array.from(brandMap.values());
}

/** Count brands where >= contactsPerBrand distinct people have been reached */
export function countCompletedBrands(sdrId: string, date: string, minContacts: number = 2): number {
  const brands = getBrandCoverage(sdrId, date);
  return brands.filter(b => b.contactsReached.length >= minContacts).length;
}

/** Count total distinct people reached */
export function countDistinctPeople(sdrId: string, date: string): number {
  const brands = getBrandCoverage(sdrId, date);
  return brands.reduce((sum, b) => sum + b.contactsReached.length, 0);
}

// ─── KPI Snapshot ───────────────────────────────────────

export function getDailySnapshot(sdrId: string, date?: string): KPISnapshot {
  const d = date || toDateKey(new Date());
  const targets = getKPITargets();
  const attendance = getAttendanceForDate(sdrId, d);
  const actions = getKPIActions().filter(a => a.sdrId === sdrId && a.date === d);

  // Count action metrics
  const actionCounts: Record<ActionKPIMetric, number> = {
    calls_made: 0,
    emails_sent: 0,
    linkedin_actions: 0,
    whatsapp_actions: 0,
    followups_completed: 0,
    replies_received: 0,
    meetings_booked: 0,
    trials_proposed: 0,
    payments_confirmed: 0,
  };
  for (const a of actions) {
    actionCounts[a.metric] = (actionCounts[a.metric] || 0) + 1;
  }

  // Brand counting with 2-contact rule
  const brandsReached = countCompletedBrands(sdrId, d, targets.contactsPerBrand);
  const peopleReached = countDistinctPeople(sdrId, d);

  // Attendance-based target adjustment
  let targetAdjusted = false;
  let adjustedBrandsTarget = targets.brandsPerDay;

  if (attendance) {
    if (targets.attendanceMode === 'prorated') {
      if (attendance.status === 'half_day') {
        adjustedBrandsTarget = Math.ceil(targets.brandsPerDay / 2);
        targetAdjusted = true;
      } else if (attendance.status === 'absent' || attendance.status === 'approved_leave') {
        adjustedBrandsTarget = 0;
        targetAdjusted = true;
      }
    } else if (targets.attendanceMode === 'exempt') {
      if (attendance.status === 'absent' || attendance.status === 'approved_leave') {
        adjustedBrandsTarget = 0;
        targetAdjusted = true;
      }
    }
  }

  return {
    sdrId,
    period: 'day',
    date: d,
    brandsReached,
    brandsTarget: adjustedBrandsTarget,
    peopleReached,
    peopleTarget: adjustedBrandsTarget * targets.contactsPerBrand,
    actions: actionCounts,
    attendance: attendance?.status,
    targetAdjusted,
    adjustedBrandsTarget: targetAdjusted ? adjustedBrandsTarget : undefined,
  };
}

export function getWeeklySnapshot(sdrId: string, weekStart?: string): KPISnapshot {
  const ws = weekStart || getWeekStart(new Date());
  const dates = getWeekDates(ws);
  const dailies = dates.map(d => getDailySnapshot(sdrId, d));

  const combined: KPISnapshot = {
    sdrId,
    period: 'week',
    date: ws,
    brandsReached: dailies.reduce((s, d) => s + d.brandsReached, 0),
    brandsTarget: dailies.reduce((s, d) => s + d.brandsTarget, 0),
    peopleReached: dailies.reduce((s, d) => s + d.peopleReached, 0),
    peopleTarget: dailies.reduce((s, d) => s + d.peopleTarget, 0),
    actions: { ...dailies[0].actions },
    targetAdjusted: dailies.some(d => d.targetAdjusted),
  };

  // Sum action metrics across days
  const metrics: ActionKPIMetric[] = Object.keys(combined.actions) as ActionKPIMetric[];
  for (const m of metrics) {
    combined.actions[m] = dailies.reduce((s, d) => s + d.actions[m], 0);
  }

  return combined;
}

/** Today's date key */
export function todayKey(): string {
  return toDateKey(new Date());
}
