/**
 * STYLIQUE CRM — Authoritative Lifecycle Engine
 * 
 * THE SINGLE SOURCE OF TRUTH for every company's state.
 * Every page MUST use these functions. No page may compute its own version.
 * 
 * RULES:
 * 1. ONE company = ONE authoritative lifecycle stage at a time
 * 2. Flags are supporting data, never main stages
 * 3. Stage transitions are strict and validated
 * 4. All counts are derived from the same canonical function
 * 5. No page-specific guesses or local state derivation
 */

import type { Lead, Stage, StageFamily } from '@/types/crm';
import {
  STAGE_LABELS, STAGE_FAMILY, CONVERTED_STAGES, CLOSED_STAGES,
  TRIAL_STAGES, PLAN_PRICES,
  getTrialDaysLeft, getPaymentDaysUntilDue, hasValidCredentials,
} from '@/types/crm';

// ═══════════════════════════════════════════════════════════
// VALID LIFECYCLE STAGES (the only truth)
// ═══════════════════════════════════════════════════════════

export const CANONICAL_STAGES = [
  'new-lead', 'contacted', 'replied', 'meeting-booked', 'meeting-completed',
  'internal-decision', 'pricing-discussion',
  'trial-proposed', 'trial-active', 'payment-pending', 'converted', 'closed-lost',
] as const;

export const CANONICAL_STAGE_LABELS: Record<string, string> = {
  'new-lead': 'New Lead',
  'contacted': 'Contacted',
  'replied': 'Replied',
  'meeting-booked': 'Meeting Booked',
  'meeting-completed': 'Meeting Outcome Due',
  'internal-decision': 'Internal Decision',
  'pricing-discussion': 'Pricing',
  'trial-proposed': 'Trial Proposed',
  'trial-active': 'Trial Active',
  'payment-pending': 'Payment Pending',
  'converted': 'Active Client',
  'closed-lost': 'Closed Lost',
  // AI/Inbound variants map to canonical
  'lead-added': 'New Lead',
  'new-inquiry': 'New Inquiry',
  'outreach-1': 'Contacted',
  'outreach-2': 'Follow-Up Sent',
  'outreach-3': 'Follow-Up Sent',
  'sequence-completed': 'Waiting for Reply',
  'qualified': 'Qualified',
  'awaiting-sdr': 'Awaiting Follow-Up',
  // Extended stages map to canonical
  'sdr-new-lead': 'New Lead',
  'sdr-contacted': 'Contacted',
  'sdr-replied': 'Replied',
  'ai-new-lead': 'New Lead',
  'pending-enrichment': 'New Lead',
  'pending-apollo': 'New Lead',
  'ready-for-outreach': 'New Lead',
  'email-sent-d0': 'Contacted',
  'followup-1-d3': 'Follow-Up Sent',
  'followup-2-d7': 'Follow-Up Sent',
  'followup-3-d14': 'Follow-Up Sent',
  'round4-d17': 'Final Follow-Up',
  'inbound-new': 'New Inquiry',
  'inbound-qualified': 'Qualified',
  'inbound-awaiting-sdr': 'Awaiting Follow-Up',
  'inbound-disqualified': 'Disqualified',
  'unsubscribed': 'Unsubscribed',
  'cold-no-response': 'No Response',
};

// ═══════════════════════════════════════════════════════════
// SUPPORTING FLAGS — never main stages
// ═══════════════════════════════════════════════════════════

export interface CompanyFlags {
  needs_approval: boolean;
  credentials_missing: boolean;
  ready_to_activate: boolean;
  trial_ending_soon: boolean;
  trial_expired: boolean;
  conversion_at_risk: boolean;
  payment_overdue: boolean;
}

// ═══════════════════════════════════════════════════════════
// CANONICAL DERIVED SUBSTATUS FIELDS
// These are the ONLY source of truth for substatus across all pages.
// ═══════════════════════════════════════════════════════════

export type TrialSetupStatus = 'none' | 'needs_approval' | 'needs_credentials' | 'needs_approval_and_credentials' | 'ready_to_activate' | 'active' | 'ending' | 'ended';
export type CanonicalPaymentStatus = 'none' | 'pending' | 'paid' | 'overdue' | 'lost';
export type OnboardingStatus = 'none' | 'setup_pending' | 'monitoring' | 'needs_help' | 'waiting_for_next_checkin' | 'handoff_to_sdr';

