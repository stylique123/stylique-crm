/**
 * STYLIQUE CRM — SDR Execution Service
 * 
 * Handles logging of SDR calls and emails against the unified contact record.
 * Every log updates the same canonical Lead — no duplicate records.
 */

import type { Lead, Activity, CallLogEntry, EmailLogEntry, DealTask } from '@/types/crm';
import { recalculateNextAction } from '@/types/crm';
import type { StoreBridge } from '@/engine/action-executor';
import { getSDRIdentity } from '@/services/sdr-identity-service';
import { emitKPI } from '@/engine/kpi-integration';

// ═══════════════════════════════════════════════════════════
// LOG TWILIO CALL — updates same lead record
// ═══════════════════════════════════════════════════════════

export function logTwilioCall(
  lead: Lead,
  outcome: CallLogEntry['outcome'],
  sdrOwner: string,
  bridge: StoreBridge,
  opts?: { notes?: string; duration?: number; twilioNumber?: string }
): Lead {
  const now = new Date().toISOString();
  const identity = getSDRIdentity(sdrOwner);
  const twilioNumber = opts?.twilioNumber || identity?.defaultTwilioNumber || '';

  const entry: CallLogEntry = {
    id: crypto.randomUUID(),
    timestamp: now,
    sdrOwner,
    twilioNumber,
    contactPhone: lead.contactPhone || '',
    duration: opts?.duration,
    outcome,
    notes: opts?.notes,
    nextAction: getCallNextAction(outcome),
  };

  // Determine stage/action updates based on outcome
  let stageUpdate: Partial<Lead> = {};
  if (outcome === 'connected_interested' || outcome === 'booked_meeting') {
    stageUpdate = { stage: outcome === 'booked_meeting' ? 'meeting-booked' : lead.stage };
  }

  // Create follow-up task if needed
  const followUpTask = getCallFollowUpTask(lead, outcome, sdrOwner, now);

  let updated: Lead = {
    ...lead,
    ...stageUpdate,
    lastCallAt: now,
    lastContactedAt: now,
    updatedAt: now,
    twilio_number_used: twilioNumber,
    call_log: [...(lead.call_log || []), entry],
    tasks: followUpTask
      ? [...(lead.tasks || []), followUpTask]
      : lead.tasks,
  };

  const intel = recalculateNextAction(updated);
  updated = {
    ...updated,
    nextAction: intel.action,
    nextActionReason: intel.reason,
    nextActionUrgency: intel.urgency,
    nextFollowUp: intel.followUpDate,
  };

  bridge.saveCompany(updated);

  bridge.addActivity({
    id: crypto.randomUUID(),
    leadId: lead.id,
    type: 'twilio_call_outcome_logged',
    description: `📞 Call to ${lead.contactName}: ${getOutcomeLabel(outcome)}${opts?.notes ? ` — "${opts.notes}"` : ''}`,
    createdAt: now,
    createdBy: sdrOwner,
    metadata: {
      twilioNumber,
      outcome,
      duration: opts?.duration,
    },
  });

  // KPI: record call action
  emitKPI(sdrOwner, lead, lead.contactName, 'calls_made', 'call', outcome);
  if (outcome === 'booked_meeting') {
    emitKPI(sdrOwner, lead, lead.contactName, 'meetings_booked', 'call', outcome);
  }

  return updated;
}

// ═══════════════════════════════════════════════════════════
// LOG SDR EMAIL — updates same lead record
// ═══════════════════════════════════════════════════════════

