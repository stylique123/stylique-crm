/**
 * STYLIQUE CRM — Unified Lifecycle Selectors
 * 
 * THE SINGLE IMPORT for ALL pages. No page may compute its own stage/status logic.
 * 
 * Two-layer model:
 *   A. Primary lifecycle stage (one at a time)
 *   B. Secondary operational status (decorates the stage)
 * 
 * Every badge, counter, card, filter, and decision panel must use these selectors.
 */

import type { Lead, DealTask } from '@/types/crm';
import {
  TEAM_MEMBERS, PLAN_PRICES, STAGE_LABELS,
  getTrialDaysLeft, getPaymentDaysUntilDue, hasValidCredentials,
  CONVERTED_STAGES, CLOSED_STAGES,
} from '@/types/crm';

// Re-export everything from lifecycle-engine so pages only need ONE import
export {
  getCompanyState, getCompanyStatus, getEscalation,
  getPageCounts, getStageNextAction, getLifecyclePosition,
  isRevenueRisk, isValidTransition, getValidNextStages, canActivateTrial,
  type CompanyState, type CompanyFlags, type LifecycleStatus,
  type PageCounts, type EscalationInfo, type LifecyclePosition,
  type TrialSetupStatus, type CanonicalPaymentStatus, type OnboardingStatus,
  CANONICAL_STAGES, CANONICAL_STAGE_LABELS,
} from './lifecycle-engine';

import { getCompanyState, getPageCounts, type CompanyState, type PageCounts } from './lifecycle-engine';

// ═══════════════════════════════════════════════════════════
// A. PRIMARY LIFECYCLE STAGE
// ═══════════════════════════════════════════════════════════

export type PrimaryStage =
  | 'new_lead'
  | 'contacted'
  | 'replied'
  | 'meeting_booked'
  | 'trial_proposed'
  | 'trial_active'
  | 'converted'
  | 'closed_lost';

const STAGE_TO_PRIMARY: Record<string, PrimaryStage> = {
  'new-lead': 'new_lead',
  'lead-added': 'new_lead',
  'new-inquiry': 'new_lead',
  'ai-new-lead': 'new_lead',
  'pending-enrichment': 'new_lead',
  'pending-apollo': 'new_lead',
  'ready-for-outreach': 'new_lead',
  'sdr-new-lead': 'new_lead',
  'inbound-new': 'new_lead',
  'contacted': 'contacted',
  'outreach-1': 'contacted',
  'outreach-2': 'contacted',
  'outreach-3': 'contacted',
  'sequence-completed': 'contacted',
  'qualified': 'contacted',
  'awaiting-sdr': 'contacted',
  'email-sent-d0': 'contacted',
  'followup-1-d3': 'contacted',
  'followup-2-d7': 'contacted',
  'followup-3-d14': 'contacted',
  'round4-d17': 'contacted',
  'sdr-contacted': 'contacted',
  'inbound-qualified': 'contacted',
  'inbound-awaiting-sdr': 'contacted',
  'replied': 'replied',
  'sdr-replied': 'replied',
  'meeting-booked': 'meeting_booked',
  'meeting-completed': 'meeting_booked',
  'trial-proposed': 'trial_proposed',
  'trial-active': 'trial_active',
  'payment-pending': 'trial_active',
  'converted': 'converted',
  'closed-lost': 'closed_lost',
  'inbound-disqualified': 'closed_lost',
};

export function getLifecycleStage(lead: Lead): PrimaryStage {
  return STAGE_TO_PRIMARY[lead.stage] || 'new_lead';
}

// ═══════════════════════════════════════════════════════════
// B. SECONDARY OPERATIONAL STATUS
// ═══════════════════════════════════════════════════════════

export type OperationalStatus =
  | 'none'
  | 'needs_approval'
  | 'needs_credentials'
  | 'needs_approval_and_credentials'
  | 'ready_to_activate'
  | 'trial_running'
  | 'trial_ending'
  | 'payment_pending'
  | 'payment_overdue'
  | 'waiting_on_client'
  | 'needs_follow_up';

