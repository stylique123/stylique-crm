/**
 * STYLIQUE CRM — Decision Engine V2
 * 
 * THE SINGLE SOURCE OF TRUTH for all outcome-to-consequence mappings.
 * 
 * Every business decision maps to:
 *   - resulting_stage
 *   - next_task (type, owner, due, reason)
 *   - timeline_event (specific language)
 *   - toast_message
 *   - calendar_effect
 *   - awareness_effect
 *   - removed_tasks
 *   - chainModal (opens next modal automatically)
 * 
 * Also retains legacy getDecisionState / getLeadershipDecisionState
 * for backward compat.
 */

import type { Lead, Stage, DealTask } from '@/types/crm';
import {
  STAGE_LABELS, TRIAL_STAGES, CONVERTED_STAGES, CLOSED_STAGES,
  getTrialDaysLeft, hasValidCredentials, PLAN_PRICES,
  getPaymentDaysUntilDue,
} from '@/types/crm';
// Apollo sequence engine removed — AI outbound flow is no longer part of the CRM.

// ═══════════════════════════════════════════════════════════
// CONSEQUENCE — what happens after any decision
// ═══════════════════════════════════════════════════════════

export interface DecisionConsequence {
  resultingStage: Stage | null;
  nextTask: {
    title: string;
    type: DealTask['type'];
    owner: 'sdr' | 'onboarding' | 'leadership';
    dueRule: 'now' | 'tomorrow' | 'in_2_days' | 'in_3_days' | 'selected_date';
    priority: 'critical' | 'high' | 'medium';
    reason: string;
    stageFamily: string;
  } | null;
  timelineEvent: string;
  toastTitle: string;
  toastDescription: string;
  calendarEffect: 'none' | 'create_meeting' | 'close_meeting' | 'reschedule_meeting';
  awarenessEffect: string | null;
  removedTaskTypes: DealTask['type'][];
  chainModal: 'book_meeting' | 'add_credentials' | null;
}

// ═══════════════════════════════════════════════════════════
// REPLY DECISIONS
// ═══════════════════════════════════════════════════════════

export type ReplyDecision =
  | 'interested_wants_meeting'
  | 'interested_wants_info'
  | 'interested_wants_pricing'
  | 'interested_followup_later'
  | 'ready_to_meet'
  | 'not_interested'
  | 'wrong_person'
  | 'ambiguous';

