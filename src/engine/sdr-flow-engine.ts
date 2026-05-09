/**
 * STYLIQUE CRM — SDR Flow Engine
 *
 * Rule-based execution engine for SDR Manual leads.
 * Evaluates lead state and produces the correct next trigger, task, and dialog.
 *
 * RULES:
 * 1. Day 1: Email #1 automation + LinkedIn connection (mandatory)
 * 2. Email #2 (Day 3) and #3 (Day 7) are automated after Day 1
 * 3. LinkedIn accepted → same-day LinkedIn message task
 * 4. Email opened 2+ → urgent call task
 * 5. No response by Day 5 → urgent call task
 * 6. No response after call → Instagram DM task
 * 7. Reply at any point → stop chase, classify reply
 * 8. No dead ends — blocked actions always propose alternatives
 */

import type { Lead, DealTask } from '@/types/crm';
// Apollo sequence engine removed — AI outbound flow is no longer part of the CRM.

// ═══════════════════════════════════════════════════════════
// SDR TRIGGER TYPES — each maps to a specific dialog
// ═══════════════════════════════════════════════════════════

export type SDRTriggerType =
  | 'outreach_entry'              // Mandatory Day 1: Email #1 + LinkedIn
  | 'linkedin_accepted'       // LinkedIn connection accepted
  | 'warm_open_signal'        // Email opened 2+ times
  | 'day5_no_response'        // No response by Day 5
  | 'post_call_no_response'   // No response after call attempt
  | 'reply_received'          // Lead replied at any point
  | 'linkedin_pending'        // LinkedIn still not accepted
  | 'email_automation_check'  // Check Day 3/7 email status
  | 'no_trigger';             // No action needed right now

export interface SDRTrigger {
  type: SDRTriggerType;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  taskLabel: string;
  dayNumber: number;
}

// ═══════════════════════════════════════════════════════════
// SDR SEQUENCE STATE — tracks what has been done
// ═══════════════════════════════════════════════════════════

export interface SDRSequenceState {
  /** Day 1 actions */
  email1_started: boolean;
  email1_started_at?: string;
  linkedin_request_sent: boolean;
  linkedin_request_sent_at?: string;
  /** Automated emails */
  email2_scheduled: boolean;    // Day 3
  email3_scheduled: boolean;    // Day 7
  email2_sent: boolean;
  email3_sent: boolean;
  /** Signal detection */
  linkedin_accepted: boolean;
  linkedin_accepted_at?: string;
  linkedin_message_sent: boolean;
  linkedin_message_sent_at?: string;
  email_open_count: number;
  /** Call tracking */
  call_attempted: boolean;
  call_attempted_at?: string;
  call_outcome?: string;
  /** Instagram */
  instagram_dm_sent: boolean;
  instagram_dm_sent_at?: string;
  instagram_dm_outcome?: string;
  /** Reply */
  reply_received: boolean;
  reply_received_at?: string;
  reply_classification?: string;
  /** Blocked channels */
  blocked_channels: string[];
  /** Sequence active */
  sequence_started_at?: string;
  sequence_active: boolean;
}

const SDR_SEQ_KEY = 'stylique-crm-sdr-sequences';

export function getSDRSequenceStates(): Record<string, SDRSequenceState> {
  try {
    return JSON.parse(localStorage.getItem(SDR_SEQ_KEY) || '{}');
  } catch { return {}; }
}

export function getSDRSequenceState(leadId: string): SDRSequenceState {
  const states = getSDRSequenceStates();
  return states[leadId] || createDefaultState();
}

export function saveSDRSequenceState(leadId: string, state: SDRSequenceState): void {
  const states = getSDRSequenceStates();
  states[leadId] = state;
  localStorage.setItem(SDR_SEQ_KEY, JSON.stringify(states));
}

function createDefaultState(): SDRSequenceState {
  return {
    email1_started: false,
    linkedin_request_sent: false,
    email2_scheduled: false,
    email3_scheduled: false,
    email2_sent: false,
    email3_sent: false,
    linkedin_accepted: false,
    linkedin_message_sent: false,
    email_open_count: 0,
    call_attempted: false,
    instagram_dm_sent: false,
    reply_received: false,
    blocked_channels: [],
    sequence_active: false,
  };
}

// ═══════════════════════════════════════════════════════════
// EVALUATE CURRENT TRIGGER — determines what popup to show
// ═══════════════════════════════════════════════════════════