export function getOperationalStatus(lead: Lead): OperationalStatus {
  const s = getCompanyState(lead);

  // Use canonical substatus fields — single source of truth
  if (lead.stage === 'trial-proposed') {
    switch (s.trialSetupStatus) {
      case 'ready_to_activate': return 'ready_to_activate';
      case 'needs_approval_and_credentials': return 'needs_approval_and_credentials';
      case 'needs_approval': return 'needs_approval';
      case 'needs_credentials': return 'needs_credentials';
      default: return 'ready_to_activate';
    }
  }

  if (lead.stage === 'trial-active') {
    if (s.trialSetupStatus === 'ending' || s.trialSetupStatus === 'ended') return 'trial_ending';
    return 'trial_running';
  }

  if (lead.stage === 'payment-pending') {
    if (s.canonicalPaymentStatus === 'overdue') return 'payment_overdue';
    return 'payment_pending';
  }

  if (lead.stage === 'converted') {
    if (s.canonicalPaymentStatus === 'overdue') return 'payment_overdue';
    return 'none';
  }

  // Prospecting stages (including new 3-flow stages)
  const prospectingStages = [
    'contacted', 'outreach-1', 'outreach-2', 'outreach-3', 'sequence-completed', 'qualified', 'awaiting-sdr',
    'sdr-contacted', 'inbound-qualified', 'inbound-awaiting-sdr',
    'email-sent-d0', 'followup-1-d3', 'followup-2-d7', 'followup-3-d14', 'round4-d17',
  ];
  if (prospectingStages.includes(lead.stage)) {
    if (s.daysSinceContact >= 4) return 'needs_follow_up';
    return 'waiting_on_client';
  }

  return 'none';
}

// ═══════════════════════════════════════════════════════════
// BADGE SELECTORS — exactly 1 primary + 1 secondary badge
// ═══════════════════════════════════════════════════════════

export interface BadgeInfo {
  label: string;
  color: string; // tailwind class
  variant: 'default' | 'outline' | 'destructive' | 'secondary';
}

const PRIMARY_BADGE_MAP: Record<PrimaryStage, BadgeInfo> = {
  new_lead: { label: 'New Lead', color: 'text-foreground', variant: 'secondary' },
  contacted: { label: 'Contacted', color: 'text-foreground', variant: 'secondary' },
  replied: { label: 'Replied', color: 'text-warning', variant: 'outline' },
  meeting_booked: { label: 'Meeting Booked', color: 'text-primary', variant: 'outline' },
  trial_proposed: { label: 'Trial Proposed', color: 'text-warning', variant: 'outline' },
  trial_active: { label: 'Trial Active', color: 'text-success', variant: 'outline' },
  converted: { label: 'Client', color: 'text-success', variant: 'default' },
  closed_lost: { label: 'Closed', color: 'text-muted-foreground', variant: 'secondary' },
};

export function getVisiblePrimaryBadge(lead: Lead): BadgeInfo {
  const primary = getLifecycleStage(lead);
  // Override for payment-pending specifically
  if (lead.stage === 'payment-pending') {
    return { label: 'Payment Pending', color: 'text-warning', variant: 'outline' };
  }
  return PRIMARY_BADGE_MAP[primary];
}

const OPERATIONAL_BADGE_MAP: Record<OperationalStatus, BadgeInfo | null> = {
  none: null,
  needs_approval: { label: 'Needs approval', color: 'text-warning', variant: 'outline' },
  needs_credentials: { label: 'Needs credentials', color: 'text-warning', variant: 'outline' },
  needs_approval_and_credentials: { label: 'Needs approval + credentials', color: 'text-warning', variant: 'outline' },
  ready_to_activate: { label: 'Ready to activate', color: 'text-success', variant: 'default' },
  trial_running: null, // primary badge is sufficient
  trial_ending: { label: 'Ending soon', color: 'text-destructive', variant: 'outline' },
  payment_pending: null, // primary badge covers it
  payment_overdue: { label: 'Overdue', color: 'text-destructive', variant: 'destructive' },
  waiting_on_client: null,
  needs_follow_up: { label: 'Follow up', color: 'text-warning', variant: 'outline' },
};

export function getVisibleSecondaryBadge(lead: Lead): BadgeInfo | null {
  const opStatus = getOperationalStatus(lead);
  const badge = OPERATIONAL_BADGE_MAP[opStatus];

  // Add days-left risk badge for trial_ending
  if (opStatus === 'trial_ending') {
    const daysLeft = getTrialDaysLeft(lead);
    if (daysLeft !== null && daysLeft <= 0) {
      return { label: 'Expired', color: 'text-destructive', variant: 'destructive' };
    }
    if (daysLeft !== null) {
      return { label: `${daysLeft}d left`, color: 'text-destructive', variant: 'outline' };
    }
  }

  return badge;
}

// ═══════════════════════════════════════════════════════════
// NEXT REQUIRED ACTION — role-aware
// ═══════════════════════════════════════════════════════════

export type ViewerRole = 'sdr' | 'onboarding' | 'ceo' | 'coo';