export const REPLY_DECISIONS: Record<ReplyDecision, {
  label: string;
  description: string;
  requiresDate: boolean;
  consequence: (lead: Lead) => DecisionConsequence;
}> = {
  interested_wants_meeting: {
    label: 'Interested — wants meeting',
    description: 'Ready to schedule a meeting',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Book meeting with ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'Lead interested and wants to meet — book today', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: interested, wants meeting with ${lead.contactName}`,
      toastTitle: 'Reply classified: interested', toastDescription: 'Book meeting task created — due now',
      calendarEffect: 'none', awarenessEffect: null,
      removedTaskTypes: ['outreach', 'follow-up'], chainModal: 'book_meeting',
    }),
  },
  interested_wants_info: {
    label: 'Interested — wants more info',
    description: 'Asked for materials or details first',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Send requested info to ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Lead asked for more information — send today', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: interested, wants more info`,
      toastTitle: 'Reply: wants info', toastDescription: 'Send info task created — due now',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach'], chainModal: null,
    }),
  },
  interested_wants_pricing: {
    label: 'Interested — wants pricing',
    description: 'Asked for pricing or proposal',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Send pricing / proposal to ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Lead asked for pricing — send proposal today', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: interested, wants pricing`,
      toastTitle: 'Reply: wants pricing', toastDescription: 'Send pricing task created — due now',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach'], chainModal: null,
    }),
  },
  interested_followup_later: {
    label: 'Interested — follow up later',
    description: 'Interested but not ready now',
    requiresDate: true,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Follow up with ${lead.contactName} — reconnect`, type: 'follow-up', owner: 'sdr', dueRule: 'selected_date', priority: 'medium', reason: 'Lead interested but not ready — follow up on agreed date', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: interested, follow up later`,
      toastTitle: 'Reply: follow up later', toastDescription: 'Follow-up task created for selected date',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach'], chainModal: null,
    }),
  },
  ready_to_meet: {
    label: 'Ready to meet now',
    description: 'Wants to book immediately',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Book meeting with ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'Lead ready to meet — book immediately', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: ready to meet now`,
      toastTitle: 'Reply: ready to meet', toastDescription: 'Opening meeting booking...',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach', 'follow-up'], chainModal: 'book_meeting',
    }),
  },
  not_interested: {
    label: 'Not interested',
    description: 'Declined — close the lead',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'closed-lost',
      nextTask: null,
      timelineEvent: `Reply classified: not interested — ${lead.companyName} closed`,
      toastTitle: 'Lead closed', toastDescription: `${lead.companyName} archived — not interested`,
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach', 'follow-up', 'meeting-prep'], chainModal: null,
    }),
  },
  wrong_person: {
    label: 'Wrong person',
    description: 'Need to find alternate contact',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: null,
      nextTask: { title: `Find alternate contact at ${lead.companyName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Wrong person replied — find the right contact', stageFamily: 'prospecting' },
      timelineEvent: `Reply classified: wrong person — need alternate contact`,
      toastTitle: 'Wrong person', toastDescription: 'Find alternate contact task created',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: [], chainModal: null,
    }),
  },
  ambiguous: {
    label: 'Unclear / ambiguous',
    description: 'Vague reply — clarify intent',
    requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'sdr-replied',
      nextTask: { title: `Clarify intent with ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Unclear reply — clarify what they want', stageFamily: 'engagement' },
      timelineEvent: `Reply classified: ambiguous — needs clarification`,
      toastTitle: 'Reply: needs clarification', toastDescription: 'Clarify intent task created — due now',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: ['outreach'], chainModal: null,
    }),
  },
};

// ═══════════════════════════════════════════════════════════
// MEETING DECISIONS
// ═══════════════════════════════════════════════════════════

export type MeetingDecision =
  | 'qualified_standard_trial'
  | 'qualified_custom_trial'
  | 'qualified_pricing_first'
  | 'qualified_internal_decision'
  | 'qualified_send_materials'
  | 'rescheduled'
  | 'no_show'
  | 'not_a_fit'
  | 'trial_verbally_approved';

export const MEETING_DECISIONS: Record<MeetingDecision, {
  label: string;
  description: string;
  requiresDate: boolean;
  requiresNotes: boolean;
  consequence: (lead: Lead) => DecisionConsequence;
}> = {
  qualified_standard_trial: {
    label: 'Standard 14-day client review',
    description: 'Client agreed to a standard 14-day client review',
    requiresDate: false, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: 'trial-proposed',
      nextTask: { title: `Get client-review approval — ${lead.companyName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'Standard client review agreed — CEO/COO approval required', stageFamily: 'trial-prep' },
      timelineEvent: `Meeting outcome: standard 14-day client review proposed for ${lead.companyName}`,
      toastTitle: 'Client review proposed: standard 14-day', toastDescription: 'Approval request created → CEO/COO + onboarding notified',
      calendarEffect: 'close_meeting', awarenessEffect: 'CEO/COO approval + onboarding prep',
      removedTaskTypes: ['meeting-prep', 'meeting-summary'], chainModal: null,
    }),
  },
  qualified_custom_trial: {
    label: 'Custom client-review duration',
    description: 'Non-standard client-review period negotiated',
    requiresDate: false, requiresNotes: true,
    consequence: (lead) => ({
      resultingStage: 'trial-proposed',
      nextTask: { title: `Get custom client-review approval — ${lead.companyName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'Custom client review agreed — CEO/COO approval + terms confirmation required', stageFamily: 'trial-prep' },
      timelineEvent: `Meeting outcome: custom client review proposed for ${lead.companyName}`,
      toastTitle: 'Client review proposed: custom duration', toastDescription: 'Approval request created with custom terms',
      calendarEffect: 'close_meeting', awarenessEffect: 'CEO/COO approval + onboarding prep',
      removedTaskTypes: ['meeting-prep', 'meeting-summary'], chainModal: null,
    }),
  },
  qualified_pricing_first: {
    label: 'Pricing discussion first',
    description: 'Wants pricing/proposal before client review',
    requiresDate: false, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: 'meeting-completed',
      nextTask: { title: `Send pricing to ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Client wants pricing before committing', stageFamily: 'meeting' },
      timelineEvent: `Meeting outcome: qualified, pricing discussion first`,
      toastTitle: 'Meeting result added: pricing first', toastDescription: 'Send pricing task created — due now',
      calendarEffect: 'close_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep'], chainModal: null,
    }),
  },
  qualified_internal_decision: {
    label: 'Internal decision pending',
    description: 'Needs internal buy-in — follow up later',
    requiresDate: true, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: 'meeting-completed',
      nextTask: { title: `Follow up on internal decision — ${lead.companyName}`, type: 'follow-up', owner: 'sdr', dueRule: 'selected_date', priority: 'high', reason: 'Waiting on internal decision — follow up on agreed date', stageFamily: 'meeting' },
      timelineEvent: `Meeting outcome: internal decision pending at ${lead.companyName}`,
      toastTitle: 'Meeting result added: internal decision', toastDescription: 'Follow-up task created for selected date',
      calendarEffect: 'close_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep'], chainModal: null,
    }),
  },
  qualified_send_materials: {
    label: 'Send materials / case study',
    description: 'Client wants materials before deciding',
    requiresDate: false, requiresNotes: true,
    consequence: (lead) => ({
      resultingStage: 'meeting-completed',
      nextTask: { title: `Send materials to ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'high', reason: 'Client requested materials/case study in meeting', stageFamily: 'meeting' },
      timelineEvent: `Meeting outcome: send materials requested by ${lead.contactName}`,
      toastTitle: 'Meeting result added: materials requested', toastDescription: 'Send materials task created — due now',
      calendarEffect: 'close_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep'], chainModal: null,
    }),
  },
  rescheduled: {
    label: 'Rescheduled',
    description: 'Meeting moved to a new date',
    requiresDate: true, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: null,
      nextTask: { title: `Prepare for rescheduled meeting — ${lead.companyName}`, type: 'meeting-prep', owner: 'sdr', dueRule: 'selected_date', priority: 'medium', reason: 'Meeting rescheduled — prepare for new date', stageFamily: 'meeting' },
      timelineEvent: `Meeting rescheduled for ${lead.companyName}`,
      toastTitle: 'Meeting rescheduled', toastDescription: 'Old meeting closed, new meeting created',
      calendarEffect: 'reschedule_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep'], chainModal: null,
    }),
  },
  no_show: {
    label: 'No show',
    description: 'Client did not attend',
    requiresDate: false, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: null,
      nextTask: { title: `Reschedule after no-show — ${lead.contactName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'No-show — call or email to reschedule immediately', stageFamily: 'meeting' },
      timelineEvent: `No-show: ${lead.contactName} missed meeting`,
      toastTitle: 'No-show recorded', toastDescription: 'Reschedule task created — contact now',
      calendarEffect: 'close_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep'], chainModal: null,
    }),
  },
  not_a_fit: {
    label: 'Not a fit',
    description: 'Not suitable — close lead',
    requiresDate: false, requiresNotes: true,
    consequence: (lead) => ({
      resultingStage: 'closed-lost',
      nextTask: null,
      timelineEvent: `Meeting outcome: not a fit — ${lead.companyName} closed`,
      toastTitle: 'Lead closed after meeting', toastDescription: `${lead.companyName} archived — not a fit`,
      calendarEffect: 'close_meeting', awarenessEffect: null,
      removedTaskTypes: ['meeting-prep', 'meeting-summary', 'follow-up'], chainModal: null,
    }),
  },
  trial_verbally_approved: {
    label: 'Client review agreed in meeting',
    description: 'Verbal agreement — needs formal approval',
    requiresDate: false, requiresNotes: false,
    consequence: (lead) => ({
      resultingStage: 'trial-proposed',
      nextTask: { title: `Formalize client-review approval — ${lead.companyName}`, type: 'follow-up', owner: 'sdr', dueRule: 'now', priority: 'critical', reason: 'Verbal client-review agreement in meeting — get CEO/COO formal approval today', stageFamily: 'trial-prep' },
      timelineEvent: `Meeting outcome: client review verbally approved by ${lead.contactName}`,
      toastTitle: 'Client review verbally approved', toastDescription: 'Formal approval request created → CEO/COO + onboarding notified',
      calendarEffect: 'close_meeting', awarenessEffect: 'CEO/COO approval + onboarding prep',
      removedTaskTypes: ['meeting-prep', 'meeting-summary'], chainModal: null,
    }),
  },
};

