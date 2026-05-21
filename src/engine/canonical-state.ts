/**
 * STYLIQUE CRM — Canonical Derived State
 * 
 * THE SINGLE SOURCE OF TRUTH for every company's derived state.
 * Every page MUST call getCanonicalState() — NO local derivation allowed.
 * 
 * This module derives ALL display fields from the raw Lead record:
 *   - entry_flow, source_channel
 *   - lifecycle_stage, inbound_stage, trial_stage, commercial_stage, meeting_stage
 *   - current_owner_role, next_required_action, next_action_owner_role
 *   - is_actionable_for_current_role
 */

import type { Lead, ActionOwner, EntryFlow, InboundType, MeetingNote, SourceDetail, Stage } from '@/types/crm';
import { hasValidCredentials, getTrialDaysLeft, getPaymentDaysUntilDue, PLAN_PRICES } from '@/types/crm';

// ═══════════════════════════════════════════════════════════
// CANONICAL ENUMS — every possible derived value
// ═══════════════════════════════════════════════════════════

export type LifecycleStage =
  | 'new_lead' | 'contacted' | 'replied'
  | 'meeting_booked' | 'meeting_completed'
  | 'internal_decision' | 'pricing_discussion'
  | 'trial_proposed' | 'trial_ready' | 'trial_active'
  | 'conversion_pending' | 'converted'
  | 'lost' | 'closed'
  | 'unsubscribed' | 'cold_no_response';

export type OperationalStatus =
  | 'pending_enrichment' | 'blocked_no_verified_email'
  | 'manual_research_required' | 'ready_for_outreach'
  | 'waiting_reply' | 'followup_due' | 'warm_opened'
  | 'ai_handed_off' | 'needs_trial_approval' | 'needs_credentials'
  | 'ready_to_activate' | 'trial_running' | 'trial_ending'
  | 'payment_pending' | 'overdue' | 'churn_risk'
  | 'outreach_blocked' | 'cold_rescue_queue'
  | 'no_action';

export type InboundStage =
  | 'new_inquiry' | 'qualified' | 'awaiting_sdr'
  | 'meeting_booked' | 'handed_to_sales'
  | 'disqualified' | 'not_applicable';

export type TrialStage =
  | 'not_started' | 'needs_approval' | 'needs_credentials'
  | 'needs_approval_and_credentials' | 'ready_to_activate'
  | 'active' | 'ending' | 'expired' | 'converted' | 'not_applicable';

export type CommercialStage =
  | 'none' | 'payment_pending' | 'paid' | 'overdue' | 'churn_risk' | 'lost';

export type MeetingStage =
  | 'none' | 'proposed' | 'booked' | 'completed' | 'missed' | 'needs_summary';

export type NextRequiredAction =
  | 'send_intro' | 'follow_up' | 'book_meeting' | 'log_meeting_outcome'
  | 'approve_trial' | 'add_credentials' | 'complete_trial_setup'
  | 'activate_trial' | 'monitor_trial' | 'confirm_payment'
  | 'send_payment_reminder' | 'convert_client' | 'close_lost'
  | 'wait_for_ai' | 'qualify_inbound' | 'contact_immediately'
  | 'prepare_meeting' | 'propose_trial' | 'conversion_push'
  | 'no_action';

export type OwnerRole = 'sdr' | 'onboarding' | 'leadership' | 'automation' | 'none';

export type ViewerRole = 'sdr' | 'onboarding' | 'ceo' | 'coo' | 'operations';

// ═══════════════════════════════════════════════════════════
// CANONICAL STATE — the ONE object every page reads
// ═══════════════════════════════════════════════════════════

export interface CanonicalState {
  // Identity
  entry_flow: EntryFlow;
  inbound_type: InboundType;
  source_channel: SourceDetail | 'other';

  // Lifecycle
  lifecycle_stage: LifecycleStage;
  operational_status: OperationalStatus;
  inbound_stage: InboundStage;
  trial_stage: TrialStage;
  commercial_stage: CommercialStage;
  meeting_stage: MeetingStage;

  // Ownership
  current_owner_role: OwnerRole;
  current_owner_name: string;
  next_required_action: NextRequiredAction;
  next_action_label: string; // human-readable
  next_action_owner_role: OwnerRole;

  // Display
  primary_badge: { label: string; variant: 'default' | 'outline' | 'destructive' | 'secondary'; color: string };
  secondary_badge: { label: string; variant: 'default' | 'outline' | 'destructive' | 'secondary'; color: string } | null;
  urgency: 'critical' | 'high' | 'normal' | 'low' | 'none';
  status_label: string;
  status_color: string;

  // Metrics
  days_since_contact: number;
  trial_days_left: number | null;
  payment_days_until_due: number | null;
  mrr: number;
}

// ═══════════════════════════════════════════════════════════
// DERIVE — the canonical function
// ═══════════════════════════════════════════════════════════

export function getCanonicalState(lead: Lead): CanonicalState {
  const entry_flow = deriveEntryFlow(lead);
  const inbound_type = lead.inbound_type || null;
  const source_channel = (lead.source_detail || 'other') as SourceDetail | 'other';

  const lifecycle_stage = deriveLifecycleStage(lead);
  const operational_status = deriveOperationalStatus(lead, lifecycle_stage);
  const inbound_stage = deriveInboundStage(lead, entry_flow);
  const trial_stage = deriveTrialStage(lead);
  const commercial_stage = deriveCommercialStage(lead);
  const meeting_stage = deriveMeetingStage(lead);

  const { current_owner_role, current_owner_name } = deriveOwnership(lead, lifecycle_stage, trial_stage);
  const { next_required_action, next_action_label, next_action_owner_role } = deriveNextAction(lead, lifecycle_stage, trial_stage, commercial_stage, meeting_stage, entry_flow);

  const { primary_badge, secondary_badge } = deriveBadges(lifecycle_stage, trial_stage, commercial_stage, meeting_stage, lead);
  const { urgency, status_label, status_color } = deriveUrgency(lead, lifecycle_stage, trial_stage, commercial_stage);

  const days_since_contact = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86400000);

  const trial_days_left = getTrialDaysLeft(lead);
  const payment_days_until_due = getPaymentDaysUntilDue(lead);
  const mrr = PLAN_PRICES[lead.subscriptionPlan || 'starter'] || 0;

  return {
    entry_flow, inbound_type, source_channel,
    lifecycle_stage, operational_status, inbound_stage, trial_stage, commercial_stage, meeting_stage,
    current_owner_role, current_owner_name, next_required_action, next_action_label, next_action_owner_role,
    primary_badge, secondary_badge, urgency, status_label, status_color,
    days_since_contact, trial_days_left, payment_days_until_due, mrr,
  };
}