// ═══════════════════════════════════════════════════════════
// COMPANY STATE — the ONE authoritative view
// ═══════════════════════════════════════════════════════════

export type LifecycleStatus = 'action-required' | 'on-track' | 'waiting' | 'completed' | 'closed';

export interface CompanyState {
  /** The ONE authoritative lifecycle stage */
  stage: Stage;
  /** Human-readable stage label */
  stageLabel: string;
  /** Supporting flags (never treated as stages) */
  flags: CompanyFlags;
  /** Current status for display */
  status: LifecycleStatus;
  /** Situation-based status label */
  statusLabel: string;
  /** Display color (tailwind class) */
  statusColor: string;
  /** Days since last contact */
  daysSinceContact: number;
  /** Trial days left (null if not in trial) */
  trialDaysLeft: number | null;
  /** Payment days until due (null if not in payment stage) */
  paymentDaysUntilDue: number | null;
  // ─── Canonical substatus fields ────────────────────
  /** Trial setup substatus */
  trialSetupStatus: TrialSetupStatus;
  /** Payment substatus */
  canonicalPaymentStatus: CanonicalPaymentStatus;
  /** Onboarding substatus */
  onboardingStatus: OnboardingStatus;
}

/**
 * GET THE AUTHORITATIVE STATE OF A COMPANY.
 * Every page must call this. No page may derive its own version.
 */