// ═══════════════════════════════════════════════════════════
// PAYMENT DECISIONS
// ═══════════════════════════════════════════════════════════

export type PaymentDecision = 'payment_received' | 'payment_promised' | 'payment_delayed' | 'payment_refused';

export const PAYMENT_DECISIONS: Record<PaymentDecision, {
  label: string;
  description: string;
  requiresDate: boolean;
  consequence: (lead: Lead) => DecisionConsequence;
}> = {
  payment_received: {
    label: 'Payment received', description: 'Payment confirmed — activate as client', requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'converted', nextTask: null,
      timelineEvent: `Payment confirmed — ${lead.companyName} is now an active client`,
      toastTitle: 'Payment confirmed', toastDescription: `${lead.companyName} moved to Active Client — revenue updated`,
      calendarEffect: 'none', awarenessEffect: null,
      removedTaskTypes: ['payment', 'conversion-push', 'trial-end', 'follow-up'], chainModal: null,
    }),
  },
  payment_promised: {
    label: 'Payment promised on date', description: 'Client committed to pay on specific date', requiresDate: true,
    consequence: (lead) => ({
      resultingStage: null, nextTask: { title: `Payment reminder — ${lead.companyName}`, type: 'payment', owner: 'sdr', dueRule: 'selected_date', priority: 'high', reason: 'Payment promised — follow up on agreed date', stageFamily: 'payment' },
      timelineEvent: `Payment promised by ${lead.contactName} — follow up scheduled`,
      toastTitle: 'Payment promised', toastDescription: 'Reminder task created for agreed date',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: [], chainModal: null,
    }),
  },
  payment_delayed: {
    label: 'Payment delayed', description: 'Client asked for more time', requiresDate: false,
    consequence: (lead) => ({
      resultingStage: null, nextTask: { title: `Payment follow-up — ${lead.companyName}`, type: 'payment', owner: 'sdr', dueRule: 'in_2_days', priority: 'high', reason: 'Payment delayed — follow up in 2 days', stageFamily: 'payment' },
      timelineEvent: `Payment delayed — ${lead.contactName} asked for more time`,
      toastTitle: 'Payment delayed', toastDescription: 'Follow-up task created — due in 2 days',
      calendarEffect: 'none', awarenessEffect: null, removedTaskTypes: [], chainModal: null,
    }),
  },
  payment_refused: {
    label: 'Payment refused / stalled', description: 'Client will not pay — close', requiresDate: false,
    consequence: (lead) => ({
      resultingStage: 'closed-lost', nextTask: null,
      timelineEvent: `Payment refused — ${lead.companyName} deal closed`,
      toastTitle: 'Deal closed', toastDescription: `${lead.companyName} archived — payment refused`,
      calendarEffect: 'none', awarenessEffect: null,
      removedTaskTypes: ['payment', 'conversion-push', 'trial-end', 'follow-up'], chainModal: null,
    }),
  },
};