export function evaluateSDRTrigger(lead: Lead): SDRTrigger {
  const state = getSDRSequenceState(lead.id);
  const daysSinceCreation = getDaysSince(lead.createdAt);
  const openCount = state.email_open_count || 0;

  // ═══ STAGE GUARD: Only evaluate signals for early-stage leads ═══
  // Leads past 'contacted' stage should NOT get Day 1 or signal triggers
  const postContactedStages = [
    'replied', 'sdr-replied', 'meeting-booked', 'meeting-completed',
    'trial-proposed', 'trial-active', 'payment-pending', 'converted',
    'closed-lost', 'unsubscribed',
  ];
  if (postContactedStages.includes(lead.stage)) {
    return {
      type: 'no_trigger',
      urgency: 'low',
      title: 'No signal action — lead is past outreach stage',
      reason: `${lead.contactName} is at ${lead.stage}. Signal engine does not apply.`,
      taskLabel: '',
      dayNumber: daysSinceCreation,
    };
  }

  // RULE: Reply at any point stops everything
  if (state.reply_received || lead.lastReplyAt || lead.reply_classification) {
    return {
      type: 'reply_received',
      urgency: 'critical',
      title: 'Lead replied — classify and act now',
      reason: `${lead.contactName} replied. Stop all outreach and classify the reply.`,
      taskLabel: `Review reply from ${lead.contactName} and decide next step`,
      dayNumber: daysSinceCreation,
    };
  }

  // RULE 1: Day 1 entry not completed — only for truly new/early leads
  if (!state.email1_started || !state.linkedin_request_sent) {
    return {
      type: 'outreach_entry',
      urgency: 'critical',
      title: 'Contact',
      reason: `${lead.contactName} — start outreach.`,
      taskLabel: `Contact ${lead.contactName}`,
      dayNumber: 0,
    };
  }

  // RULE 3: LinkedIn accepted → send message
  if (state.linkedin_accepted && !state.linkedin_message_sent) {
    return {
      type: 'linkedin_accepted',
      urgency: 'high',
      title: 'LinkedIn accepted — send message now',
      reason: `${lead.contactName} accepted your LinkedIn request. Send a personalized message today.`,
      taskLabel: `Send LinkedIn message to ${lead.contactName} — connection accepted`,
      dayNumber: daysSinceCreation,
    };
  }

  // RULE 2: Email opened 2+ → urgent call
  if (openCount >= 2 && !state.call_attempted) {
    return {
      type: 'warm_open_signal',
      urgency: 'critical',
      title: 'Warm signal — call immediately',
      reason: `${lead.contactName} opened your email ${openCount} times. Call now while interest is high.`,
      taskLabel: `Call ${lead.contactName} now — email opened ${openCount}+ times`,
      dayNumber: daysSinceCreation,
    };
  }

  // RULE 3: Day 5 no response → urgent call
  if (daysSinceCreation >= 5 && !state.call_attempted && !state.reply_received) {
    return {
      type: 'day5_no_response',
      urgency: 'high',
      title: 'No response by Day 5 — call now',
      reason: `No response from ${lead.contactName} after 5 days. Time to call directly.`,
      taskLabel: `Call ${lead.contactName} — no response by Day 5`,
      dayNumber: 5,
    };
  }

  // RULE 4: Post-call no response → Instagram DM
  if (state.call_attempted && state.call_outcome !== 'interested' && state.call_outcome !== 'answered' && !state.instagram_dm_sent) {
    return {
      type: 'post_call_no_response',
      urgency: 'medium',
      title: 'No response after call — try Instagram',
      reason: `Call to ${lead.contactName} didn't connect. Send Instagram DM as next channel.`,
      taskLabel: `Send Instagram DM to ${lead.contactName} — no response after call`,
      dayNumber: daysSinceCreation,
    };
  }

  // LinkedIn still pending check
  if (state.linkedin_request_sent && !state.linkedin_accepted && daysSinceCreation >= 3 && !state.linkedin_message_sent) {
    return {
      type: 'linkedin_pending',
      urgency: 'low',
      title: 'LinkedIn connection still pending',
      reason: `LinkedIn request to ${lead.contactName} sent ${daysSinceCreation} days ago — still pending.`,
      taskLabel: `Check LinkedIn status for ${lead.contactName}`,
      dayNumber: daysSinceCreation,
    };
  }

  return {
    type: 'no_trigger',
    urgency: 'low',
    title: 'No action needed right now',
    reason: 'Sequence is running. Waiting for next trigger.',
    taskLabel: '',
    dayNumber: daysSinceCreation,
  };
}