// ═══════════════════════════════════════════════════════════
// IS ACTIONABLE — role-gated
// ═══════════════════════════════════════════════════════════

export function isActionableForRole(state: CanonicalState, viewerRole: ViewerRole, viewerUser: string, lead: Lead): boolean {
  const ownerRole = state.next_action_owner_role;
  switch (viewerRole) {
    case 'sdr':
      return ownerRole === 'sdr' && (lead.assignedTo === viewerUser || lead.assigned_sdr === viewerUser);
    case 'onboarding':
      return ownerRole === 'onboarding';
    case 'ceo':
    case 'coo':
      return ownerRole === 'leadership';
    case 'operations':
      return false;
  }
}

/** Convenience: can the current role act on this company? */
export function canCurrentRoleAct(lead: Lead, viewerRole: ViewerRole, viewerUser: string): boolean {
  const state = getCanonicalState(lead);
  return isActionableForRole(state, viewerRole, viewerUser, lead);
}

/** Get human-readable next-action owner role */
export function getNextActionOwnerRole(lead: Lead): OwnerRole {
  return getCanonicalState(lead).next_action_owner_role;
}

/** Read-only status label for non-owning roles */
export function getReadOnlyStatusLabel(lead: Lead, viewerRole: ViewerRole): string | null {
  const state = getCanonicalState(lead);
  if (state.next_action_owner_role === 'none') return null;

  // Specific contextual labels — never vague "SDR handling" / "Onboarding handling"
  const ownerName = lead.assignedTo
    ? (lead.assignedTo.charAt(0).toUpperCase() + lead.assignedTo.slice(1))
    : 'SDR';

  // SDR viewing non-SDR owned records
  if (viewerRole === 'sdr') {
    if (state.trial_stage === 'needs_approval' || state.trial_stage === 'needs_approval_and_credentials') {
      return 'Moved to Client Review — leadership owns this';
    }
    if (state.trial_stage === 'needs_credentials' || state.trial_stage === 'ready_to_activate') {
      return 'Moved to Client Review — onboarding setting up';
    }
    if (state.trial_stage === 'active') {
      return 'Active client — onboarding monitoring';
    }
    if (state.commercial_stage === 'payment_pending') return 'Awaiting payment — leadership handling';
    if (state.lifecycle_stage === 'converted') return 'Active client — no outreach needed';
    if (state.next_action_owner_role === 'onboarding') return 'Onboarding handling next step';
    if (state.next_action_owner_role === 'leadership') return 'Leadership handling next step';
    if (state.next_action_owner_role === 'automation') return 'AI sequence running';
  }

  // Onboarding viewing non-onboarding owned records
  if (viewerRole === 'onboarding') {
    if (state.trial_stage === 'needs_approval' || state.trial_stage === 'needs_approval_and_credentials') {
      return 'Activation blocked — waiting for CEO/COO approval';
    }
    if (state.next_action_owner_role === 'sdr') {
      return `${ownerName} handling next action`;
    }
    if (state.next_action_owner_role === 'leadership') return 'Awaiting leadership decision';
  }

  // CEO/COO viewing non-leadership owned records
  if (viewerRole === 'ceo' || viewerRole === 'coo' || viewerRole === 'operations') {
    if (state.next_action_owner_role === 'sdr') {
      return `${ownerName} handling outreach`;
    }
    if (state.next_action_owner_role === 'onboarding') {
      return 'Onboarding handling setup';
    }
    if (state.next_action_owner_role === 'automation') return 'AI sequence running';
  }

  return null;
}

/** Which tabs should be visible in detail drawer for this lead? */
export function getVisibleTabs(lead: Lead, viewerRole: ViewerRole): Set<string> {
  const state = getCanonicalState(lead);
  const tabs = new Set(['overview', 'contact', 'lifecycle', 'timeline', 'notes']);

  // Meetings: show if any meetings exist or stage >= meeting_booked
  const hasMeetings = lead.meetingNotes && lead.meetingNotes.length > 0;
  const meetingRelevant = ['meeting_booked', 'meeting_completed', 'trial_proposed', 'trial_ready', 'trial_active', 'conversion_pending', 'converted'].includes(state.lifecycle_stage);
  if (hasMeetings || meetingRelevant) tabs.add('meetings');

  // Payment: show only when commercially relevant
  if (
    state.commercial_stage !== 'none'
    || ['trial_proposed', 'trial_ready', 'trial_active', 'conversion_pending', 'converted'].includes(state.lifecycle_stage)
    || lead.stage === 'payment-pending'
  ) tabs.add('payment');

  // Credentials: show only for relevant roles and stages
  const credentialRelevant = state.trial_stage !== 'not_applicable' && state.trial_stage !== 'not_started';
  if (credentialRelevant && (viewerRole === 'onboarding' || viewerRole === 'ceo' || viewerRole === 'coo')) {
    tabs.add('credentials');
  }
  // SDR sees credentials tab only as status indicator when trial is relevant
  if (credentialRelevant && viewerRole === 'sdr') {
    tabs.add('credentials');
  }

  return tabs;
}