// ═══════════════════════════════════════════════════════════
// DRAG-DROP VALIDATION
// ═══════════════════════════════════════════════════════════

export interface DragValidation {
  allowed: boolean;
  reason: string;
  requiresModal: 'reply_classification' | 'meeting_booking' | 'meeting_outcome' | 'outreach_start' | 'trial_proposal' | 'close_reason' | 'payment' | 'trial_activation' | null;
  hint: string;
}

const COLUMN_ORDER = ['new_lead', 'contacted', 'replied', 'meeting_booked', 'meeting_completed', 'trial_proposed', 'trial_active', 'converted'];

export function validateDragDrop(lead: Lead, fromColumn: string, toColumn: string): DragValidation {
  if (fromColumn === toColumn) return { allowed: false, reason: 'Already in this stage', requiresModal: null, hint: '' };
  
  if (toColumn === 'closed') return { allowed: true, reason: '', requiresModal: 'close_reason', hint: 'Requires close reason' };
  
  const fromIdx = COLUMN_ORDER.indexOf(fromColumn);
  const toIdx = COLUMN_ORDER.indexOf(toColumn);
  
  // Backward move
  if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) {
    return { allowed: false, reason: 'Cannot move backward — use appropriate action', requiresModal: null, hint: '' };
  }
  // Skip >2 stages
  if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx + 2) {
    return { allowed: false, reason: 'Cannot skip stages — complete each step', requiresModal: null, hint: '' };
  }

  const MODAL_MAP: Record<string, DragValidation> = {
    contacted: { allowed: true, reason: '', requiresModal: 'outreach_start', hint: 'Requires outreach confirmation' },
    replied: { allowed: true, reason: '', requiresModal: 'reply_classification', hint: 'Requires reply classification' },
    meeting_booked: { allowed: true, reason: '', requiresModal: 'meeting_booking', hint: 'Requires meeting details' },
    meeting_completed: { allowed: true, reason: '', requiresModal: 'meeting_outcome', hint: 'Requires meeting outcome' },
    trial_proposed: { allowed: true, reason: '', requiresModal: 'trial_proposal', hint: 'Requires client-review details' },
    trial_active: !lead.approvedBy
      ? { allowed: false, reason: 'Client review needs CEO/COO approval first', requiresModal: null, hint: '' }
      : { allowed: true, reason: '', requiresModal: 'trial_activation', hint: 'Use activation flow' },
    converted: { allowed: false, reason: 'Conversion requires payment confirmation — open the record', requiresModal: null, hint: '' },
  };
  
  return MODAL_MAP[toColumn] || { allowed: true, reason: '', requiresModal: null, hint: '' };
}

/** Get valid drop targets for a column */
export function getValidDropTargets(fromColumn: string, lead: Lead): Set<string> {
  const targets = new Set<string>();
  const allCols = [...COLUMN_ORDER, 'closed'];
  for (const col of allCols) {
    const validation = validateDragDrop(lead, fromColumn, col);
    if (validation.allowed) targets.add(col);
  }
  return targets;
}

// ═══════════════════════════════════════════════════════════
// CONSEQUENCE PREVIEW
// ═══════════════════════════════════════════════════════════

