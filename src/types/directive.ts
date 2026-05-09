/**
 * STYLIQUE CRM — Executive Directive Types
 * 
 * Directives are high-priority operational items sent by CEO/COO
 * directly to SDRs or Onboarding. They sit above normal tasks.
 */

export type DirectivePriority = 'immediate' | 'today' | 'urgent' | 'normal';

export type DirectiveStatus =
  | 'sent'
  | 'seen'
  | 'acknowledged'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'snoozed'
  | 'overdue';

export type DirectiveActionType =
  | 'call_now'
  | 'follow_up_today'
  | 'book_meeting'
  | 'log_meeting_result'
  | 'get_credentials'
  | 'activate_trial'
  | 'push_conversion'
  | 'confirm_payment'
  | 'approve_trial'
  | 'review_blocker'
  | 'review_queue'
  | 'review_performance'
  | 'escalate_update';

export const DIRECTIVE_ACTION_LABELS: Record<DirectiveActionType, string> = {
  call_now: 'Call',
  follow_up_today: 'Follow-up due',
  book_meeting: 'Schedule meeting',
  log_meeting_result: 'Meeting result missing',
  get_credentials: 'Get credentials',
  activate_trial: 'Done & verified',
  push_conversion: 'Decision pending',
  confirm_payment: 'Confirm payment',
  approve_trial: 'Approve',
  review_blocker: 'Review blocker',
  review_queue: 'Review queue',
  review_performance: 'Review performance',
  escalate_update: 'Update me',
};

export const DIRECTIVE_PRIORITY_LABELS: Record<DirectivePriority, string> = {
  immediate: 'Immediate',
  today: 'Today',
  urgent: 'Urgent',
  normal: 'Normal',
};

/** Maps directive action types to action-router intents for one-click routing */
export const DIRECTIVE_TO_INTENT: Record<DirectiveActionType, string> = {
  call_now: 'call',
  follow_up_today: 'call',
  book_meeting: 'book_meeting',
  log_meeting_result: 'log_meeting_outcome',
  get_credentials: 'add_credentials',
  activate_trial: 'trial_setup',
  push_conversion: 'conversion_push',
  confirm_payment: 'confirm_payment',
  approve_trial: 'approve_trial',
  review_blocker: 'open_record',
  review_queue: 'open_record',
  review_performance: 'open_record',
  escalate_update: 'open_record',
};

/** Outcome options per directive action type */
export const DIRECTIVE_OUTCOMES: Record<DirectiveActionType, { value: string; label: string }[]> = {
  call_now: [
    { value: 'answered_interested', label: 'Answered — interested' },
    { value: 'no_answer', label: 'No answer' },
    { value: 'callback_later', label: 'Callback later' },
    { value: 'not_interested', label: 'Not interested' },
    { value: 'meeting_booked', label: 'Meeting booked' },
  ],
  follow_up_today: [
    { value: 'contacted', label: 'Contacted' },
    { value: 'no_answer', label: 'No answer' },
    { value: 'replied', label: 'Replied' },
    { value: 'meeting_booked', label: 'Meeting booked' },
  ],
  book_meeting: [
    { value: 'booked', label: 'Meeting booked' },
    { value: 'declined', label: 'Declined' },
    { value: 'rescheduled', label: 'Rescheduled' },
  ],
  log_meeting_result: [
    { value: 'interested', label: 'Interested' },
    { value: 'propose_trial', label: 'Moved to Client Review' },
    { value: 'not_interested', label: 'Not interested' },
    { value: 'follow_up', label: 'Needs follow-up' },
  ],
  get_credentials: [
    { value: 'received', label: 'Received' },
    { value: 'partially_received', label: 'Partially received' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'client_delayed', label: 'Client delayed' },
    { value: 'wrong_credentials', label: 'Wrong credentials' },
  ],
  activate_trial: [
    { value: 'activated', label: 'Activated' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'missing_setup', label: 'Missing setup' },
  ],
  push_conversion: [
    { value: 'converted', label: 'Converted' },
    { value: 'payment_pending', label: 'Payment pending' },
    { value: 'needs_more_time', label: 'Needs more time' },
    { value: 'not_converting', label: 'Closed Lost' },
    { value: 'internal_decision_pending', label: 'Internal decision pending' },
  ],
  confirm_payment: [
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Still pending' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'disputed', label: 'Disputed' },
  ],
  review_blocker: [
    { value: 'resolved', label: 'Resolved' },
    { value: 'waiting_on_client', label: 'Waiting on client' },
    { value: 'waiting_on_leadership', label: 'Waiting on leadership' },
    { value: 'reassigned', label: 'Reassigned' },
  ],
  review_queue: [
    { value: 'all_reviewed', label: 'All reviewed' },
    { value: 'partially_reviewed', label: 'Partially reviewed' },
    { value: 'blocked', label: 'Blocked' },
  ],
  escalate_update: [
    { value: 'escalated', label: 'Updated' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'blocked', label: 'Blocked' },
  ],
  approve_trial: [
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'needs_info', label: 'Needs more info' },
  ],
  review_performance: [
    { value: 'on_track', label: 'On track' },
    { value: 'warning_given', label: 'Warning given' },
    { value: 'improvement_plan', label: 'Improvement plan' },
    { value: 'acknowledged', label: 'Acknowledged' },
  ],
};

export interface DirectiveTarget {
  leadId: string;
  companyName: string;
}

export type DirectiveScope = 'specific' | 'selected' | 'filtered' | 'general';

export interface Directive {
  id: string;
  /** Who sent it */
  senderId: string;
  senderName: string;
  /** Who receives it */
  receiverId: string;
  receiverName: string;
  /** Scope */
  scope: DirectiveScope;
  /** Target records */
  targets: DirectiveTarget[];
  /** Action type */
  actionType: DirectiveActionType;
  /** Priority */
  priority: DirectivePriority;
  /** Due date/time ISO */
  dueAt: string;
  /** Require acknowledgement */
  requireAck: boolean;
  /** Require outcome */
  requireOutcome: boolean;
  /** Free-text instruction */
  note: string;
  /** Status */
  status: DirectiveStatus;
  /** Timestamps */
  createdAt: string;
  seenAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  /** Outcome logged per target */
  outcomes: DirectiveOutcome[];
  /** Blocker reason if blocked */
  blockerReason?: string;
}

export interface DirectiveOutcome {
  targetLeadId: string;
  outcome: string;
  notes: string;
  completedAt: string;
  completedBy: string;
}