/** Shared meeting selector — returns meetings filtered by role */
export function getMeetingsForRole(leads: Lead[], viewerRole: ViewerRole, viewerUser: string): Array<{ meeting: MeetingNote; lead: Lead; meetingIdx: number }> {
  let filtered: Lead[];
  switch (viewerRole) {
    case 'sdr':
      filtered = leads.filter(l => l.assignedTo === viewerUser || l.assigned_sdr === viewerUser);
      break;
    case 'onboarding':
      // Onboarding sees trial check-in meetings and assigned leads
      filtered = leads.filter(l => ['trial-proposed', 'trial-active'].includes(l.stage));
      break;
    case 'ceo':
    case 'coo':
      filtered = leads; // leadership sees all
      break;
    default:
      filtered = [];
  }
  return filtered.flatMap(l =>
    (l.meetingNotes || []).map((m, idx) => ({ meeting: m, lead: l, meetingIdx: idx }))
  ).sort((a, b) => new Date(a.meeting.date).getTime() - new Date(b.meeting.date).getTime());
}

// ═══════════════════════════════════════════════════════════
// COUNTERS — derive from canonical state
// ═══════════════════════════════════════════════════════════

export interface CanonicalCounters {
  total: number;
  by_flow: { inbound: number; sdr_manual: number };
  by_lifecycle: Record<LifecycleStage, number>;
  trials: { total: number; setup: number; ready: number; active: number; ending: number; expired: number };
  payments: { pending: number; paid: number; overdue: number };
  revenue: { mrr: number; pending: number; overdue: number };
  meetings: { booked: number; completed: number; needs_summary: number };
}

export function getCanonicalCounters(leads: Lead[]): CanonicalCounters {
  const c: CanonicalCounters = {
    total: leads.length,
    by_flow: { inbound: 0, sdr_manual: 0 },
    by_lifecycle: {
      new_lead: 0, contacted: 0, replied: 0,
      meeting_booked: 0, meeting_completed: 0,
      internal_decision: 0, pricing_discussion: 0,
      trial_proposed: 0, trial_ready: 0, trial_active: 0,
      conversion_pending: 0, converted: 0, lost: 0, closed: 0,
      unsubscribed: 0, cold_no_response: 0,
    },
    trials: { total: 0, setup: 0, ready: 0, active: 0, ending: 0, expired: 0 },
    payments: { pending: 0, paid: 0, overdue: 0 },
    revenue: { mrr: 0, pending: 0, overdue: 0 },
    meetings: { booked: 0, completed: 0, needs_summary: 0 },
  };

  for (const lead of leads) {
    const s = getCanonicalState(lead);
    
    // Flow counts
    c.by_flow[s.entry_flow]++;

    // Lifecycle counts
    c.by_lifecycle[s.lifecycle_stage]++;

    // Trial counts
    if (s.trial_stage !== 'not_applicable' && s.trial_stage !== 'not_started' && s.trial_stage !== 'converted') {
      c.trials.total++;
      if (['needs_approval', 'needs_credentials', 'needs_approval_and_credentials'].includes(s.trial_stage)) c.trials.setup++;
      if (s.trial_stage === 'ready_to_activate') c.trials.ready++;
      if (s.trial_stage === 'active') c.trials.active++;
      if (s.trial_stage === 'ending') c.trials.ending++;
      if (s.trial_stage === 'expired') c.trials.expired++;
    }

    // Payment/revenue counts
    if (s.commercial_stage === 'payment_pending') { c.payments.pending++; c.revenue.pending += s.mrr; }
    if (s.commercial_stage === 'paid') { c.payments.paid++; c.revenue.mrr += s.mrr; }
    if (s.commercial_stage === 'overdue') { c.payments.overdue++; c.revenue.overdue += s.mrr; }

    if (s.meeting_stage === 'booked') c.meetings.booked++;
    if (s.meeting_stage === 'completed') c.meetings.completed++;
    if (s.meeting_stage === 'needs_summary') c.meetings.needs_summary++;
  }

  return c;
}

// ═══════════════════════════════════════════════════════════
// PRIVATE DERIVATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

function deriveEntryFlow(lead: Lead): EntryFlow {
  if (lead.entry_flow) return lead.entry_flow;
  if (lead.pipeline === 'inbound') return 'inbound';
  return 'sdr_manual';
}

function deriveLifecycleStage(lead: Lead): LifecycleStage {
  switch (lead.stage) {
    case 'ai-new-lead': case 'pending-enrichment': case 'pending-apollo': case 'ready-for-outreach':
    case 'sdr-new-lead': case 'inbound-new': case 'new-lead': case 'lead-added': case 'new-inquiry':
      return 'new_lead';
    case 'email-sent-d0': case 'followup-1-d3': case 'followup-2-d7': case 'followup-3-d14': case 'round4-d17':
    case 'sdr-contacted': case 'contacted': case 'outreach-1': case 'outreach-2': case 'outreach-3':
    case 'sequence-completed': case 'inbound-qualified': case 'inbound-awaiting-sdr':
    case 'qualified': case 'awaiting-sdr':
      return 'contacted';
    case 'sdr-replied': case 'replied':
      return 'replied';
    case 'meeting-booked':
      return 'meeting_booked';
    case 'meeting-completed':
      return 'meeting_completed';
    case 'internal-decision':
      return 'internal_decision';
    case 'pricing-discussion':
      return 'pricing_discussion';
    case 'trial-proposed': {
      const hasApproval = !!lead.approvedBy;
      const hasCreds = hasValidCredentials(lead);
      if (hasApproval && hasCreds) return 'trial_ready';
      return 'trial_proposed';
    }
    case 'trial-active': {
      const daysLeft = getTrialDaysLeft(lead);
      if (daysLeft !== null && daysLeft <= 0) return 'conversion_pending';
      return 'trial_active';
    }
    case 'payment-pending':
      return 'conversion_pending';
    case 'converted':
      return 'converted';
    case 'closed-lost': case 'inbound-disqualified':
      return 'closed';
    case 'unsubscribed':
      return 'unsubscribed';
    case 'cold-no-response':
      return 'cold_no_response';
    default:
      return 'new_lead';
  }
}