export function formatConsequencePreview(consequence: DecisionConsequence): string[] {
  const lines: string[] = [];
  if (consequence.resultingStage) lines.push(`→ Move to ${consequence.resultingStage.replace(/-/g, ' ')}`);
  if (consequence.nextTask) {
    lines.push(`→ Create task: ${consequence.nextTask.title}`);
    lines.push(`→ Owner: ${consequence.nextTask.owner === 'sdr' ? 'SDR (you)' : consequence.nextTask.owner}`);
    const dueMap: Record<string, string> = { now: 'Due now', tomorrow: 'Due tomorrow', in_2_days: 'Due in 2 days', in_3_days: 'Due in 3 days', selected_date: 'Due on selected date' };
    lines.push(`→ ${dueMap[consequence.nextTask.dueRule] || 'Due now'}`);
  }
  if (consequence.removedTaskTypes.length > 0) lines.push(`→ Archive: ${consequence.removedTaskTypes.join(', ')} tasks`);
  if (consequence.calendarEffect !== 'none') {
    const calMap = { create_meeting: 'Create calendar event', close_meeting: 'Close current meeting', reschedule_meeting: 'Reschedule meeting' };
    lines.push(`→ ${calMap[consequence.calendarEffect]}`);
  }
  if (consequence.awarenessEffect) lines.push(`→ Notify: ${consequence.awarenessEffect}`);
  return lines;
}

export function resolveDueDate(rule: string, selectedDate?: string): string {
  switch (rule) {
    case 'now': return new Date().toISOString();
    case 'tomorrow': return new Date(Date.now() + 86400000).toISOString();
    case 'in_2_days': return new Date(Date.now() + 2 * 86400000).toISOString();
    case 'in_3_days': return new Date(Date.now() + 3 * 86400000).toISOString();
    case 'selected_date': return selectedDate ? new Date(selectedDate).toISOString() : new Date(Date.now() + 2 * 86400000).toISOString();
    default: return new Date().toISOString();
  }
}

// ═══════════════════════════════════════════════════════════
// LEGACY: DecisionState (backward compat)
// ═══════════════════════════════════════════════════════════

export interface DecisionState {
  summary: string;
  nextAction: string;
  reason: string;
  urgency: 'critical' | 'action-needed' | 'on-track' | 'waiting';
  actionType: 'call' | 'email' | 'linkedin' | 'meeting' | 'setup' | 'payment' | 'confirm' | 'review' | 'none';
}

export function getLeadershipDecisionState(lead: Lead): DecisionState {
  const hasCreds = hasValidCredentials(lead);
  const daysLeft = getTrialDaysLeft(lead);
  if (CLOSED_STAGES.includes(lead.stage)) return { summary: `Closed — ${lead.companyName}`, nextAction: 'No action needed', reason: 'Deal is closed', urgency: 'waiting', actionType: 'none' };
  if (lead.stage === 'payment-pending') {
    const payDays = getPaymentDaysUntilDue(lead);
    const amount = PLAN_PRICES[lead.subscriptionPlan || 'starter'] || 0;
    if (payDays !== null && payDays < 0) return { summary: `Payment $${amount} — ${Math.abs(payDays)}d overdue`, nextAction: `Payment overdue — ${lead.companyName}`, reason: 'Overdue', urgency: 'critical', actionType: 'payment' };
    return { summary: `Waiting for $${amount} payment`, nextAction: `Confirm payment from ${lead.contactName}`, reason: payDays !== null ? `Due in ${payDays} days` : 'Awaiting payment', urgency: 'action-needed', actionType: 'payment' };
  }
  if (lead.stage === 'trial-proposed') {
    if (!lead.approvedBy && !hasCreds) return { summary: `Client review needs approval + credentials`, nextAction: `Approve client review for ${lead.companyName}`, reason: 'Missing: approval, credentials', urgency: 'action-needed', actionType: 'confirm' };
    if (!lead.approvedBy) return { summary: `Client review needs approval`, nextAction: `Approve client review for ${lead.companyName}`, reason: 'Credentials ready — approval needed', urgency: 'action-needed', actionType: 'confirm' };
    if (!hasCreds) return { summary: `Ready to start — blocked by missing credentials`, nextAction: 'Onboarding to add credentials', reason: 'With onboarding', urgency: 'on-track', actionType: 'none' };
    return { summary: 'Ready to activate client', nextAction: 'Onboarding will activate', reason: 'Approved + credentials ready', urgency: 'on-track', actionType: 'none' };
  }
  if (lead.stage === 'trial-active') {
    if (daysLeft !== null && daysLeft <= 0) return { summary: `Onboarding window ended`, nextAction: 'Review conversion status', reason: 'With sales', urgency: 'critical', actionType: 'review' };
    if (daysLeft !== null && daysLeft <= 3) return { summary: `Renewal due in ${daysLeft}d`, nextAction: 'Monitor conversion risk', reason: `${daysLeft}d left`, urgency: 'action-needed', actionType: 'review' };
    return { summary: `Active client — ${daysLeft ?? '?'}d left in onboarding window`, nextAction: 'Onboarding monitoring', reason: 'With onboarding', urgency: 'on-track', actionType: 'none' };
  }
  if (CONVERTED_STAGES.includes(lead.stage)) {
    const payDays = getPaymentDaysUntilDue(lead);
    if (lead.paymentStatus === 'overdue' || (payDays !== null && payDays < 0)) return { summary: `Client — payment overdue`, nextAction: `Review overdue payment`, reason: `$${PLAN_PRICES[lead.subscriptionPlan || 'starter']}/mo at risk`, urgency: 'critical', actionType: 'payment' };
    return { summary: `Active client — ${lead.subscriptionPlan || 'starter'} plan`, nextAction: 'Client on track', reason: 'No action needed', urgency: 'on-track', actionType: 'none' };
  }
  const ownerName = lead.assignedTo || 'SDR';
  return { summary: `${STAGE_LABELS[lead.stage] || lead.stage} — Sales owner: ${ownerName}`, nextAction: 'Sales handling', reason: 'With sales', urgency: 'on-track', actionType: 'none' };
}