export function getNextRequiredAction(lead: Lead, viewerRole: ViewerRole): string {
  const opStatus = getOperationalStatus(lead);
  const s = getCompanyState(lead);

  switch (lead.stage) {
    // Inbound stages
    case 'inbound-new':
      if (viewerRole === 'sdr') return 'New inquiry';
      return 'New inbound inquiry';
    case 'inbound-qualified':
      if (viewerRole === 'sdr') return 'Schedule meeting';
      return 'Awaiting SDR';
    case 'inbound-awaiting-sdr':
      if (viewerRole === 'sdr') return 'No outreach yet';
      return 'Awaiting SDR follow-up';
    case 'inbound-disqualified':
      return 'Disqualified';

    // SDR Manual stages
    case 'sdr-new-lead': case 'new-lead': case 'lead-added': case 'new-inquiry':
      if (viewerRole === 'sdr') return 'No outreach yet';
      if (viewerRole === 'ceo' || viewerRole === 'coo') return 'Waiting on SDR outreach';
      return '—';

    case 'sdr-contacted': case 'contacted':
    case 'outreach-1': case 'outreach-2': case 'outreach-3':
    case 'sequence-completed': case 'awaiting-sdr':
      if (viewerRole === 'sdr') return s.daysSinceContact >= 4 ? `Follow up — ${s.daysSinceContact}d since contact` : 'Waiting for reply';
      return '—';

    case 'sdr-replied': case 'replied':
      if (viewerRole === 'sdr') return `Schedule meeting`;
      return '—';

    case 'meeting-booked':
      if (viewerRole === 'sdr') {
        const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
        return pastNoSummary ? 'Meeting result missing' : 'Meeting scheduled';
      }
      return '—';

    case 'trial-proposed':
      if (opStatus === 'ready_to_activate') {
        if (viewerRole === 'onboarding') return `Done & verified`;
        if (viewerRole === 'ceo' || viewerRole === 'coo') return 'Onboarding queue';
        return 'Waiting for activation';
      }
      if (viewerRole === 'ceo' || viewerRole === 'coo') {
        if (opStatus === 'needs_approval' || opStatus === 'needs_approval_and_credentials') return `Client review`;
        return 'Waiting for credentials';
      }
      if (viewerRole === 'onboarding') {
        // Onboarding never enters credentials — always shown as waiting.
        if (opStatus === 'needs_credentials' || opStatus === 'needs_approval_and_credentials') return `Waiting for credentials — ${lead.companyName}`;
        return 'Waiting for approval';
      }
      return 'Setup in progress';

    case 'trial-active': {
      const daysLeft = getTrialDaysLeft(lead);
      if (viewerRole === 'onboarding') {
        const nextTask = getNextOnboardingTaskForLead(lead);
        if (nextTask) {
          const taskDue = new Date(nextTask.dueDate);
          const isToday = taskDue <= new Date(new Date().setHours(23, 59, 59, 999));
          return isToday ? nextTask.title : `Next check-in scheduled`;
        }
        return 'Trial on track — monitoring';
      }
      if (viewerRole === 'sdr') {
        if (daysLeft !== null && daysLeft <= 5) return `Decision due in ${daysLeft}d`;
        return 'Trial running — no action';
      }
      if (viewerRole === 'ceo' || viewerRole === 'coo') {
        if (daysLeft !== null && daysLeft <= 3) return `Decision due in ${daysLeft}d`;
        return 'Trial running';
      }
      return 'Trial running';
    }

    case 'payment-pending':
      if (viewerRole === 'ceo' || viewerRole === 'coo') return 'Confirm payment';
      if (viewerRole === 'sdr') return 'Awaiting payment';
      return 'Waiting for payment';

    case 'converted':
      if (s.flags.payment_overdue) {
        if (viewerRole === 'ceo' || viewerRole === 'coo') return 'Payment overdue';
        return 'Payment overdue';
      }
      return 'Active client';

    case 'closed-lost':
      return 'Closed';

    default:
      return '—';
  }
}

function getNextOnboardingTaskForLead(lead: Lead): DealTask | null {
  return (lead.tasks || [])
    .filter(t => !t.completed && t.state !== 'cancelled' && t.assignedTo === 'muneeb')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null;
}

// ═══════════════════════════════════════════════════════════
// COUNTERS — single source, role-aware
// ═══════════════════════════════════════════════════════════

export interface UnifiedCounters {
  total: number;
  newLeads: number;
  prospecting: number;
  replied: number;
  meetingsBooked: number;
  trialsTotal: number;
  trialsActive: number;
  trialsSetup: number;
  trialsReadyToActivate: number;
  trialsEnding: number;
  paymentsPending: number;
  paymentsOverdue: number;
  activeClients: number;
  closedLost: number;
  paidRevenue: number;
  pendingRevenue: number;
  overdueRevenue: number;
}