function deriveOperationalStatus(lead: Lead, lifecycle: LifecycleStage): OperationalStatus {
  // Outreach-blocked (manual research required) — applies to any flow
  if (lead.outreach_blocked) return 'outreach_blocked';

  // Trial
  if (lead.stage === 'trial-proposed') {
    if (!lead.approvedBy) return 'needs_trial_approval';
    if (!hasValidCredentials(lead)) return 'needs_credentials';
    return 'ready_to_activate';
  }
  if (lead.stage === 'trial-active') {
    const dl = getTrialDaysLeft(lead);
    if (dl !== null && dl <= 3) return 'trial_ending';
    return 'trial_running';
  }

  // Payment
  if (lead.stage === 'payment-pending') {
    const pd = getPaymentDaysUntilDue(lead);
    if (pd !== null && pd < 0) return 'overdue';
    return 'payment_pending';
  }
  if (lead.paymentStatus === 'at-risk') return 'churn_risk';

  // Outreach
  if (lifecycle === 'contacted') {
    const daysSince = lead.lastContactedAt
      ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000) : 99;
    if (daysSince >= 3) return 'followup_due';
    return 'waiting_reply';
  }

  if (['closed', 'lost', 'converted', 'unsubscribed', 'cold_no_response'].includes(lifecycle)) return 'no_action';

  return 'no_action';
}

function deriveInboundStage(lead: Lead, flow: EntryFlow): InboundStage {
  if (flow !== 'inbound') return 'not_applicable';
  switch (lead.stage) {
    case 'inbound-new': case 'new-inquiry': return 'new_inquiry';
    case 'inbound-qualified': case 'qualified': return 'qualified';
    case 'inbound-awaiting-sdr': case 'awaiting-sdr': return 'awaiting_sdr';
    case 'meeting-booked': return 'meeting_booked';
    case 'inbound-disqualified': return 'disqualified';
    default:
      // If past meeting, it was handed to sales
      if (['meeting-completed', 'sdr-replied', 'trial-proposed', 'trial-active', 'payment-pending', 'converted'].includes(lead.stage)) {
        return 'handed_to_sales';
      }
      return 'new_inquiry';
  }
}

function deriveTrialStage(lead: Lead): TrialStage {
  if (lead.stage === 'converted') return 'converted';
  if (lead.stage !== 'trial-proposed' && lead.stage !== 'trial-active') return 'not_applicable';

  if (lead.stage === 'trial-proposed') {
    const hasApproval = !!lead.approvedBy;
    const hasCreds = hasValidCredentials(lead);
    if (hasApproval && hasCreds) return 'ready_to_activate';
    if (!hasApproval && !hasCreds) return 'needs_approval_and_credentials';
    if (!hasApproval) return 'needs_approval';
    return 'needs_credentials';
  }

  // trial-active
  const daysLeft = getTrialDaysLeft(lead);
  if (daysLeft !== null && daysLeft <= 0) return 'expired';
  if (daysLeft !== null && daysLeft <= 3) return 'ending';
  return 'active';
}

function deriveCommercialStage(lead: Lead): CommercialStage {
  if (lead.stage === 'closed-lost' || lead.stage === 'inbound-disqualified') return 'lost';
  if (lead.stage === 'converted') {
    if (lead.paymentStatus === 'overdue' || lead.paymentStatus === 'at-risk') return 'overdue';
    return 'paid';
  }
  if (lead.stage === 'payment-pending') {
    const days = getPaymentDaysUntilDue(lead);
    if (days !== null && days < 0) return 'overdue';
    return 'payment_pending';
  }
  return 'none';
}

function deriveMeetingStage(lead: Lead): MeetingStage {
  if (lead.stage === 'meeting-booked') {
    const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
    if (pastNoSummary) return 'needs_summary';
    return 'booked';
  }
  if (lead.stage === 'meeting-completed') return 'completed';
  if (lead.meeting_status === 'no-show') return 'missed';
  return 'none';
}

function deriveOwnership(lead: Lead, lifecycle: LifecycleStage, trial: TrialStage): { current_owner_role: OwnerRole; current_owner_name: string } {

  // Trial setup ownership
  if (trial === 'needs_approval' || trial === 'needs_approval_and_credentials') {
    return { current_owner_role: 'leadership', current_owner_name: lead.approvedBy || '' };
  }
  if (trial === 'needs_credentials') {
    return { current_owner_role: 'onboarding', current_owner_name: lead.assigned_onboarding_owner || 'muneeb' };
  }
  if (trial === 'ready_to_activate') {
    return { current_owner_role: 'onboarding', current_owner_name: lead.assigned_onboarding_owner || 'muneeb' };
  }
  if (trial === 'active' || trial === 'ending') {
    // Onboarding owns monitoring, but SDR owns conversion push at ending
    if (trial === 'ending') {
      return { current_owner_role: 'sdr', current_owner_name: lead.assigned_sdr || lead.assignedTo };
    }
    return { current_owner_role: 'onboarding', current_owner_name: lead.assigned_onboarding_owner || 'muneeb' };
  }

  // Payment stages
  if (lifecycle === 'conversion_pending') {
    return { current_owner_role: 'leadership', current_owner_name: '' };
  }

  // Converted
  if (lifecycle === 'converted') {
    return { current_owner_role: 'sdr', current_owner_name: lead.assigned_sdr || lead.assignedTo };
  }

  // Default: SDR
  return { current_owner_role: 'sdr', current_owner_name: lead.assigned_sdr || lead.assignedTo };
}