export function getDecisionState(lead: Lead): DecisionState {
  const daysLeft = getTrialDaysLeft(lead);
  const hasCreds = hasValidCredentials(lead);
  const daysSinceContact = lead.lastContactedAt ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000) : null;
  if (CLOSED_STAGES.includes(lead.stage)) return { summary: `Closed — ${lead.companyName}`, nextAction: 'No action needed', reason: 'Deal is closed', urgency: 'waiting', actionType: 'none' };
  if (CONVERTED_STAGES.includes(lead.stage)) {
    const payDays = getPaymentDaysUntilDue(lead);
    if (lead.paymentStatus === 'overdue' || (payDays !== null && payDays < 0)) return { summary: `Active client — payment ${payDays ? Math.abs(payDays) : 0}d overdue`, nextAction: `Collect payment from ${lead.contactName}`, reason: `$${PLAN_PRICES[lead.subscriptionPlan || 'starter']}/mo overdue`, urgency: 'critical', actionType: 'payment' };
    return { summary: `Active client — ${lead.subscriptionPlan || 'starter'} plan`, nextAction: payDays !== null && payDays <= 7 ? `Payment due in ${payDays}d` : 'Client on track', reason: 'Retention mode', urgency: 'on-track', actionType: 'none' };
  }
  if (lead.stage === 'payment-pending') {
    const payDays = getPaymentDaysUntilDue(lead);
    const amount = PLAN_PRICES[lead.subscriptionPlan || 'starter'] || 0;
    if (payDays !== null && payDays < 0) return { summary: `Payment $${amount} — ${Math.abs(payDays)}d overdue`, nextAction: `Call ${lead.contactName} to collect payment`, reason: 'Revenue at risk — payment overdue', urgency: 'critical', actionType: 'call' };
    return { summary: `Waiting for $${amount} payment`, nextAction: `Confirm payment from ${lead.contactName}`, reason: payDays !== null ? `Due in ${payDays} days` : 'Awaiting payment', urgency: 'action-needed', actionType: 'payment' };
  }
  if (TRIAL_STAGES.includes(lead.stage) && lead.trialStartDate) {
    const elapsed = Math.ceil((Date.now() - new Date(lead.trialStartDate).getTime()) / 86400000);
    const total = lead.trialEndDate ? Math.ceil((new Date(lead.trialEndDate).getTime() - new Date(lead.trialStartDate).getTime()) / 86400000) : 14;
    if (daysLeft !== null && daysLeft <= 0) return { summary: `Decision overdue`, nextAction: `Record decision for ${lead.contactName}`, reason: 'Decision overdue', urgency: 'critical', actionType: 'call' };
    if (daysLeft !== null && daysLeft <= 2) return { summary: `Decision due — ${daysLeft}d left`, nextAction: `Record decision for ${lead.contactName}`, reason: `Decision due in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`, urgency: 'critical', actionType: 'call' };
    const nextTask = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
    if (nextTask) {
      const action = nextTask.type === 'conversion-push' ? `Call ${lead.contactName} today — renewal due in ${daysLeft}d` : nextTask.title;
      return { summary: `Active client — Day ${elapsed} of ${total} — ${daysLeft}d left`, nextAction: action, reason: nextTask.reason || 'Scheduled task', urgency: daysLeft !== null && daysLeft <= 5 ? 'action-needed' : 'on-track', actionType: nextTask.type === 'conversion-push' ? 'call' : 'review' };
    }
    return { summary: `Active client — Day ${elapsed} of ${total} — ${daysLeft}d left`, nextAction: 'On track — no action needed now', reason: 'On track', urgency: 'on-track', actionType: 'none' };
  }
  if (lead.stage === 'trial-proposed') {
    const needs = [];
    if (!lead.approvedBy) needs.push('approval');
    if (!hasCreds) needs.push('credentials');
    if (needs.length > 0) return { summary: `Client review cannot start — needs ${needs.join(' + ')}`, nextAction: `Start onboarding setup for ${lead.companyName}`, reason: `Missing: ${needs.join(', ')}`, urgency: 'action-needed', actionType: 'setup' };
    return { summary: 'Ready to activate client', nextAction: `Activate client — ${lead.companyName}`, reason: 'Approved + credentials ready', urgency: 'action-needed', actionType: 'confirm' };
  }
  if (lead.stage === 'meeting-booked') {
    const now = new Date();
    const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < now && !m.summary?.trim());
    if (pastNoSummary) return { summary: 'Meeting completed — needs summary', nextAction: `Add meeting notes for ${lead.companyName}`, reason: 'Record outcome before proceeding', urgency: 'action-needed', actionType: 'confirm' };
    const future = lead.meetingNotes?.find(m => new Date(m.date) > now);
    if (future) {
      const daysUntil = Math.ceil((new Date(future.date).getTime() - now.getTime()) / 86400000);
      return { summary: `Meeting in ${daysUntil}d`, nextAction: daysUntil <= 1 ? `Prepare for meeting with ${lead.companyName}` : `Meeting scheduled — ${daysUntil}d away`, reason: daysUntil <= 1 ? 'Research brand + test product' : 'On track', urgency: daysUntil <= 1 ? 'action-needed' : 'on-track', actionType: daysUntil <= 1 ? 'review' : 'none' };
    }
    return { summary: 'Meeting booked — waiting', nextAction: `Prepare for ${lead.companyName} meeting`, reason: 'Research before meeting', urgency: 'on-track', actionType: 'review' };
  }
  if (lead.stage === 'replied' || lead.stage === 'sdr-replied') return { summary: `${lead.contactName} replied${daysSinceContact ? ` — ${daysSinceContact}d ago` : ''}`, nextAction: `Book meeting with ${lead.contactName}`, reason: 'Lead is engaged — schedule meeting now', urgency: daysSinceContact && daysSinceContact >= 2 ? 'critical' : 'action-needed', actionType: 'meeting' };
  if (lead.stage === 'awaiting-sdr') return { summary: 'Sequence completed — no reply', nextAction: `Call ${lead.contactName} now`, reason: 'All automated steps done — manual outreach needed', urgency: 'action-needed', actionType: 'call' };
  if (lead.stage === 'new-inquiry' || (lead.pipeline === 'inbound' && lead.stage === 'qualified')) return { summary: 'Inbound lead — needs response', nextAction: `Contact ${lead.contactName} immediately`, reason: 'Inbound leads need response within 10 minutes', urgency: 'critical', actionType: 'call' };
  if (lead.stage === 'new-lead' || lead.stage === 'sdr-new-lead') return { summary: 'New lead', nextAction: `Contact ${lead.contactName}`, reason: '', urgency: 'action-needed', actionType: 'email' };
  if (lead.stage === 'contacted' || lead.stage === 'sdr-contacted') return { summary: `Contacted${daysSinceContact ? ` — ${daysSinceContact}d ago` : ''}`, nextAction: daysSinceContact && daysSinceContact >= 3 ? `Follow up with ${lead.contactName}` : 'Waiting for reply', reason: daysSinceContact && daysSinceContact >= 3 ? `No response for ${daysSinceContact} days` : 'Give time to respond', urgency: daysSinceContact && daysSinceContact >= 4 ? 'action-needed' : 'waiting', actionType: daysSinceContact && daysSinceContact >= 3 ? 'email' : 'none' };
  return { summary: STAGE_LABELS[lead.stage] || 'Unknown state', nextAction: 'Review this lead', reason: 'System needs attention', urgency: 'action-needed', actionType: 'review' };
}

