/**
 * STYLIQUE CRM — Leadership Risk Engine
 *
 * Single source of truth for what counts as a leadership-level risk.
 * Used by RisksPage and Command Center so they never disagree.
 *
 * Strict eligibility rules (anything not matching is NOT a leadership risk):
 *
 * CRITICAL
 *  - Overdue payment tied to current revenue
 *  - Trial expiring today/tomorrow with real conversion value at risk
 *  - Active client churn / cancellation risk
 *
 * HIGH
 *  - Approved trial blocked because credentials missing
 *  - Trial ending soon (≤5d) with no meeting / no conversion step in progress
 *  - Onboarding blocked past SLA (>3d in same step)
 *  - Repeated absence affecting active pipeline
 *
 * MEDIUM
 *  - Unresolved meeting outcome on a high-value account (>48h overdue)
 *  - Repeated attendance problem after threshold breached (3+ absences in 14d)
 *  - Unresolved follow-up gap on a high-priority opportunity (≥7d stuck)
 *
 * Explicitly NOT leadership risks:
 *  - One person absent today
 *  - One normal meeting outcome missing
 *  - One SDR not checked in
 *  - One "brand in progress"
 *  - One secondary contact pending
 *  - Normal SDR/onboarding workflow items
 */

import type { Lead } from '@/types/crm';
import { TEAM_MEMBERS, getTrialDaysLeft, getPaymentDaysUntilDue, PLAN_PRICES } from '@/types/crm';
import { getCanonicalState } from '@/engine/canonical-state';
import { TEAM } from '@/types/roles';
import { deriveAttendanceStatus, useAttendance } from '@/lib/attendance-store';
import { useEmployees } from '@/lib/employee-store';

type AttendanceStoreValue = ReturnType<typeof useAttendance>;
type EmployeeStoreValue = ReturnType<typeof useEmployees>;

/** Safe date parser — returns null for missing/invalid timestamps. */
function safeDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Find next upcoming meeting for a lead (if any). */
function getNextMeeting(lead: Lead) {
  if (!lead.meetingNotes || lead.meetingNotes.length === 0) return null;
  const now = Date.now();
  return lead.meetingNotes.find(m => {
    const d = safeDate(m.date);
    return d ? d.getTime() > now : false;
  }) || null;
}

/** Find most recent past meeting that has no outcome logged. */
function getUnresolvedPastMeeting(lead: Lead) {
  if (!lead.meetingNotes || lead.meetingNotes.length === 0) return null;
  const now = Date.now();
  const past = lead.meetingNotes
    .filter(m => {
      const d = safeDate(m.date);
      return d ? d.getTime() < now && !m.outcome : false;
    })
    .sort((a, b) => (safeDate(b.date)?.getTime() ?? 0) - (safeDate(a.date)?.getTime() ?? 0));
  return past[0] || null;
}

/** Days a lead has spent in its current stage (uses updatedAt as best-available proxy). */
function daysInCurrentStage(lead: Lead): number {
  const ref = safeDate(lead.updatedAt) || safeDate(lead.createdAt);
  if (!ref) return 0;
  return Math.floor((Date.now() - ref.getTime()) / 86400000);
}

export type RiskSeverity = 'critical' | 'high' | 'medium';
export type RiskType =
  | 'payment_overdue'
  | 'trial_expiring'
  | 'churn_risk'
  | 'credentials_blocking'
  | 'trial_at_risk'
  | 'onboarding_stalled'
  | 'meeting_outcome_overdue'
  | 'repeat_attendance'
  | 'opportunity_stuck';

export interface LeadershipRisk {
  id: string;
  type: RiskType;
  severity: RiskSeverity;
  /** Plain business title — “Payment overdue — Acme Co” */
  title: string;
  /** One-line commercial/operational reason it matters */
  reason: string;
  /** Owner first name */
  owner: string;
  /** What unlocks it — single recommended next action */
  unlock: string;
  /** Optional time pressure label, e.g. "5d overdue", "2d left" */
  timePressure?: string;
  /** Optional revenue at stake, in USD/month */
  amount?: number;
  /** Linked lead, if any */
  lead: Lead | null;
}

