/**
 * STYLIQUE CRM — KPI Types
 * 
 * Three-layer KPI system:
 *   1. Brand KPI — 25 brands/day, counted only when 2-contact rule satisfied
 *   2. Contact KPI — minimum 2 distinct people per brand (50/day)
 *   3. Action KPI — calls, emails, LinkedIn, WhatsApp, meetings, etc.
 */

// ─── Attendance ─────────────────────────────────────────

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'approved_leave' | 'late';

export interface AttendanceRecord {
  id: string;
  sdrId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
}

// ─── KPI Targets ────────────────────────────────────────

export type KPITargetMode = 'strict' | 'prorated' | 'exempt';

export interface KPITargetConfig {
  /** Brands per day — default 25 */
  brandsPerDay: number;
  /** Min contacts per brand for completion — default 2 */
  contactsPerBrand: number;
  /** How attendance affects targets */
  attendanceMode: KPITargetMode;
  /** Per-metric overrides (optional) */
  metricTargets?: Partial<Record<ActionKPIMetric, number>>;
}

export const DEFAULT_KPI_TARGETS: KPITargetConfig = {
  brandsPerDay: 25,
  contactsPerBrand: 2,
  attendanceMode: 'strict',
};

// ─── Action KPI Metrics ─────────────────────────────────

export type ActionKPIMetric =
  | 'calls_made'
  | 'emails_sent'
  | 'linkedin_actions'
  | 'whatsapp_actions'
  | 'followups_completed'
  | 'replies_received'
  | 'meetings_booked'
  | 'trials_proposed'
  | 'payments_confirmed';

export const ACTION_KPI_LABELS: Record<ActionKPIMetric, string> = {
  calls_made: 'Calls Made',
  emails_sent: 'Emails Sent',
  linkedin_actions: 'LinkedIn Actions',
  whatsapp_actions: 'WhatsApp Actions',
  followups_completed: 'Follow-ups',
  replies_received: 'Replies Received',
  meetings_booked: 'Meetings Booked',
  trials_proposed: 'Client Reviews',
  payments_confirmed: 'Payments Confirmed',
};

// ─── KPI Action Log Entry ───────────────────────────────
// Every logged outcome creates one of these

export interface KPIActionEntry {
  id: string;
  sdrId: string;
  timestamp: string;
  date: string; // YYYY-MM-DD for bucketing
  leadId: string;
  companyName: string;
  contactName: string;
  /** Which metric this counts toward */
  metric: ActionKPIMetric;
  /** Channel used */
  channel: 'call' | 'email' | 'linkedin' | 'whatsapp' | 'meeting' | 'system';
  /** Outcome label */
  outcome?: string;
  notes?: string;
  /**
   * Deterministic deduplication key. When set, kpi-engine will refuse to log
   * a second entry with the same key inside the dedupe window for this metric.
   *
   * Format convention (recommended):
   *   `${leadId}:${metric}:${bucket}` where bucket is a date or short
   *   timestamp window (e.g. YYYY-MM-DD for daily metrics, YYYY-MM-DDTHH for
   *   hourly, or a stable outcome id for one-shot lifecycle events).
   */
  dedupeKey?: string;
}

// ─── Brand Coverage Tracking ────────────────────────────

export interface BrandContactRecord {
  leadId: string;
  companyName: string;
  /** Distinct contacts reached under this brand */
  contactsReached: Array<{
    contactName: string;
    channel: string;
    timestamp: string;
    actionId: string; // links to KPIActionEntry
  }>;
}

// ─── Computed KPI Snapshot ───────────────────────────────

export interface KPISnapshot {
  sdrId: string;
  period: 'day' | 'week';
  date: string; // YYYY-MM-DD or week start
  /** Brands fully worked (2-contact rule met) */
  brandsReached: number;
  brandsTarget: number;
  /** Distinct people contacted */
  peopleReached: number;
  peopleTarget: number;
  /** Action metrics */
  actions: Record<ActionKPIMetric, number>;
  /** Attendance for the period */
  attendance?: AttendanceStatus;
  /** Whether target is adjusted */
  targetAdjusted: boolean;
  adjustedBrandsTarget?: number;
}