// ═══════════════════════════════════════════════════════════
// LEGACY: Outcome → Next Action Mapping
// ═══════════════════════════════════════════════════════════

export type StepOutcome = 'no-response' | 'replied' | 'interested' | 'not-interested' | 'call-later' | 'voicemail' | 'wrong-number' | 'attended' | 'rescheduled' | 'no-show' | 'trial-proposed' | 'paid' | 'payment-delayed' | 'converted' | 'churning';

export type OutcomeIcon = 'clock' | 'message' | 'thumbs-up' | 'thumbs-down' | 'phone' | 'calendar' | 'check' | 'alert' | 'x';

export interface OutcomeMapping {
  value: StepOutcome;
  label: string;
  description: string;
  icon: OutcomeIcon;
}

export function getOutcomeOptions(actionType: DecisionState['actionType'], stage: string): OutcomeMapping[] {
  if (actionType === 'call') {
    return [
      { value: 'interested', label: 'Interested', description: 'Wants to continue', icon: 'thumbs-up' },
      { value: 'call-later', label: 'Call later', description: 'Asked to call back', icon: 'clock' },
      { value: 'voicemail', label: 'Voicemail', description: 'Left voicemail', icon: 'phone' },
      { value: 'not-interested', label: 'Not interested', description: 'Declined', icon: 'thumbs-down' },
      { value: 'wrong-number', label: 'Wrong number', description: 'Update contact info', icon: 'alert' },
      { value: 'no-response', label: 'No answer', description: 'No pickup', icon: 'x' },
    ];
  }
  if (actionType === 'meeting') {
    return [
      { value: 'attended', label: 'Attended', description: 'Meeting happened', icon: 'check' },
      { value: 'trial-proposed', label: 'Client review proposed', description: 'Agreed to client review', icon: 'calendar' },
      { value: 'rescheduled', label: 'Rescheduled', description: 'New date set', icon: 'clock' },
      { value: 'no-show', label: 'No show', description: 'Did not attend', icon: 'x' },
      { value: 'not-interested', label: 'Not a fit', description: 'Not proceeding', icon: 'thumbs-down' },
    ];
  }
  if (actionType === 'payment') {
    return [
      { value: 'paid', label: 'Payment received', description: 'Confirmed payment', icon: 'check' },
      { value: 'payment-delayed', label: 'Payment delayed', description: 'Promised later', icon: 'clock' },
      { value: 'not-interested', label: 'Deal lost', description: 'Will not pay', icon: 'x' },
    ];
  }
  // Default for email/linkedin/other
  return [
    { value: 'replied', label: 'Replied', description: 'Got a response', icon: 'message' },
    { value: 'interested', label: 'Interested', description: 'Positive signal', icon: 'thumbs-up' },
    { value: 'not-interested', label: 'Not interested', description: 'Declined', icon: 'thumbs-down' },
    { value: 'no-response', label: 'No response', description: 'Still waiting', icon: 'clock' },
  ];
}