function deriveNextAction(
  lead: Lead,
  lifecycle: LifecycleStage,
  trial: TrialStage,
  commercial: CommercialStage,
  meeting: MeetingStage,
  flow: EntryFlow,
): { next_required_action: NextRequiredAction; next_action_label: string; next_action_owner_role: OwnerRole } {

  // Meeting needs summary — SDR
  if (meeting === 'needs_summary') {
    return { next_required_action: 'log_meeting_outcome', next_action_label: 'Meeting result missing', next_action_owner_role: 'sdr' };
  }

  // Trial stages
  if (trial === 'needs_approval' || trial === 'needs_approval_and_credentials') {
    return { next_required_action: 'approve_trial', next_action_label: `Client Review — ${lead.companyName}`, next_action_owner_role: 'leadership' };
  }
  if (trial === 'needs_credentials') {
    // Onboarding owns credential collection. Leadership only intervenes if escalated.
    return { next_required_action: 'add_credentials', next_action_label: `Collect credentials — ${lead.companyName}`, next_action_owner_role: 'onboarding' };
  }
  if (trial === 'ready_to_activate') {
    return { next_required_action: 'activate_trial', next_action_label: `Onboarding queue — ${lead.companyName}`, next_action_owner_role: 'onboarding' };
  }
  if (trial === 'active') {
    return { next_required_action: 'monitor_trial', next_action_label: 'Pilot active', next_action_owner_role: 'onboarding' };
  }
  if (trial === 'ending' || trial === 'expired') {
    return { next_required_action: 'conversion_push', next_action_label: `Decision pending — ${lead.companyName}`, next_action_owner_role: 'sdr' };
  }

  // Commercial
  if (commercial === 'payment_pending') {
    return { next_required_action: 'confirm_payment', next_action_label: 'Confirm payment', next_action_owner_role: 'leadership' };
  }
  if (commercial === 'overdue') {
    return { next_required_action: 'send_payment_reminder', next_action_label: 'Follow up on overdue payment', next_action_owner_role: 'sdr' };
  }
  if (commercial === 'paid') {
    return { next_required_action: 'no_action', next_action_label: 'Active client', next_action_owner_role: 'none' };
  }

  // Lifecycle
  switch (lifecycle) {
    case 'new_lead':
      if (flow === 'inbound') {
        return { next_required_action: 'qualify_inbound', next_action_label: `Contact ${lead.contactName} — inbound lead`, next_action_owner_role: 'sdr' };
      }
      return { next_required_action: 'send_intro', next_action_label: `Contact ${lead.contactName}`, next_action_owner_role: 'sdr' };
    case 'contacted': {
      const daysSince = lead.lastContactedAt
        ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
        : 99;
      if (daysSince >= 5) {
        return { next_required_action: 'follow_up', next_action_label: `Day ${daysSince} no reply — call ${lead.contactName}`, next_action_owner_role: 'sdr' };
      }
      if (daysSince >= 3) {
        return { next_required_action: 'follow_up', next_action_label: `Follow up — ${daysSince}d since contact`, next_action_owner_role: 'sdr' };
      }
      return { next_required_action: 'follow_up', next_action_label: 'Waiting for reply', next_action_owner_role: 'sdr' };
    }
    case 'replied':
      return { next_required_action: 'book_meeting', next_action_label: `Book meeting with ${lead.contactName}`, next_action_owner_role: 'sdr' };
    case 'meeting_booked': {
      const futureMeeting = lead.meetingNotes?.find(m => new Date(m.date) > new Date());
      if (futureMeeting) {
        return {
          next_required_action: 'prepare_meeting',
          next_action_label: `Meeting scheduled for ${new Date(futureMeeting.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
          next_action_owner_role: 'sdr',
        };
      }
      return { next_required_action: 'prepare_meeting', next_action_label: 'Prepare for upcoming meeting', next_action_owner_role: 'sdr' };
    }
    case 'meeting_completed': {
      // Check for specific pending follow-up task
      const followTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      if (followTask) {
        return { next_required_action: 'follow_up', next_action_label: followTask.title || 'Follow up after meeting', next_action_owner_role: 'sdr' };
      }
      return { next_required_action: 'follow_up', next_action_label: 'Follow up — propose trial or discuss next steps', next_action_owner_role: 'sdr' };
    }
    case 'internal_decision': {
      const followTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      return { next_required_action: 'follow_up', next_action_label: followTask?.title || `Follow up on internal decision — ${lead.companyName}`, next_action_owner_role: 'sdr' };
    }
    case 'pricing_discussion': {
      const followTask2 = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      return { next_required_action: 'follow_up', next_action_label: followTask2?.title || `Send pricing / proposal — ${lead.companyName}`, next_action_owner_role: 'sdr' };
    }
    case 'trial_proposed':
      // Trial sub-stages (needs_approval, needs_credentials, ready_to_activate) are
      // already handled by the trial-stage checks above (lines 618-632).
      // This case only fires if trial derivation returned not_applicable/not_started.
      return { next_required_action: 'complete_trial_setup', next_action_label: 'Trial setup in progress', next_action_owner_role: 'onboarding' };
    case 'closed':
      return { next_required_action: 'no_action', next_action_label: 'Closed', next_action_owner_role: 'none' };
    default:
      return { next_required_action: 'no_action', next_action_label: '—', next_action_owner_role: 'none' };
  }
}

function deriveBadges(
  lifecycle: LifecycleStage,
  trial: TrialStage,
  commercial: CommercialStage,
  meeting: MeetingStage,
  lead: Lead,
): { primary_badge: CanonicalState['primary_badge']; secondary_badge: CanonicalState['secondary_badge'] } {
  
  // Primary badge from lifecycle
  const PRIMARY_MAP: Record<LifecycleStage, CanonicalState['primary_badge']> = {
    new_lead: { label: 'New Lead', variant: 'secondary', color: 'text-foreground' },
    contacted: { label: 'Contacted', variant: 'secondary', color: 'text-foreground' },
    replied: { label: 'Replied', variant: 'outline', color: 'text-warning' },
    meeting_booked: { label: 'Meeting Scheduled', variant: 'outline', color: 'text-primary' },
    meeting_completed: { label: 'Meeting Done', variant: 'outline', color: 'text-primary' },
    internal_decision: { label: 'Decision Pending', variant: 'outline', color: 'text-warning' },
    pricing_discussion: { label: 'Decision Pending', variant: 'outline', color: 'text-warning' },
    trial_proposed: { label: 'Moved to Client Review', variant: 'outline', color: 'text-primary' },
    trial_ready: { label: 'Moved to Client Review', variant: 'outline', color: 'text-primary' },
    trial_active: { label: 'Moved to Client Review', variant: 'outline', color: 'text-primary' },
    conversion_pending: { label: 'Awaiting Payment', variant: 'outline', color: 'text-warning' },
    converted: { label: 'Active Client', variant: 'default', color: 'text-success' },
    lost: { label: 'Closed Lost', variant: 'secondary', color: 'text-muted-foreground' },
    closed: { label: 'Closed', variant: 'secondary', color: 'text-muted-foreground' },
    unsubscribed: { label: 'Closed Lost', variant: 'secondary', color: 'text-muted-foreground' },
    cold_no_response: { label: 'Cold', variant: 'outline', color: 'text-muted-foreground' },
  };

  const primary = PRIMARY_MAP[lifecycle] || PRIMARY_MAP.new_lead;

  // Override for payment-pending
  if (lead.stage === 'payment-pending') {
    return {
      primary_badge: { label: 'Awaiting Payment', variant: 'outline', color: 'text-warning' },
      secondary_badge: commercial === 'overdue' ? { label: 'Overdue', variant: 'destructive', color: 'text-destructive' } : null,
    };
  }

  // Secondary badge
  let secondary: CanonicalState['secondary_badge'] = null;

  if (trial === 'needs_approval') secondary = { label: 'Needs approval', variant: 'outline', color: 'text-warning' };
  else if (trial === 'needs_credentials') secondary = { label: 'Blocked: credentials missing', variant: 'outline', color: 'text-warning' };
  else if (trial === 'needs_approval_and_credentials') secondary = { label: 'Needs approval + credentials', variant: 'outline', color: 'text-warning' };
  else if (trial === 'ending') {
    const dl = getTrialDaysLeft(lead);
    secondary = { label: dl !== null && dl > 0 ? `${dl}d left` : 'Expired', variant: 'outline', color: 'text-destructive' };
  }
  else if (trial === 'expired') secondary = { label: 'Expired', variant: 'destructive', color: 'text-destructive' };
  else if (commercial === 'overdue') secondary = { label: 'Overdue', variant: 'destructive', color: 'text-destructive' };
  else if (commercial === 'churn_risk') secondary = { label: 'Churn Risk', variant: 'outline', color: 'text-warning' };
  else if (meeting === 'needs_summary') secondary = { label: 'Outcome required', variant: 'outline', color: 'text-warning' };

  return { primary_badge: primary, secondary_badge: secondary };
}

function deriveUrgency(lead: Lead, lifecycle: LifecycleStage, trial: TrialStage, commercial: CommercialStage): { urgency: CanonicalState['urgency']; status_label: string; status_color: string } {
  if (commercial === 'overdue') return { urgency: 'critical', status_label: 'Payment overdue', status_color: 'text-destructive' };
  if (trial === 'expired') return { urgency: 'critical', status_label: 'Decision overdue', status_color: 'text-destructive' };
  if (trial === 'ending') return { urgency: 'high', status_label: `Decision due — ${getTrialDaysLeft(lead) ?? 0}d left`, status_color: 'text-destructive' };
  if (commercial === 'payment_pending') return { urgency: 'high', status_label: 'Payment pending', status_color: 'text-warning' };
  if (trial === 'ready_to_activate') return { urgency: 'high', status_label: 'Ready to activate', status_color: 'text-primary' };
  if (trial === 'needs_approval' || trial === 'needs_credentials' || trial === 'needs_approval_and_credentials') {
    return { urgency: 'high', status_label: 'Setup needed', status_color: 'text-warning' };
  }
  if (lifecycle === 'replied') return { urgency: 'high', status_label: 'Replied — book meeting', status_color: 'text-warning' };

  const daysSince = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86400000);

  if (daysSince >= 7) return { urgency: 'normal', status_label: `No reply in ${daysSince}d — follow up`, status_color: 'text-muted-foreground' };
  if (daysSince >= 4) return { urgency: 'normal', status_label: `Follow up due — ${daysSince}d since contact`, status_color: 'text-warning' };

  if (lifecycle === 'converted') return { urgency: 'none', status_label: 'Active client', status_color: 'text-success' };
  if (lifecycle === 'closed' || lifecycle === 'lost') return { urgency: 'none', status_label: 'Closed', status_color: 'text-muted-foreground' };
  if (lifecycle === 'trial_active') return { urgency: 'normal', status_label: `Pilot running — ${getTrialDaysLeft(lead) ?? '?'}d left`, status_color: 'text-success' };
  if (lifecycle === 'meeting_booked') {
    const nextMeeting = lead.meetingNotes?.find(m => new Date(m.date) > new Date());
    if (nextMeeting) {
      return { urgency: 'normal', status_label: `Meeting on ${new Date(nextMeeting.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, status_color: 'text-success' };
    }
    return { urgency: 'normal', status_label: 'Meeting scheduled', status_color: 'text-success' };
  }
  if (lifecycle === 'contacted') return { urgency: 'normal', status_label: 'Waiting for reply', status_color: 'text-muted-foreground' };

  return { urgency: 'normal', status_label: 'Active', status_color: 'text-muted-foreground' };
}

// ═══════════════════════════════════════════════════════════
// FLOW FILTERS — for pages
// ═══════════════════════════════════════════════════════════

export function filterByFlow(leads: Lead[], flow: EntryFlow): Lead[] {
  return leads.filter(l => deriveEntryFlow(l) === flow);
}

export function filterByRole(leads: Lead[], viewerRole: ViewerRole, viewerUser: string): Lead[] {
  switch (viewerRole) {
    case 'sdr':
      return leads.filter(l => l.assignedTo === viewerUser || l.assigned_sdr === viewerUser);
    case 'onboarding':
      return leads.filter(l =>
        ['trial-proposed', 'trial-active', 'payment-pending', 'converted'].includes(l.stage) ||
        l.assigned_onboarding_owner === viewerUser
      );
    case 'ceo':
    case 'coo':
      return leads; // see everything
  }
}

export function filterActionable(leads: Lead[], viewerRole: ViewerRole, viewerUser: string): Lead[] {
  return leads.filter(l => {
    const s = getCanonicalState(l);
    return isActionableForRole(s, viewerRole, viewerUser, l);
  });
}

// ═══════════════════════════════════════════════════════════
// ENTRY FLOW / SOURCE LABELS — for display
// ═══════════════════════════════════════════════════════════

export const FLOW_LABELS: Record<EntryFlow, string> = {
  inbound: 'Inbound',
  sdr_manual: 'SDR Manual',
};

export const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram', google_search: 'Google', linkedin_evaboot: 'LinkedIn',
  website_demo: 'Website Demo', website_form: 'Website', ai_chatbot: 'Website Chat',
  whatsapp: 'WhatsApp', instagram_dm: 'Instagram DM', linkedin_dm: 'LinkedIn DM',
  email_inbound: 'Email', referral: 'Referral', manual_import: 'Manual Import',
  other: 'Other',
};

// ═══════════════════════════════════════════════════════════
// SCENARIO CONTEXT — "What Happens Next" panel data
// Every record must explain its scenario, not just show data.
// ═══════════════════════════════════════════════════════════

export interface ScenarioContext {
  /** One-sentence explanation of the current situation */
  situation: string;
  /** Why this record is in this state */
  reason: string;
  /** What is blocking progress, if anything */
  blocker: string | null;
  /** Exact next action required */
  nextAction: string;
  /** Who must perform the next action */
  nextActionOwner: string;
  /** Role that owns the action */
  nextActionRole: OwnerRole;
  /** When the action is due, if relevant */
  dueInfo: string | null;
  /** What happens after the action is completed */
  afterCompletion: string;
}

export function deriveScenarioContext(lead: Lead): ScenarioContext {
  const cs = getCanonicalState(lead);
  const ownerName = lead.assignedTo
    ? (lead.assignedTo.charAt(0).toUpperCase() + lead.assignedTo.slice(1))
    : 'Unassigned';
  const onboardingName = (lead.assigned_onboarding_owner || 'Muneeb').charAt(0).toUpperCase() +
    (lead.assigned_onboarding_owner || 'muneeb').slice(1);

  const daysSince = cs.days_since_contact;

  switch (cs.lifecycle_stage) {
    case 'new_lead':
      if (cs.entry_flow === 'inbound') {
        return {
          situation: `Inbound lead received from ${lead.contactName}. Not yet contacted.`,
          reason: 'This lead came through an inbound channel and needs immediate response.',
          blocker: null,
          nextAction: `Contact ${lead.contactName} — respond to inbound inquiry.`,
          nextActionOwner: ownerName,
          nextActionRole: 'sdr',
          dueInfo: 'Within 10 minutes for best conversion',
          afterCompletion: 'Lead moves to Contacted, follow-up timers start.',
        };
      }
      return {
        situation: `New lead added.`,
        reason: '',
        blocker: null,
        nextAction: `Contact ${lead.contactName}.`,
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: 'Today',
        afterCompletion: '',
      };

    case 'contacted':
      if (daysSince >= 5) {
        return {
          situation: `Outreach started ${daysSince} days ago. No reply received.`,
          reason: `Day ${daysSince} — it's time to try an alternative channel.`,
          blocker: null,
          nextAction: daysSince >= 7 ? `Call ${lead.contactName} or send Instagram DM.` : `Call ${lead.contactName} — no response after ${daysSince} days.`,
          nextActionOwner: ownerName,
          nextActionRole: 'sdr',
          dueInfo: 'Today',
          afterCompletion: 'If answered and interested, book a meeting. If no answer, try Instagram DM.',
        };
      }
      return {
        situation: `Outreach started ${daysSince > 0 ? daysSince + ' days ago' : 'today'}. Waiting for reply.`,
        reason: 'Email sequence is running. Watch for reply, LinkedIn acceptance, or open signals.',
        blocker: null,
        nextAction: daysSince >= 3 ? 'Follow up — check for engagement signals.' : 'Wait for reply or signal trigger.',
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: daysSince < 3 ? `Day ${3 - daysSince} follow-up coming` : null,
        afterCompletion: 'When a reply arrives, classify it and move toward meeting.',
      };

    case 'replied':
      return {
        situation: `${lead.contactName} replied. Ready to advance.`,
        reason: 'Lead showed interest — this is the moment to book a meeting.',
        blocker: null,
        nextAction: `Book a meeting with ${lead.contactName}.`,
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: 'Today — don\'t let this go cold',
        afterCompletion: 'Meeting gets scheduled. Calendar updates. Prep task created.',
      };

    case 'meeting_booked': {
      const futureMeeting = lead.meetingNotes?.find(m => new Date(m.date) > new Date());
      const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
      if (pastNoSummary) {
        return {
          situation: 'Meeting has passed but no outcome was added.',
          reason: 'The system cannot advance without knowing what happened.',
          blocker: 'Meeting outcome missing',
          nextAction: 'Add the meeting outcome — what was discussed and decided.',
          nextActionOwner: ownerName,
          nextActionRole: 'sdr',
          dueInfo: 'Overdue — add now',
          afterCompletion: 'Record moves to the correct next stage based on outcome.',
        };
      }
      if (futureMeeting) {
        const meetDate = new Date(futureMeeting.date);
        const diffHrs = Math.round((meetDate.getTime() - Date.now()) / 3600000);
        return {
          situation: `Meeting scheduled for ${meetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${meetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
          reason: `${diffHrs <= 24 ? 'Meeting is today or tomorrow — prepare now.' : 'Meeting upcoming — review before attending.'}`,
          blocker: null,
          nextAction: diffHrs <= 2 ? 'Join the meeting, then add outcome.' : 'Prepare for the meeting — review company notes.',
          nextActionOwner: ownerName,
          nextActionRole: 'sdr',
          dueInfo: diffHrs <= 24 ? 'Today' : `In ${Math.ceil(diffHrs / 24)} days`,
          afterCompletion: 'After the meeting, add outcome to determine next stage.',
        };
      }
      return {
        situation: 'Meeting is scheduled.',
        reason: 'Prepare and attend, then add the outcome.',
        blocker: null,
        nextAction: 'Prepare for upcoming meeting.',
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: null,
        afterCompletion: 'After the meeting, add outcome.',
      };
    }

    case 'meeting_completed': {
      const followTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      return {
        situation: 'Meeting completed. Next steps depend on what was agreed.',
        reason: followTask ? `Follow-up task: "${followTask.title}"` : 'Post-meeting follow-up needed.',
        blocker: null,
        nextAction: followTask?.title || 'Follow up — propose trial or discuss pricing.',
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: followTask ? `Due ${new Date(followTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Soon',
        afterCompletion: 'If trial agreed, propose trial. If pricing, send proposal. If not fit, close.',
      };
    }

    case 'internal_decision': {
      const followTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      return {
        situation: `${lead.companyName} is reviewing internally. Waiting for their decision.`,
        reason: 'They need internal approval or alignment before proceeding.',
        blocker: null,
        nextAction: followTask?.title || `Follow up with ${lead.contactName} on their internal decision.`,
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: followTask ? `Due ${new Date(followTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Check in 2-3 days',
        afterCompletion: 'If positive, move to trial proposal or pricing discussion. If declined, close.',
      };
    }

    case 'pricing_discussion': {
      const followTask2 = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
      return {
        situation: `Pricing discussion active with ${lead.companyName}. Proposal or pricing info needed.`,
        reason: 'They want to understand pricing before committing to a trial.',
        blocker: null,
        nextAction: followTask2?.title || `Send pricing proposal to ${lead.contactName}.`,
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: followTask2 ? `Due ${new Date(followTask2.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Today',
        afterCompletion: 'After pricing is shared, follow up. If agreed, propose trial. If declined, close.',
      };
    }

    case 'trial_proposed':
    case 'trial_ready': {
      if (cs.trial_stage === 'needs_approval' || cs.trial_stage === 'needs_approval_and_credentials') {
        return {
          situation: `${lead.companyName} is in Client Review.`,
          reason: 'Leadership approval is pending.',
          blocker: 'CEO/COO approval required',
          nextAction: 'Approve.',
          nextActionOwner: 'CEO/COO',
          nextActionRole: 'leadership',
          dueInfo: 'As soon as possible',
          afterCompletion: cs.trial_stage === 'needs_approval_and_credentials'
            ? 'After approval, credentials are collected, then onboarding starts.'
            : 'After approval, onboarding starts.',
        };
      }
      if (cs.trial_stage === 'needs_credentials') {
        return {
          situation: `Approved. Credentials still needed from ${lead.companyName}.`,
          reason: 'Credentials are required before onboarding.',
          blocker: 'Credentials missing',
          nextAction: `Collect and add credentials for ${lead.companyName}.`,
          nextActionOwner: onboardingName,
          nextActionRole: 'onboarding',
          dueInfo: 'Today',
          afterCompletion: 'Once credentials are added, onboarding can start.',
        };
      }
      if (cs.trial_stage === 'ready_to_activate') {
        return {
          situation: `${lead.companyName} is ready for onboarding.`,
          reason: 'Approval complete. Credentials saved. Everything is set.',
          blocker: null,
          nextAction: 'Move to onboarding queue.',
          nextActionOwner: onboardingName,
          nextActionRole: 'onboarding',
          dueInfo: 'Today',
          afterCompletion: 'Onboarding queue begins.',
        };
      }
      return {
        situation: 'Client Review in progress.',
        reason: 'Internal process pending.',
        blocker: null,
        nextAction: 'Complete review.',
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: null,
        afterCompletion: 'Onboarding starts after requirements are met.',
      };
    }

    case 'trial_active': {
      const dl = cs.trial_days_left;
      if (dl !== null && dl <= 3) {
        return {
          situation: `Decision due in ${dl} day${dl !== 1 ? 's' : ''}.`,
          reason: 'Client decision is pending.',
          blocker: null,
          nextAction: `Record decision for ${lead.contactName}.`,
          nextActionOwner: ownerName,
          nextActionRole: 'sdr',
          dueInfo: `${dl} day${dl !== 1 ? 's' : ''} remaining`,
          afterCompletion: 'If yes, move to payment. If not, keep history.',
        };
      }
      return {
        situation: `Onboarding active.${dl !== null ? ` ${dl} days left.` : ''}`,
        reason: 'Onboarding is in progress.',
        blocker: null,
        nextAction: 'Check onboarding state.',
        nextActionOwner: onboardingName,
        nextActionRole: 'onboarding',
        dueInfo: dl !== null ? `${dl} days remaining` : null,
        afterCompletion: 'Near trial end, SDR receives conversion push task.',
      };
    }

    case 'conversion_pending':
      return {
        situation: `${lead.companyName} is ready to convert. Payment confirmation needed.`,
        reason: 'Trial ended or conversion agreed. Waiting for payment.',
        blocker: null,
        nextAction: 'Confirm payment received.',
        nextActionOwner: 'CEO/COO',
        nextActionRole: 'leadership',
        dueInfo: 'As soon as payment arrives',
        afterCompletion: 'Record becomes Active Client. Revenue updates.',
      };

    case 'converted':
      return {
        situation: `${lead.companyName} is an active client.`,
        reason: 'Payment confirmed. Client is onboarded and operational.',
        blocker: null,
        nextAction: 'No immediate action. Monitor for retention.',
        nextActionOwner: ownerName,
        nextActionRole: 'none',
        dueInfo: null,
        afterCompletion: 'Ongoing relationship management.',
      };

    case 'lost':
    case 'closed':
      return {
        situation: `${lead.companyName} is closed / archived.`,
        reason: 'Lead was disqualified, lost, or not a fit.',
        blocker: null,
        nextAction: 'No action required.',
        nextActionOwner: '—',
        nextActionRole: 'none',
        dueInfo: null,
        afterCompletion: 'Record preserved for history.',
      };

    default:
      return {
        situation: `${lead.companyName} — status unknown.`,
        reason: 'Unable to determine current state.',
        blocker: null,
        nextAction: 'Open record and review.',
        nextActionOwner: ownerName,
        nextActionRole: 'sdr',
        dueInfo: null,
        afterCompletion: 'Determine the correct stage and next action.',
      };
  }
}