export function getCounters(leads: Lead[]): UnifiedCounters {
  const pc = getPageCounts(leads);
  return {
    total: pc.total,
    newLeads: pc.newLeads,
    prospecting: pc.prospecting,
    replied: pc.replied,
    meetingsBooked: pc.meetingsBooked,
    trialsTotal: pc.trialsTotal,
    trialsActive: pc.trialsActive,
    trialsSetup: pc.trialsSetupPending,
    trialsReadyToActivate: pc.trialsReadyToActivate,
    trialsEnding: pc.trialsEndingSoon + pc.trialsExpired,
    paymentsPending: pc.paymentsPending,
    paymentsOverdue: pc.paymentsOverdue,
    activeClients: pc.activeClients,
    closedLost: pc.closedLost,
    paidRevenue: pc.paidRevenue,
    pendingRevenue: pc.pendingRevenue,
    overdueRevenue: pc.overdueRevenue,
  };
}

// ═══════════════════════════════════════════════════════════
// ROLE-VISIBLE COMPANIES
// ═══════════════════════════════════════════════════════════

export function getRoleVisibleCompanies(
  leads: Lead[],
  viewerRole: ViewerRole,
  viewerUser: string
): Lead[] {
  switch (viewerRole) {
    case 'sdr':
      return leads.filter(l => l.assignedTo === viewerUser);
    case 'onboarding':
      // Onboarding sees ONLY trial-proposed and trial-active — NOT payment or sales
      return leads.filter(l => ['trial-proposed', 'trial-active'].includes(l.stage));
    case 'ceo':
    case 'coo':
      // Leadership sees everything
      return leads;
  }
}

// ═══════════════════════════════════════════════════════════
// ROLE-VISIBLE TASKS
// ═══════════════════════════════════════════════════════════

export function getRoleVisibleTasks(
  leads: Lead[],
  viewerRole: ViewerRole,
  viewerUser: string
): DealTask[] {
  const tasks: DealTask[] = [];
  const visibleLeads = getRoleVisibleCompanies(leads, viewerRole, viewerUser);

  for (const lead of visibleLeads) {
    const leadTasks = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled');
    for (const task of leadTasks) {
      switch (viewerRole) {
        case 'sdr':
          // SDRs see their own tasks EXCEPT onboarding/check-in (Muneeb's)
          if (task.assignedTo === viewerUser && !['onboarding', 'check-in'].includes(task.type)) {
            tasks.push(task);
          }
          break;
        case 'onboarding':
          // Onboarding sees ONLY onboarding + check-in — NEVER conversion/payment/SDR tasks
          if (['onboarding', 'check-in'].includes(task.type)) {
            tasks.push(task);
          }
          break;
        case 'ceo':
        case 'coo':
          // Leadership sees ONLY payment and trial-end escalations — NEVER SDR outreach or conversion-push
          if (['payment', 'trial-end'].includes(task.type)) {
            tasks.push(task);
          }
          break;
      }
    }
  }

  return tasks;
}

// ═══════════════════════════════════════════════════════════
// CLIENT STATUS — unified (replaces ConversionsPage local logic)
// ═══════════════════════════════════════════════════════════

export type ClientStatus = 'active' | 'overdue' | 'pending' | 'churn-risk';

export interface ClientStatusInfo {
  status: ClientStatus;
  label: string;
  color: string;
}

export function getClientStatusInfo(lead: Lead): ClientStatusInfo {
  if (lead.paymentStatus === 'overdue' || lead.paymentStatus === 'at-risk') {
    const days = getPaymentDaysUntilDue(lead);
    return {
      status: 'overdue',
      label: days ? `${Math.abs(days)}d overdue` : 'Overdue',
      color: 'bg-destructive/10 text-destructive border-destructive/15',
    };
  }
  if (lead.paymentStatus === 'pending' || lead.stage === 'payment-pending') {
    return { status: 'pending', label: 'Pending', color: 'bg-warning/10 text-warning border-warning/15' };
  }
  if (lead.paymentStatus === 'paid') {
    const lastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt).getTime() : 0;
    const daysSince = Math.floor((Date.now() - lastContact) / (1000 * 60 * 60 * 24));
    if (daysSince >= 30) {
      return { status: 'churn-risk', label: `No contact ${daysSince}d`, color: 'bg-warning/10 text-warning border-warning/15' };
    }
  }
  return { status: 'active', label: 'Active', color: 'bg-success/10 text-success border-success/15' };
}