export interface NextActionFromOutcome {
  nextAction: string;
  action: string; // alias for nextAction for backward compat
  reason: string;
  urgency: 'critical' | 'action-needed' | 'on-track' | 'waiting';
  dueIn: string;
  stage?: string;
}

const OUTCOME_STAGE_MAP: Partial<Record<StepOutcome, string>> = {
  'replied': 'replied',
  'interested': 'replied',
  'not-interested': 'lost',
  'attended': 'meeting-done',
  'rescheduled': 'meeting-booked',
  'no-show': 'meeting-booked',
  'trial-proposed': 'trial-proposed',
  'paid': 'active-client',
  'converted': 'active-client',
};

export function getNextActionFromOutcome(lead: Lead, outcome: StepOutcome): NextActionFromOutcome {
  const stage = OUTCOME_STAGE_MAP[outcome];
  const map: Record<StepOutcome, Omit<NextActionFromOutcome, 'stage' | 'action'>> = {
    'no-response': { nextAction: `Continue outreach sequence for ${lead.contactName}`, reason: 'No response yet — system will prompt next step', urgency: 'waiting', dueIn: 'Auto-scheduled' },
    'replied': { nextAction: `Respond to ${lead.contactName} today`, reason: 'Lead replied — respond same day', urgency: 'critical', dueIn: 'Today' },
    'interested': { nextAction: `Book meeting with ${lead.contactName}`, reason: 'Lead expressed interest', urgency: 'critical', dueIn: 'Today' },
    'not-interested': { nextAction: `Close ${lead.companyName}`, reason: 'Lead declined', urgency: 'on-track', dueIn: 'Now' },
    'call-later': { nextAction: `Call ${lead.contactName} on agreed date`, reason: 'Call-back requested', urgency: 'action-needed', dueIn: 'On agreed date' },
    'voicemail': { nextAction: `Follow up ${lead.contactName} via email or LinkedIn`, reason: 'Voicemail left — try alternate channel', urgency: 'action-needed', dueIn: 'Tomorrow' },
    'wrong-number': { nextAction: `Find correct number for ${lead.contactName}`, reason: 'Wrong number — update contact info', urgency: 'action-needed', dueIn: 'Today' },
    'attended': { nextAction: `Add meeting outcome for ${lead.companyName}`, reason: 'Meeting attended — record result', urgency: 'critical', dueIn: 'Now' },
    'rescheduled': { nextAction: `Prepare for rescheduled meeting with ${lead.companyName}`, reason: 'New meeting date set', urgency: 'on-track', dueIn: 'Before meeting' },
    'no-show': { nextAction: `Call ${lead.contactName} — reschedule`, reason: 'Client did not attend', urgency: 'critical', dueIn: 'Now' },
    'trial-proposed': { nextAction: `Get CEO/COO approval for ${lead.companyName} client review`, reason: 'Client review proposed — approval required', urgency: 'critical', dueIn: 'Today' },
    'paid': { nextAction: `Welcome ${lead.companyName} as client`, reason: 'Payment confirmed', urgency: 'on-track', dueIn: 'Today' },
    'payment-delayed': { nextAction: `Follow up payment for ${lead.companyName}`, reason: 'Payment delayed', urgency: 'action-needed', dueIn: 'In 2 days' },
    'converted': { nextAction: `Set up ${lead.companyName} account`, reason: 'Client converted', urgency: 'action-needed', dueIn: 'Today' },
    'churning': { nextAction: `Call ${lead.contactName} — retention risk`, reason: 'Churn signals detected', urgency: 'critical', dueIn: 'Now' },
  };
  const base = map[outcome] || { nextAction: 'Review lead', reason: 'Unknown outcome', urgency: 'action-needed' as const, dueIn: 'Today' };
  return { ...base, action: base.nextAction, stage };
}