// ═══════════════════════════════════════════════════════════
// GENERATE TASKS FROM TRIGGER
// ═══════════════════════════════════════════════════════════

export function generateSDRTask(
  lead: Lead,
  trigger: SDRTrigger,
  assignedTo: string,
): DealTask | null {
  if (trigger.type === 'no_trigger') return null;

  const now = new Date().toISOString();
  const urgencyToDue: Record<string, string> = {
    critical: now,
    high: now,
    medium: new Date(Date.now() + 86400000).toISOString(),
    low: new Date(Date.now() + 2 * 86400000).toISOString(),
  };

  return {
    id: crypto.randomUUID(),
    title: trigger.taskLabel,
    dueDate: urgencyToDue[trigger.urgency] || now,
    completed: false,
    assignedTo,
    type: trigger.type === 'outreach_entry' ? 'outreach'
      : trigger.type === 'reply_received' ? 'follow-up'
      : trigger.type === 'warm_open_signal' || trigger.type === 'day5_no_response' ? 'follow-up'
      : 'outreach',
    autoGenerated: true,
    createdAt: now,
    priority: trigger.urgency === 'critical' ? 'critical' : trigger.urgency === 'high' ? 'high' : 'medium',
    reason: trigger.reason,
    stageFamily: 'engagement',
  };
}

// ═══════════════════════════════════════════════════════════
// DAY 1 COMPLETION HANDLER
// ═══════════════════════════════════════════════════════════

export interface OutreachEntryResult {
  email1_started: boolean;
  email1_blocked_reason?: string;
  linkedin_sent: boolean;
  linkedin_blocked_reason?: string;
}

export function processOutreachEntry(leadId: string, result: OutreachEntryResult): SDRSequenceState {
  const state = getSDRSequenceState(leadId);
  const now = new Date().toISOString();

  state.sequence_active = true;
  state.sequence_started_at = state.sequence_started_at || now;

  if (result.email1_started) {
    state.email1_started = true;
    state.email1_started_at = now;
    state.email2_scheduled = true;
    state.email3_scheduled = true;
  }
  if (result.linkedin_sent) {
    state.linkedin_request_sent = true;
    state.linkedin_request_sent_at = now;
  }

  if (result.email1_blocked_reason) {
    state.blocked_channels.push(`email:${result.email1_blocked_reason}`);
  }
  if (result.linkedin_blocked_reason) {
    state.blocked_channels.push(`linkedin:${result.linkedin_blocked_reason}`);
  }

  saveSDRSequenceState(leadId, state);
  return state;
}

// ═══════════════════════════════════════════════════════════
// SIGNAL HANDLERS
// ═══════════════════════════════════════════════════════════

export type LinkedInMessageOutcome = 'message_sent' | 'could_not_send' | 'account_issue' | 'wrong_profile';
export type CallOutcomeSDR = 'answered' | 'no_answer' | 'interested' | 'not_interested' | 'call_back_later' | 'wrong_contact' | 'number_missing';
export type InstagramDMOutcome = 'dm_sent' | 'no_account' | 'blocked' | 'private_unavailable' | 'wrong_brand';
export type LinkedInPendingOutcome = 'still_pending' | 'withdrawn' | 'rejected' | 'wrong_profile' | 'accepted';
export type ReplyClassificationSDR = 'interested' | 'later' | 'not_interested' | 'wrong_person' | 'neutral_unclear';

export function processLinkedInAccepted(leadId: string, outcome: LinkedInMessageOutcome): SDRSequenceState {
  const state = getSDRSequenceState(leadId);
  const now = new Date().toISOString();

  if (outcome === 'message_sent') {
    state.linkedin_message_sent = true;
    state.linkedin_message_sent_at = now;
  } else {
    state.blocked_channels.push(`linkedin_message:${outcome}`);
  }

  saveSDRSequenceState(leadId, state);
  return state;
}