export function logSDREmail(
  lead: Lead,
  subject: string,
  sdrOwner: string,
  bridge: StoreBridge,
  opts?: {
    bodyPreview?: string;
    direction?: 'outbound' | 'inbound';
    apolloIdentity?: string;
    sendingMailbox?: string;
    replyMailbox?: string;
  }
): Lead {
  const now = new Date().toISOString();
  const identity = getSDRIdentity(sdrOwner);

  const entry: EmailLogEntry = {
    id: crypto.randomUUID(),
    timestamp: now,
    sdrOwner,
    apolloIdentity: opts?.apolloIdentity || identity?.apolloIdentity,
    sendingMailbox: opts?.sendingMailbox || identity?.outlookMailbox || '',
    replyMailbox: opts?.replyMailbox || identity?.replyMailbox,
    subject,
    bodyPreview: opts?.bodyPreview,
    direction: opts?.direction || 'outbound',
    replyStatus: 'none',
  };

  let updated: Lead = {
    ...lead,
    lastEmailAt: now,
    lastContactedAt: now,
    updatedAt: now,
    sdr_sending_mailbox: entry.sendingMailbox,
    sdr_reply_mailbox: entry.replyMailbox,
    email_log: [...(lead.email_log || []), entry],
  };

  const intel = recalculateNextAction(updated);
  updated = {
    ...updated,
    nextAction: intel.action,
    nextActionReason: intel.reason,
    nextActionUrgency: intel.urgency,
    nextFollowUp: intel.followUpDate,
  };

  bridge.saveCompany(updated);

  const activityType = opts?.direction === 'inbound' ? 'sdr_email_reply' as const : 'sdr_email_sent' as const;
  bridge.addActivity({
    id: crypto.randomUUID(),
    leadId: lead.id,
    type: activityType,
    description: `✉️ ${opts?.direction === 'inbound' ? 'Reply from' : 'Email to'} ${lead.contactName}: "${subject}"`,
    createdAt: now,
    createdBy: sdrOwner,
    metadata: {
      channel: 'email',
      mailbox: entry.sendingMailbox,
      apolloIdentity: entry.apolloIdentity,
    },
  });

  // KPI: record email action
  const emailMetric = opts?.direction === 'inbound' ? 'replies_received' as const : 'emails_sent' as const;
  emitKPI(sdrOwner, lead, lead.contactName, emailMetric, 'email');

  return updated;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function getCallNextAction(outcome: CallLogEntry['outcome']): string {
  switch (outcome) {
    case 'connected_interested': return 'Book meeting — they expressed interest';
    case 'connected_followup': return 'Schedule follow-up call';
    case 'no_answer': return 'Try again tomorrow or switch to email';
    case 'wrong_person': return 'Research correct contact';
    case 'not_interested': return 'Add reason, consider closing';
    case 'call_again': return 'Call back at scheduled time';
    case 'booked_meeting': return 'Prepare for meeting';
  }
}

function getOutcomeLabel(outcome: CallLogEntry['outcome']): string {
  const labels: Record<CallLogEntry['outcome'], string> = {
    connected_interested: 'Connected — Interested',
    connected_followup: 'Connected — Follow Up',
    no_answer: 'No Answer',
    wrong_person: 'Wrong Person',
    not_interested: 'Not Interested',
    call_again: 'Call Again',
    booked_meeting: 'Booked Meeting',
  };
  return labels[outcome];
}

function getCallFollowUpTask(lead: Lead, outcome: CallLogEntry['outcome'], sdr: string, now: string): DealTask | null {
  const addDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return d.toISOString();
  };

  switch (outcome) {
    case 'connected_interested':
      return {
        id: crypto.randomUUID(), title: `Book meeting with ${lead.contactName}`,
        dueDate: now, completed: false, assignedTo: sdr,
        type: 'follow-up', autoGenerated: true, createdAt: now,
        priority: 'critical', reason: 'Interested — act immediately', stageFamily: 'engagement',
      };
    case 'connected_followup':
      return {
        id: crypto.randomUUID(), title: `Follow-up call with ${lead.contactName}`,
        dueDate: addDays(2), completed: false, assignedTo: sdr,
        type: 'follow-up', autoGenerated: true, createdAt: now,
        priority: 'high', reason: 'Callback scheduled', stageFamily: 'engagement',
      };
    case 'no_answer':
      return {
        id: crypto.randomUUID(), title: `Retry call or email ${lead.contactName}`,
        dueDate: addDays(1), completed: false, assignedTo: sdr,
        type: 'follow-up', autoGenerated: true, createdAt: now,
        priority: 'medium', reason: 'No answer — try alternative', stageFamily: 'engagement',
      };
    case 'booked_meeting':
      return {
        id: crypto.randomUUID(), title: `Prepare for meeting with ${lead.contactName}`,
        dueDate: addDays(1), completed: false, assignedTo: sdr,
        type: 'meeting-prep', autoGenerated: true, createdAt: now,
        priority: 'high', reason: 'Meeting booked via call', stageFamily: 'meeting',
      };
    default:
      return null;
  }
}