export function getCompanyState(lead: Lead): CompanyState {
  const daysSince = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60 * 24));

  const trialDaysLeft = getTrialDaysLeft(lead);
  const paymentDays = getPaymentDaysUntilDue(lead);
  const hasCreds = hasValidCredentials(lead);
  const hasApproval = !!lead.approvedBy;

  const flags: CompanyFlags = {
    needs_approval: lead.stage === 'trial-proposed' && !hasApproval,
    credentials_missing: lead.stage === 'trial-proposed' && !hasCreds,
    ready_to_activate: lead.stage === 'trial-proposed' && hasApproval && hasCreds,
    trial_ending_soon: lead.stage === 'trial-active' && trialDaysLeft !== null && trialDaysLeft <= 3 && trialDaysLeft > 0,
    trial_expired: lead.stage === 'trial-active' && trialDaysLeft !== null && trialDaysLeft <= 0,
    conversion_at_risk: (lead.stage === 'trial-active' && trialDaysLeft !== null && trialDaysLeft <= 0) ||
      (lead.stage === 'payment-pending' && paymentDays !== null && paymentDays < -3),
    payment_overdue: (lead.stage === 'payment-pending' && paymentDays !== null && paymentDays < 0) ||
      (lead.stage === 'converted' && (lead.paymentStatus === 'overdue' || lead.paymentStatus === 'at-risk')),
  };

  const trialSetupStatus = deriveTrialSetupStatus(lead, flags, trialDaysLeft);
  const canonicalPaymentStatus = deriveCanonicalPaymentStatus(lead, flags);
  const onboardingStatus = deriveOnboardingStatus(lead);

  const stageLabel = CANONICAL_STAGE_LABELS[lead.stage] || STAGE_LABELS[lead.stage] || lead.stage;
  const base = { flags, daysSinceContact: daysSince, trialDaysLeft, paymentDaysUntilDue: paymentDays, trialSetupStatus, canonicalPaymentStatus, onboardingStatus };

  if (CLOSED_STAGES.includes(lead.stage)) {
    return { stage: lead.stage, stageLabel, status: 'closed', statusLabel: 'Closed', statusColor: 'text-muted-foreground', ...base };
  }

  if (CONVERTED_STAGES.includes(lead.stage)) {
    if (flags.payment_overdue) {
      return { stage: lead.stage, stageLabel: 'Client Active', status: 'action-required', statusLabel: 'Payment overdue', statusColor: 'text-destructive', ...base };
    }
    return { stage: lead.stage, stageLabel: 'Client Active', status: 'completed', statusLabel: 'Active client', statusColor: 'text-success', ...base };
  }

  if (lead.stage === 'payment-pending') {
    const sl = flags.payment_overdue ? `Payment ${paymentDays ? Math.abs(paymentDays) : 0}d overdue` : 'Payment pending';
    const sc = flags.payment_overdue ? 'text-destructive' : 'text-warning';
    return { stage: lead.stage, stageLabel, status: 'action-required', statusLabel: sl, statusColor: sc, ...base };
  }

  if (lead.stage === 'trial-active') {
    let status: LifecycleStatus, sl: string, sc: string;
    if (flags.trial_expired) { status = 'action-required'; sl = 'Trial expired'; sc = 'text-destructive'; }
    else if (flags.trial_ending_soon) { status = 'action-required'; sl = `Trial ends in ${trialDaysLeft}d`; sc = 'text-destructive'; }
    else { status = 'on-track'; sl = `Trial — ${trialDaysLeft ?? '?'}d left`; sc = 'text-success'; }
    return { stage: lead.stage, stageLabel, status, statusLabel: sl, statusColor: sc, ...base };
  }

  if (lead.stage === 'trial-proposed') {
    let sl: string, sc: string;
    if (flags.ready_to_activate) { sl = 'Ready to activate'; sc = 'text-primary'; }
    else {
      const needs = [];
      if (flags.needs_approval) needs.push('approval');
      if (flags.credentials_missing) needs.push('credentials');
      sl = `Needs ${needs.join(' + ')}`; sc = 'text-warning';
    }
    return { stage: lead.stage, stageLabel, status: 'action-required', statusLabel: sl, statusColor: sc, ...base };
  }

  if (lead.stage === 'meeting-booked') {
    const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
    if (pastNoSummary) return { stage: lead.stage, stageLabel, status: 'action-required', statusLabel: 'Meeting happened — add outcome now', statusColor: 'text-warning', ...base };
    return { stage: lead.stage, stageLabel, status: 'on-track', statusLabel: 'Meeting scheduled', statusColor: 'text-success', ...base };
  }

  if (lead.stage === 'meeting-completed') {
    return { stage: lead.stage, stageLabel, status: 'action-required',
      statusLabel: 'Add outcome to route this deal forward',
      statusColor: 'text-warning', ...base };
  }

  if (lead.stage === 'internal-decision') {
    const followTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
    const dueLabel = followTask ? `Check back ${new Date(followTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'They need time to decide';
    return { stage: lead.stage, stageLabel, status: 'waiting', statusLabel: dueLabel, statusColor: 'text-muted-foreground', ...base };
  }

  if (lead.stage === 'pricing-discussion') {
    return { stage: lead.stage, stageLabel, status: 'action-required',
      statusLabel: 'Send pricing or follow up on proposal',
      statusColor: 'text-warning', ...base };
  }

  if (lead.stage === 'replied' || lead.stage === 'sdr-replied') {
    return { stage: lead.stage, stageLabel, status: 'action-required',
      statusLabel: daysSince >= 2 ? `Replied ${daysSince}d ago — book meeting now` : 'Reply received — book meeting',
      statusColor: daysSince >= 2 ? 'text-destructive' : 'text-warning', ...base };
  }

  // Inbound disqualified
  if (lead.stage === 'inbound-disqualified') {
    return { stage: lead.stage, stageLabel, status: 'closed', statusLabel: 'Disqualified', statusColor: 'text-muted-foreground', ...base };
  }

  // Prospecting
  let status: LifecycleStatus, sl: string, sc: string;
  if (daysSince >= 7) { status = 'waiting'; sl = `No reply in ${daysSince}d — consider closing`; sc = 'text-muted-foreground'; }
  else if (daysSince >= 4) { status = 'action-required'; sl = `Follow up today — ${daysSince}d since contact`; sc = 'text-warning'; }
  else if (['new-lead', 'lead-added', 'new-inquiry', 'ai-new-lead', 'sdr-new-lead', 'inbound-new', 'pending-enrichment', 'pending-apollo', 'ready-for-outreach'].includes(lead.stage)) { status = 'action-required'; sl = 'Start outreach'; sc = 'text-warning'; }
  else { status = 'waiting'; sl = 'Waiting for reply'; sc = 'text-muted-foreground'; }

  return { stage: lead.stage, stageLabel, status, statusLabel: sl, statusColor: sc, ...base };
}

// ═══════════════════════════════════════════════════════════
// SUBSTATUS DERIVATION — private, canonical
// ═══════════════════════════════════════════════════════════

function deriveTrialSetupStatus(lead: Lead, flags: CompanyFlags, trialDaysLeft: number | null): TrialSetupStatus {
  if (lead.stage === 'trial-proposed') {
    if (flags.ready_to_activate) return 'ready_to_activate';
    if (flags.needs_approval && flags.credentials_missing) return 'needs_approval_and_credentials';
    if (flags.needs_approval) return 'needs_approval';
    if (flags.credentials_missing) return 'needs_credentials';
    return 'ready_to_activate';
  }
  if (lead.stage === 'trial-active') {
    if (trialDaysLeft !== null && trialDaysLeft <= 0) return 'ended';
    if (trialDaysLeft !== null && trialDaysLeft <= 3) return 'ending';
    return 'active';
  }
  return 'none';
}

function deriveCanonicalPaymentStatus(lead: Lead, flags: CompanyFlags): CanonicalPaymentStatus {
  if (lead.stage === 'closed-lost') return 'lost';
  if (lead.stage === 'converted' && lead.paymentStatus === 'paid') return 'paid';
  if (flags.payment_overdue) return 'overdue';
  if (lead.stage === 'payment-pending') return 'pending';
  if (lead.stage === 'converted') return 'paid';
  return 'none';
}

function deriveOnboardingStatus(lead: Lead): OnboardingStatus {
  if (lead.stage !== 'trial-active') return 'none';
  const tasks = lead.tasks || [];
  const onboardingTasks = tasks.filter(t => ['onboarding', 'check-in'].includes(t.type) && t.state !== 'cancelled');
  const incompleteTasks = onboardingTasks.filter(t => !t.completed);
  const completedTasks = onboardingTasks.filter(t => t.completed);

  if (onboardingTasks.length === 0) return 'setup_pending';

  const lastCompleted = completedTasks.sort((a, b) => new Date(b.completedAt || b.dueDate).getTime() - new Date(a.completedAt || a.dueDate).getTime())[0];
  if (lastCompleted?.reason?.includes('needs-help') || lastCompleted?.reason?.includes('setup-incomplete')) return 'needs_help';

  if (incompleteTasks.length === 0) {
    const daysLeft = getTrialDaysLeft(lead);
    if (daysLeft !== null && daysLeft <= 5) return 'handoff_to_sdr';
    return 'monitoring';
  }

  const nextDue = incompleteTasks.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  if (new Date(nextDue.dueDate) > new Date()) return 'waiting_for_next_checkin';
  return 'monitoring';
}

// Legacy compat
export function getCompanyStatus(lead: Lead): { status: LifecycleStatus; label: string; color: string; daysSinceContact: number } {
  const s = getCompanyState(lead);
  return { status: s.status, label: s.statusLabel, color: s.statusColor, daysSinceContact: s.daysSinceContact };
}

// ═══════════════════════════════════════════════════════════
// ESCALATION — derived from CompanyState
// ═══════════════════════════════════════════════════════════

export interface EscalationInfo {
  level: 'none' | 'warning' | 'overdue';
  message: string;
}

export function getEscalation(lead: Lead): EscalationInfo {
  const s = getCompanyState(lead);

  if (s.status === 'completed' || s.status === 'closed') {
    if (s.flags.payment_overdue) return { level: 'overdue', message: s.statusLabel };
    return { level: 'none', message: '' };
  }

  if (s.flags.payment_overdue) return { level: 'overdue', message: s.statusLabel };
  if (s.flags.trial_expired) return { level: 'overdue', message: 'Decision overdue' };
  if (s.flags.trial_ending_soon) return { level: 'warning', message: `Decision due in ${s.trialDaysLeft}d` };

  if (s.daysSinceContact >= 7) return { level: 'overdue', message: `No reply in ${s.daysSinceContact}d` };
  if (s.daysSinceContact >= 4) return { level: 'warning', message: `Follow up — last contact ${s.daysSinceContact}d ago` };
  return { level: 'none', message: '' };
}

// ═══════════════════════════════════════════════════════════
// UNIFIED PAGE COUNTS — THE ONLY COUNT FUNCTION
// ═══════════════════════════════════════════════════════════

export interface PageCounts {
  total: number;
  newLeads: number;
  prospecting: number;
  replied: number;
  meetingsBooked: number;
  trialsTotal: number;
  trialsActive: number;
  trialsSetupPending: number;
  trialsEndingSoon: number;
  trialsExpired: number;
  trialsReadyToActivate: number;
  paymentsPending: number;
  paymentsOverdue: number;
  activeClients: number;
  closedLost: number;
  paidRevenue: number;
  pendingRevenue: number;
  overdueRevenue: number;
}

export function getPageCounts(leads: Lead[]): PageCounts {
  const counts: PageCounts = {
    total: leads.length, newLeads: 0, prospecting: 0, replied: 0,
    meetingsBooked: 0,
    trialsTotal: 0, trialsActive: 0, trialsSetupPending: 0,
    trialsEndingSoon: 0, trialsExpired: 0, trialsReadyToActivate: 0,
    paymentsPending: 0, paymentsOverdue: 0,
    activeClients: 0, closedLost: 0,
    paidRevenue: 0, pendingRevenue: 0, overdueRevenue: 0,
  };

  for (const lead of leads) {
    const s = getCompanyState(lead);
    const plan = lead.subscriptionPlan || 'starter';
    const amount = PLAN_PRICES[plan] || 0;

    switch (lead.stage) {
      case 'new-lead': case 'lead-added': case 'new-inquiry':
      case 'ai-new-lead': case 'pending-enrichment': case 'pending-apollo': case 'ready-for-outreach':
      case 'sdr-new-lead': case 'inbound-new':
        counts.newLeads++; break;
      case 'contacted': case 'outreach-1': case 'outreach-2': case 'outreach-3':
      case 'sequence-completed': case 'qualified': case 'awaiting-sdr':
      case 'email-sent-d0': case 'followup-1-d3': case 'followup-2-d7': case 'followup-3-d14': case 'round4-d17':
      case 'sdr-contacted': case 'inbound-qualified': case 'inbound-awaiting-sdr':
        counts.prospecting++; break;
      case 'replied': case 'sdr-replied':
        counts.replied++; break;
      case 'meeting-booked': case 'meeting-completed':
        counts.meetingsBooked++; break;
      case 'trial-proposed':
        counts.trialsTotal++;
        if (s.trialSetupStatus === 'ready_to_activate') counts.trialsReadyToActivate++;
        else counts.trialsSetupPending++;
        break;
      case 'trial-active':
        counts.trialsTotal++;
        if (s.trialSetupStatus === 'ended') counts.trialsExpired++;
        else if (s.trialSetupStatus === 'ending') counts.trialsEndingSoon++;
        else counts.trialsActive++;
        break;
      case 'payment-pending':
        counts.paymentsPending++;
        counts.pendingRevenue += amount;
        if (s.canonicalPaymentStatus === 'overdue') { counts.paymentsOverdue++; counts.overdueRevenue += amount; }
        break;
      case 'converted':
        counts.activeClients++;
        if (s.canonicalPaymentStatus === 'paid') counts.paidRevenue += amount;
        if (s.canonicalPaymentStatus === 'overdue') { counts.paymentsOverdue++; counts.overdueRevenue += amount; }
        break;
      case 'closed-lost': case 'inbound-disqualified':
        counts.closedLost++; break;
    }
  }

  return counts;
}

// ═══════════════════════════════════════════════════════════
// STAGE NEXT ACTION
// ═══════════════════════════════════════════════════════════

export function getStageNextAction(lead: Lead): { action: string; reason: string } {
  const s = getCompanyState(lead);

  switch (lead.stage) {
    case 'new-lead':
      return { action: 'No outreach yet', reason: 'New lead' };
    case 'contacted':
      if (s.daysSinceContact >= 3) return { action: `Follow-up due`, reason: `${s.daysSinceContact}d since contact` };
      return { action: 'No response yet', reason: 'Recently contacted' };
    case 'replied':
      return { action: `Schedule meeting`, reason: 'Reply received' };
    case 'meeting-booked': {
      const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
      if (pastNoSummary) return { action: 'Meeting result missing', reason: 'Meeting passed without outcome' };
      return { action: 'Meeting scheduled', reason: 'Business conversation scheduled' };
    }
    case 'trial-proposed':
      if (s.trialSetupStatus === 'ready_to_activate') return { action: 'Onboarding queue', reason: 'Approved and credentials ready' };
      if (s.trialSetupStatus === 'needs_approval_and_credentials') return { action: 'Client Review', reason: 'Approval and credentials pending' };
      if (s.trialSetupStatus === 'needs_approval') return { action: 'Client Review', reason: 'Approval pending' };
      if (s.trialSetupStatus === 'needs_credentials') return { action: 'Credentials missing', reason: 'Credentials pending' };
      return { action: 'Onboarding queue', reason: 'Ready for onboarding' };
    case 'trial-active':
      if (s.trialSetupStatus === 'ended') return { action: 'Decision overdue', reason: 'Decision pending' };
      if (s.trialSetupStatus === 'ending') return { action: `Decision due in ${s.trialDaysLeft}d`, reason: 'Decision pending' };
      return { action: `Onboarding active`, reason: 'On track' };
    case 'payment-pending':
      if (s.canonicalPaymentStatus === 'overdue') {
        const days = s.paymentDaysUntilDue ? Math.abs(s.paymentDaysUntilDue) : 0;
        return { action: `Payment ${days}d overdue`, reason: 'Overdue' };
      }
      return { action: 'Awaiting payment', reason: 'Awaiting payment' };
    case 'converted':
      return { action: 'Active client', reason: 'Retention mode' };
    case 'closed-lost':
      return { action: 'Closed lost', reason: 'Closed' };
    case 'lead-added':
      return { action: 'No outreach yet', reason: 'New lead' };
    case 'outreach-1': case 'outreach-2': case 'outreach-3':
      return { action: 'Follow-up due', reason: 'No response yet' };
    case 'sequence-completed': case 'awaiting-sdr':
      return { action: `Follow-up due`, reason: 'No response yet' };
    case 'new-inquiry': case 'qualified':
      return { action: `No outreach yet`, reason: 'Inbound lead' };
    default:
      return { action: 'Review this lead', reason: 'Unknown state' };
  }
}

// ═══════════════════════════════════════════════════════════
// LIFECYCLE POSITION — for contacts page lifecycle filter
// ═══════════════════════════════════════════════════════════

export type LifecyclePosition = 'prospecting' | 'trial' | 'payment' | 'client' | 'closed';

export function getLifecyclePosition(lead: Lead): LifecyclePosition {
  if (CLOSED_STAGES.includes(lead.stage)) return 'closed';
  if (CONVERTED_STAGES.includes(lead.stage)) return 'client';
  if (lead.stage === 'payment-pending') return 'payment';
  if (lead.stage === 'trial-active' || lead.stage === 'trial-proposed') return 'trial';
  return 'prospecting';
}

// ═══════════════════════════════════════════════════════════
// IS REVENUE RISK
// ═══════════════════════════════════════════════════════════

export function isRevenueRisk(lead: Lead): boolean {
  const s = getCompanyState(lead);
  return s.flags.payment_overdue || s.flags.trial_expired || s.flags.conversion_at_risk;
}

// ═══════════════════════════════════════════════════════════
// STRICT STAGE TRANSITIONS
// ═══════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<string, Stage[]> = {
  'new-lead': ['contacted', 'closed-lost'],
  'lead-added': ['outreach-1', 'contacted', 'closed-lost'],
  'new-inquiry': ['qualified', 'contacted', 'closed-lost'],
  'contacted': ['replied', 'meeting-booked', 'closed-lost'],
  'outreach-1': ['outreach-2', 'replied', 'awaiting-sdr', 'closed-lost'],
  'outreach-2': ['outreach-3', 'replied', 'awaiting-sdr', 'closed-lost'],
  'outreach-3': ['sequence-completed', 'replied', 'awaiting-sdr', 'closed-lost'],
  'sequence-completed': ['replied', 'awaiting-sdr', 'closed-lost'],
  'qualified': ['meeting-booked', 'replied', 'closed-lost'],
  'awaiting-sdr': ['contacted', 'replied', 'meeting-booked', 'closed-lost'],
  'replied': ['meeting-booked', 'trial-proposed', 'closed-lost'],
  'meeting-booked': ['trial-proposed', 'replied', 'closed-lost'],
  'trial-proposed': ['trial-active', 'closed-lost'],
  'trial-active': ['payment-pending', 'closed-lost'],
  'payment-pending': ['converted', 'closed-lost'],
  'converted': ['closed-lost'],
  'closed-lost': [],
};

export function isValidTransition(from: Stage, to: Stage): boolean {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

export function getValidNextStages(from: Stage): Stage[] {
  return VALID_TRANSITIONS[from] || [];
}

export function canActivateTrial(lead: Lead): { canActivate: boolean; blockers: string[] } {
  if (lead.stage !== 'trial-proposed') return { canActivate: false, blockers: ['Not in Trial Proposed stage'] };
  const blockers: string[] = [];
  if (!lead.approvedBy) blockers.push('Needs CEO/COO approval');
  if (!hasValidCredentials(lead)) blockers.push('Needs store credentials');
  return { canActivate: blockers.length === 0, blockers };
}