interface ComputeArgs {
  leads: Lead[];
  attendance?: AttendanceStoreValue;
  employees?: EmployeeStoreValue;
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = { critical: 0, high: 1, medium: 2 };

function ownerName(lead: Lead): string {
  return TEAM_MEMBERS.find(m => m.id === lead.assignedTo)?.name?.split(' ')[0] || '—';
}

/**
 * Action owner = the role/person who must perform the next step to resolve the risk.
 * This is what should appear on Risks cards — not the sales owner, not "Leadership"
 * just because leadership can see it.
 */
function actionOwnerLabel(lead: Lead): string {
  const cs = getCanonicalState(lead);
  switch (cs.next_action_owner_role) {
    case 'onboarding': {
      const id = lead.assigned_onboarding_owner || 'muneeb';
      return TEAM_MEMBERS.find(m => m.id === id)?.name?.split(' ')[0] || 'Onboarding';
    }
    case 'leadership':
      return 'Leadership';
    case 'automation':
      return 'Automation';
    case 'sdr':
    default:
      return ownerName(lead);
  }
}

function isHighValuePlan(lead: Lead): boolean {
  const plan = lead.subscriptionPlan || 'starter';
  return plan === 'growth' || plan === 'enterprise';
}

/**
 * Compute the full prioritized list of leadership-level risks.
 * Sorted critical → high → medium, then by amount desc.
 */
export function computeLeadershipRisks({ leads, attendance, employees }: ComputeArgs): LeadershipRisk[] {
  const risks: LeadershipRisk[] = [];

  for (const lead of leads) {
    const cs = getCanonicalState(lead);
    const owner = ownerName(lead);
    const plan = lead.subscriptionPlan || 'starter';
    const mrr = PLAN_PRICES[plan] || 0;

    // CRITICAL — Payment overdue
    if (cs.commercial_stage === 'overdue') {
      const days = getPaymentDaysUntilDue(lead);
      const overdueDays = days !== null ? Math.abs(Math.min(days, 0)) : 0;
      risks.push({
        id: `pay-${lead.id}`,
        type: 'payment_overdue',
        severity: 'critical',
        title: `Payment overdue — ${lead.companyName}`,
        reason: `$${mrr}/mo · ${overdueDays}d past due · no proof submitted`,
        owner,
        unlock: 'Escalate or follow up — do not confirm without proof',
        timePressure: `${overdueDays}d overdue`,
        amount: mrr,
        lead,
      });
      continue;
    }

    // Decision overdue with commercial value
    if (cs.trial_stage === 'expired') {
      risks.push({
        id: `trial-exp-${lead.id}`,
        type: 'trial_expiring',
        severity: 'critical',
        title: `Decision overdue — ${lead.companyName}`,
        reason: `$${mrr}/mo · decision missing`,
        owner,
        unlock: 'Record decision',
        amount: mrr,
        lead,
      });
      continue;
    }
    if (cs.trial_stage === 'ending') {
      const dl = getTrialDaysLeft(lead);
      if (dl !== null && dl <= 1) {
        risks.push({
          id: `trial-ending-${lead.id}`,
          type: 'trial_expiring',
          severity: 'critical',
          title: `Trial ends in ${dl}d — ${lead.companyName}`,
          reason: `$${mrr}/mo · last chance to convert`,
          owner,
          unlock: 'Schedule conversion call today',
          timePressure: `${dl}d left`,
          amount: mrr,
          lead,
        });
        continue;
      }
    }

    // CRITICAL — Active client churn risk (no contact for 30+ days on paid client)
    if (cs.lifecycle_stage === 'converted' && cs.days_since_contact >= 30) {
      risks.push({
        id: `churn-${lead.id}`,
        type: 'churn_risk',
        severity: 'critical',
        title: `Churn risk — ${lead.companyName}`,
        reason: `Active client · no contact in ${cs.days_since_contact}d`,
        owner,
        unlock: 'Schedule retention check-in',
        timePressure: `${cs.days_since_contact}d silent`,
        amount: mrr,
        lead,
      });
      continue;
    }

    // HIGH — Trial Ready to Start, blocked by missing credentials (canonical bucket).
    if (cs.trial_stage === 'needs_credentials') {
      risks.push({
        id: `cred-${lead.id}`,
        type: 'credentials_blocking',
        severity: 'high',
        title: `Ready to start — blocked by missing credentials — ${lead.companyName}`,
        reason: 'Trial approved · activation waiting on credentials',
        owner: actionOwnerLabel(lead),
        unlock: 'Onboarding to collect and add credentials',
        amount: mrr,
        lead,
      });
      continue;
    }

    // HIGH — Trial ending soon (≤5d) with no scheduled meeting / conversion step
    if (cs.trial_stage === 'ending') {
      const dl = getTrialDaysLeft(lead);
      if (dl !== null && dl <= 5 && dl > 1) {
        const hasUpcomingMeeting = !!getNextMeeting(lead);
        const inConversion = cs.lifecycle_stage === 'conversion_pending';
        if (!hasUpcomingMeeting && !inConversion) {
          risks.push({
            id: `trial-risk-${lead.id}`,
            type: 'trial_at_risk',
            severity: 'high',
            title: `Decision due in ${dl}d — ${lead.companyName}`,
            reason: `$${mrr}/mo · decision pending`,
            owner,
            unlock: 'Record decision',
            timePressure: `${dl}d left`,
            amount: mrr,
            lead,
          });
          continue;
        }
      }
    }

    // HIGH — Onboarding stalled (ready to activate >3d, credentials present but activation not started)
    if (cs.trial_stage === 'ready_to_activate') {
      const updated = safeDate(lead.updatedAt);
      const approvedDays = updated
        ? Math.floor((Date.now() - updated.getTime()) / 86400000)
        : 0;
      if (approvedDays > 3) {
        risks.push({
          id: `onb-stall-${lead.id}`,
          type: 'onboarding_stalled',
          severity: 'high',
          title: `Activation stalled — ${lead.companyName}`,
          reason: `Approved ${approvedDays}d ago · setup not started`,
          owner: 'Onboarding',
          unlock: 'Complete trial setup',
          timePressure: `${approvedDays}d waiting`,
          lead,
        });
        continue;
      }
    }

    // MEDIUM — Unresolved meeting outcome on high-value account (>48h overdue)
    const unresolvedMeeting = getUnresolvedPastMeeting(lead);
    if (unresolvedMeeting && isHighValuePlan(lead)) {
      const meetingDate = safeDate(unresolvedMeeting.date);
      if (meetingDate) {
        const hoursPast = (Date.now() - meetingDate.getTime()) / 3600000;
        if (hoursPast > 48) {
          risks.push({
            id: `meet-${lead.id}`,
            type: 'meeting_outcome_overdue',
            severity: 'medium',
            title: `Meeting outcome missing — ${lead.companyName}`,
            reason: `$${mrr}/mo deal · result not added`,
            owner,
            unlock: 'Add meeting result to advance stage',
            timePressure: `${Math.floor(hoursPast / 24)}d overdue`,
            amount: mrr,
            lead,
          });
          continue;
        }
      }
    }

    // MEDIUM — Stuck high-priority opportunity (>=7d in same stage, hot priority)
    const stageAge = daysInCurrentStage(lead);
    if (lead.priority === 'high' && stageAge >= 7 &&
        (cs.lifecycle_stage === 'meeting_completed' || cs.lifecycle_stage === 'conversion_pending')) {
      risks.push({
        id: `stuck-${lead.id}`,
        type: 'opportunity_stuck',
        severity: 'medium',
        title: `Hot deal stuck — ${lead.companyName}`,
        reason: `${stageAge}d at ${cs.status_label || cs.lifecycle_stage.replace(/_/g, ' ')}`,
        owner,
        unlock: 'Review and advance or close',
        timePressure: `${stageAge}d stuck`,
        amount: mrr,
        lead,
      });
    }
  }

  // MEDIUM — Repeated attendance problem (3+ absences in last 14 days for non-exempt staff)
  if (attendance && employees) {
    const requiredStaff = TEAM.filter(m => m.role === 'sdr' || m.role === 'onboarding');
    for (const m of requiredStaff) {
      const emp = employees.getEmployee(m.id);
      if (emp?.attendanceExempt) continue;

      let absences = 0;
      for (let i = 0; i < 14; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const entry = attendance.getForDate(m.id, key);
        const derived = deriveAttendanceStatus(entry, emp?.shiftStart, emp?.shiftEnd, emp?.graceMinutes, emp?.timezone);
        if (derived.status === 'absent') absences++;
      }

      if (absences >= 3) {
        risks.push({
          id: `att-${m.id}`,
          type: 'repeat_attendance',
          severity: 'medium',
          title: `${m.name} — repeated absence`,
          reason: `${absences} absences in last 14 days`,
          owner: m.name.split(' ')[0],
          unlock: 'Review attendance with team member',
          lead: null,
        });
      }
    }
  }

  return risks.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return (b.amount || 0) - (a.amount || 0);
  });
}

/** Quick severity counts for header badges. */
export function countRisksBySeverity(risks: LeadershipRisk[]) {
  return {
    critical: risks.filter(r => r.severity === 'critical').length,
    high: risks.filter(r => r.severity === 'high').length,
    medium: risks.filter(r => r.severity === 'medium').length,
    total: risks.length,
  };
}