export function processCallOutcomeSDR(leadId: string, outcome: CallOutcomeSDR): SDRSequenceState {
  const state = getSDRSequenceState(leadId);
  const now = new Date().toISOString();

  state.call_attempted = true;
  state.call_attempted_at = now;
  state.call_outcome = outcome;

  if (outcome === 'number_missing') {
    state.blocked_channels.push('call:number_missing');
  }
  if (outcome === 'interested') {
    // Will trigger reply flow
  }

  saveSDRSequenceState(leadId, state);
  return state;
}

export function processInstagramDM(leadId: string, outcome: InstagramDMOutcome): SDRSequenceState {
  const state = getSDRSequenceState(leadId);
  const now = new Date().toISOString();

  state.instagram_dm_sent = outcome === 'dm_sent';
  state.instagram_dm_sent_at = now;
  state.instagram_dm_outcome = outcome;

  if (outcome !== 'dm_sent') {
    state.blocked_channels.push(`instagram:${outcome}`);
  }

  saveSDRSequenceState(leadId, state);
  return state;
}

export function processReplyReceived(leadId: string, classification: ReplyClassificationSDR): SDRSequenceState {
  const state = getSDRSequenceState(leadId);
  const now = new Date().toISOString();

  state.reply_received = true;
  state.reply_received_at = now;
  state.reply_classification = classification;
  state.sequence_active = false; // Stop sequence

  saveSDRSequenceState(leadId, state);
  return state;
}

export function processLinkedInPending(leadId: string, outcome: LinkedInPendingOutcome): SDRSequenceState {
  const state = getSDRSequenceState(leadId);

  if (outcome === 'accepted') {
    state.linkedin_accepted = true;
    state.linkedin_accepted_at = new Date().toISOString();
  } else if (outcome !== 'still_pending') {
    state.blocked_channels.push(`linkedin_request:${outcome}`);
  }

  saveSDRSequenceState(leadId, state);
  return state;
}

// ═══════════════════════════════════════════════════════════
// FALLBACK ALTERNATIVES — when a channel is blocked
// ═══════════════════════════════════════════════════════════

export interface FallbackAction {
  label: string;
  description: string;
  channel: string;
  actionType: 'immediate' | 'scheduled' | 'research';
}

export function getFallbackActions(lead: Lead, blockedChannel: string): FallbackAction[] {
  const alternatives: FallbackAction[] = [];

  if (blockedChannel === 'call' || blockedChannel.startsWith('call:')) {
    if (lead.linkedin) alternatives.push({ label: 'Send LinkedIn message', description: 'If connected, send a direct message', channel: 'linkedin', actionType: 'immediate' });
    if (lead.instagram) alternatives.push({ label: 'Send Instagram DM', description: 'Reach out via Instagram', channel: 'instagram', actionType: 'immediate' });
    alternatives.push({ label: 'Research updated contact details', description: 'Find alternate phone number', channel: 'research', actionType: 'research' });
    alternatives.push({ label: 'Mark blocked and create research task', description: 'Flag for manual research', channel: 'system', actionType: 'research' });
  }

  if (blockedChannel === 'instagram' || blockedChannel.startsWith('instagram:')) {
    alternatives.push({ label: 'Retry call', description: 'Try calling again at a different time', channel: 'call', actionType: 'scheduled' });
    if (lead.linkedin) alternatives.push({ label: 'Push LinkedIn message follow-up', description: 'Send a follow-up message on LinkedIn', channel: 'linkedin', actionType: 'immediate' });
    alternatives.push({ label: 'Schedule rescue follow-up', description: 'Plan a final multi-channel attempt', channel: 'system', actionType: 'scheduled' });
    alternatives.push({ label: 'Mark channel unavailable', description: 'Record that Instagram is not available for this lead', channel: 'system', actionType: 'immediate' });
  }

  if (blockedChannel === 'linkedin' || blockedChannel.startsWith('linkedin:')) {
    alternatives.push({ label: 'Wait for acceptance', description: 'LinkedIn request still pending — monitor', channel: 'linkedin', actionType: 'scheduled' });
    if (lead.contactPhone) alternatives.push({ label: 'Call now if warm signal exists', description: 'Call if email open count is high', channel: 'call', actionType: 'immediate' });
    alternatives.push({ label: 'Continue email sequence', description: 'Let automated emails continue', channel: 'email', actionType: 'scheduled' });
    if (lead.instagram) alternatives.push({ label: 'Use Instagram as alternate channel', description: 'Try Instagram DM instead', channel: 'instagram', actionType: 'immediate' });
  }

  return alternatives;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function getDaysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}
