/**
 * STYLIQUE CRM — Canonical State Machine
 * 
 * SINGLE SOURCE OF TRUTH for company lifecycle.
 * 
 * RULES:
 * - ONE company = ONE current stage
 * - ONE stage = ONE valid action set
 * - Stage change = invalidate all previous-stage artifacts
 * - Nothing is assumed without human confirmation
 */

import type { Lead, Stage, DealTask, TaskState } from '@/types/crm';
import { STAGE_LABELS, STAGE_FAMILY, type StageFamily } from '@/types/crm';
import { archiveStaleTasksForStage } from '@/engine/task-engine';

// ═══════════════════════════════════════════════════════════
// CANONICAL LIFECYCLE STAGES (ordered)
// ═══════════════════════════════════════════════════════════

export const LIFECYCLE_ORDER: Stage[] = [
  // Inbound
  'inbound-new', 'inbound-qualified', 'inbound-awaiting-sdr', 'inbound-disqualified',
  // SDR Manual
  'sdr-new-lead', 'sdr-contacted', 'sdr-replied',
  // Shared Commercial
  'meeting-booked', 'meeting-completed',
  'trial-proposed', 'trial-active',
  'payment-pending', 'converted', 'closed-lost',
  'unsubscribed', 'cold-no-response',
  // Legacy aliases (mapped to current stages by store.ts migration / normalizeStage)
  'new-lead', 'new-inquiry', 'contacted', 'qualified', 'awaiting-sdr', 'replied',
];

// ═══════════════════════════════════════════════════════════
// STAGE DEFINITIONS — what's valid at each stage
// ═══════════════════════════════════════════════════════════

export interface StageDefinition {
  stage: Stage;
  label: string;
  family: StageFamily;
  validOwners: ('sdr' | 'onboarding' | 'leadership')[];
  validActionTypes: string[];
  validNextStages: Stage[];
  invalidatesOnEntry: {
    taskTypes: DealTask['type'][];
    badges: string[];
    promptTypes: string[];
  };
  requiresConfirmation: boolean;
  confirmationPrompt?: string;
}

const EMPTY_INVALIDATION = { taskTypes: [] as DealTask['type'][], badges: [] as string[], promptTypes: [] as string[] };

export const STAGE_DEFINITIONS: Partial<Record<Stage, StageDefinition>> = {
  // ── Inbound stages ─────────────────────────────────────
  'inbound-new': {
    stage: 'inbound-new', label: 'New Inquiry', family: 'prospecting',
    validOwners: ['sdr'], validActionTypes: ['call', 'email'],
    validNextStages: ['inbound-qualified', 'inbound-awaiting-sdr', 'meeting-booked', 'inbound-disqualified', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'inbound-qualified': {
    stage: 'inbound-qualified', label: 'Qualified Inquiry', family: 'engagement',
    validOwners: ['sdr'], validActionTypes: ['call', 'email', 'meeting'],
    validNextStages: ['inbound-awaiting-sdr', 'meeting-booked', 'inbound-disqualified', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'inbound-awaiting-sdr': {
    stage: 'inbound-awaiting-sdr', label: 'Awaiting SDR Follow-Up', family: 'engagement',
    validOwners: ['sdr'], validActionTypes: ['call', 'email', 'linkedin'],
    validNextStages: ['meeting-booked', 'sdr-replied', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'inbound-disqualified': {
    stage: 'inbound-disqualified', label: 'Disqualified', family: 'closed',
    validOwners: ['sdr'], validActionTypes: ['review'],
    validNextStages: ['closed-lost'],
    invalidatesOnEntry: { taskTypes: ['outreach', 'follow-up'], badges: [], promptTypes: [] },
    requiresConfirmation: true,
    confirmationPrompt: 'Are you sure this lead is disqualified?',
  },
  // ── SDR Manual stages ──────────────────────────────────
  'sdr-new-lead': {
    stage: 'sdr-new-lead', label: 'New Lead (SDR)', family: 'prospecting',
    validOwners: ['sdr'], validActionTypes: ['email', 'linkedin', 'call'],
    validNextStages: ['sdr-contacted', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'sdr-contacted': {
    stage: 'sdr-contacted', label: 'Contacted', family: 'prospecting',
    validOwners: ['sdr'], validActionTypes: ['email', 'linkedin', 'call', 'wait'],
    validNextStages: ['sdr-replied', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: [], badges: ['new-lead'], promptTypes: ['intro-email'] },
    requiresConfirmation: true,
    confirmationPrompt: 'Did you send the first outreach?',
  },
  'sdr-replied': {
    stage: 'sdr-replied', label: 'Replied', family: 'engagement',
    validOwners: ['sdr'], validActionTypes: ['email', 'meeting', 'call'],
    validNextStages: ['meeting-booked', 'trial-proposed', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: ['outreach', 'follow-up'], badges: ['no-response', 'follow-up-due'], promptTypes: ['send-email', 'follow-up-today'] },
    requiresConfirmation: true,
    confirmationPrompt: 'Did the lead reply?',
  },
  // ── Shared Commercial Lifecycle ─────────────────────────
  'meeting-completed': {
    stage: 'meeting-completed', label: 'Meeting Completed', family: 'meeting',
    validOwners: ['sdr'], validActionTypes: ['review', 'confirm'],
    validNextStages: ['trial-proposed', 'internal-decision', 'pricing-discussion', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: ['meeting-prep'], badges: ['meeting-today'], promptTypes: ['prepare-meeting'] },
    requiresConfirmation: true,
    confirmationPrompt: 'Has the meeting been completed?',
  },
  'internal-decision': {
    stage: 'internal-decision', label: 'Internal Decision', family: 'meeting',
    validOwners: ['sdr'], validActionTypes: ['follow-up', 'call', 'email'],
    validNextStages: ['trial-proposed', 'pricing-discussion', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'pricing-discussion': {
    stage: 'pricing-discussion', label: 'Pricing', family: 'meeting',
    validOwners: ['sdr'], validActionTypes: ['email', 'call', 'follow-up'],
    validNextStages: ['trial-proposed', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: EMPTY_INVALIDATION, requiresConfirmation: false,
  },
  'new-lead': {
    stage: 'new-lead', label: 'New Lead', family: 'prospecting',
    validOwners: ['sdr'],
    validActionTypes: ['email', 'linkedin', 'call'],
    validNextStages: ['contacted', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: [], badges: [], promptTypes: [] },
    requiresConfirmation: false,
  },
  'new-inquiry': {
    stage: 'new-inquiry', label: 'New Inquiry', family: 'prospecting',
    validOwners: ['sdr'],
    validActionTypes: ['call', 'email'],
    validNextStages: ['qualified', 'contacted', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: [], badges: [], promptTypes: [] },
    requiresConfirmation: false,
  },
  'contacted': {
    stage: 'contacted', label: 'Contacted', family: 'prospecting',
    validOwners: ['sdr'],
    validActionTypes: ['email', 'linkedin', 'call', 'wait'],
    validNextStages: ['replied', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: [],
      badges: ['new-lead'],
      promptTypes: ['intro-email'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Did you send the first outreach?',
  },
  'qualified': {
    stage: 'qualified', label: 'Qualified', family: 'engagement',
    validOwners: ['sdr'],
    validActionTypes: ['call', 'email', 'meeting'],
    validNextStages: ['meeting-booked', 'replied', 'closed-lost'],
    invalidatesOnEntry: { taskTypes: [], badges: [], promptTypes: [] },
    requiresConfirmation: false,
  },
  'awaiting-sdr': {
    stage: 'awaiting-sdr', label: 'Awaiting SDR', family: 'engagement',
    validOwners: ['sdr'],
    validActionTypes: ['call', 'email', 'linkedin'],
    validNextStages: ['contacted', 'replied', 'meeting-booked', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach'],
      badges: ['campaign-running', 'sequence-active', 'email-opened'],
      promptTypes: ['wait-for-reply', 'campaign-assigned'],
    },
    requiresConfirmation: false,
  },
  'replied': {
    stage: 'replied', label: 'Replied', family: 'engagement',
    validOwners: ['sdr'],
    validActionTypes: ['email', 'meeting', 'call'],
    validNextStages: ['meeting-booked', 'trial-proposed', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up'],
      badges: ['no-response', 'campaign-running', 'sequence-active', 'follow-up-due'],
      promptTypes: ['send-email', 'follow-up-today', 'no-response-x-days', 'campaign-assigned'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Did the lead reply?',
  },
  'meeting-booked': {
    stage: 'meeting-booked', label: 'Meeting Booked', family: 'meeting',
    validOwners: ['sdr'],
    validActionTypes: ['meeting', 'review'],
    validNextStages: ['meeting-completed', 'trial-proposed', 'replied', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up'],
      badges: ['no-response', 'follow-up-due', 'book-meeting'],
      promptTypes: ['send-email', 'follow-up-today', 'no-response-x-days', 'call-lead'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Was the meeting booked?',
  },
  'trial-proposed': {
    stage: 'trial-proposed', label: 'Trial Proposed', family: 'trial-prep',
    validOwners: ['sdr', 'leadership'],
    validActionTypes: ['setup', 'confirm'],
    validNextStages: ['trial-active', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up', 'meeting-prep', 'meeting-summary'],
      badges: ['meeting-prep', 'meeting-today'],
      promptTypes: ['book-meeting', 'prepare-meeting'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Was a trial proposed during the meeting?',
  },
  'trial-active': {
    stage: 'trial-active', label: 'Trial Active', family: 'trial',
    validOwners: ['onboarding', 'sdr'],
    validActionTypes: ['setup', 'review', 'call', 'confirm'],
    validNextStages: ['payment-pending', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up', 'meeting-prep', 'meeting-summary'],
      badges: ['needs-approval', 'needs-credentials', 'trial-setup'],
      promptTypes: ['get-approval', 'add-credentials', 'activate-trial'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Has the trial been activated?',
  },
  'payment-pending': {
    stage: 'payment-pending', label: 'Payment Pending', family: 'payment',
    validOwners: ['sdr', 'leadership'],
    validActionTypes: ['payment', 'call', 'confirm'],
    validNextStages: ['converted', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['onboarding', 'check-in', 'conversion-push', 'trial-end'],
      badges: ['trial-ending', 'trial-expired', 'onboarding-pending', 'usage-check'],
      promptTypes: ['check-usage', 'push-conversion', 'trial-check-in'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Is the client ready to pay?',
  },
  'converted': {
    stage: 'converted', label: 'Converted', family: 'customer',
    validOwners: ['sdr', 'leadership'],
    validActionTypes: ['payment', 'review'],
    validNextStages: ['closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['onboarding', 'check-in', 'conversion-push', 'trial-end', 'payment', 'follow-up'],
      badges: ['payment-pending', 'payment-overdue', 'trial-ending'],
      promptTypes: ['collect-payment', 'payment-reminder', 'conversion-push'],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Has payment been received?',
  },
  'closed-lost': {
    stage: 'closed-lost', label: 'Closed Lost', family: 'closed',
    validOwners: ['sdr', 'leadership'],
    validActionTypes: ['review'],
    validNextStages: [],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up', 'onboarding', 'check-in', 'conversion-push', 'trial-end', 'payment', 'meeting-prep', 'meeting-summary'],
      badges: [],
      promptTypes: [],
    },
    requiresConfirmation: true,
    confirmationPrompt: 'Are you sure you want to close this deal?',
  },
  'unsubscribed': {
    stage: 'unsubscribed', label: 'Unsubscribed', family: 'closed',
    validOwners: ['sdr'],
    validActionTypes: ['review'],
    validNextStages: [],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up', 'onboarding', 'check-in', 'conversion-push', 'trial-end', 'payment', 'meeting-prep', 'meeting-summary'],
      badges: [],
      promptTypes: [],
    },
    requiresConfirmation: false,
  },
  'cold-no-response': {
    stage: 'cold-no-response', label: 'Cold / No Response', family: 'closed',
    validOwners: ['sdr'],
    validActionTypes: ['review'],
    validNextStages: ['sdr-new-lead', 'closed-lost'],
    invalidatesOnEntry: {
      taskTypes: ['outreach', 'follow-up'],
      badges: [],
      promptTypes: [],
    },
    requiresConfirmation: false,
  },
};

// ═══════════════════════════════════════════════════════════
// STAGE TRANSITION VALIDATION
// ═══════════════════════════════════════════════════════════

export function isValidTransition(currentStage: Stage, targetStage: Stage): boolean {
  const def = STAGE_DEFINITIONS[currentStage];
  if (!def) return false;
  return def.validNextStages.includes(targetStage);
}

export function getValidNextStages(currentStage: Stage): Stage[] {
  return STAGE_DEFINITIONS[currentStage]?.validNextStages || [];
}

// ═══════════════════════════════════════════════════════════
// STAGE INVALIDATION ENGINE
// On every stage change: archive stale tasks, clear badges
// ═══════════════════════════════════════════════════════════

const FAMILY_ORDER: StageFamily[] = ['prospecting', 'engagement', 'meeting', 'trial-prep', 'trial', 'payment', 'customer', 'closed'];

export function invalidateOnStageChange(lead: Lead, newStage: Stage): Lead {
  const def = STAGE_DEFINITIONS[newStage];
  if (!def) return lead;

  // Use the centralized archival engine — single source of truth for stale task cleanup
  const updatedTasks = archiveStaleTasksForStage(lead.tasks || [], newStage);

  return {
    ...lead,
    stage: newStage,
    tasks: updatedTasks,
    updatedAt: new Date().toISOString(),
    // Clear old computed state
    nextAction: undefined,
    nextActionReason: undefined,
    nextActionUrgency: undefined,
    // Legacy cleanup
    smartleadStatus: undefined,
  };
}

function cancelTask(task: DealTask, newStage: Stage): DealTask {
  return {
    ...task,
    state: 'cancelled' as TaskState,
    completed: true,
    cancelledAt: new Date().toISOString(),
    cancelReason: `Stage changed to ${STAGE_LABELS[newStage]} — task no longer relevant`,
  };
}

// ═══════════════════════════════════════════════════════════
// HUMAN CONFIRMATION MODEL
// ═══════════════════════════════════════════════════════════

export interface ConfirmationRequest {
  stage: Stage;
  prompt: string;
  requiredBefore: 'stage-change' | 'action-log';
}

export function getConfirmationForTransition(targetStage: Stage): ConfirmationRequest | null {
  const def = STAGE_DEFINITIONS[targetStage];
  if (!def || !def.requiresConfirmation || !def.confirmationPrompt) return null;
  return {
    stage: targetStage,
    prompt: def.confirmationPrompt,
    requiredBefore: 'stage-change',
  };
}

// ═══════════════════════════════════════════════════════════
// CANONICAL KPI COUNTS — from stage only, not labels/badges
// ═══════════════════════════════════════════════════════════

export interface CanonicalCounts {
  totalLeads: number;
  newLeads: number;
  contacted: number;
  replied: number;
  meetingsBooked: number;
  trialsTotal: number;
  trialsSetupPending: number;
  trialsActive: number;
  trialsEndingSoon: number;
  trialsExpired: number;
  paymentsPending: number;
  paymentsOverdue: number;
  converted: number;
  closedLost: number;
  activeClients: number;
}

export function getCanonicalCounts(leads: Lead[]): CanonicalCounts {
  const counts: CanonicalCounts = {
    totalLeads: leads.length,
    newLeads: 0,
    contacted: 0,
    replied: 0,
    meetingsBooked: 0,
    trialsTotal: 0,
    trialsSetupPending: 0,
    trialsActive: 0,
    trialsEndingSoon: 0,
    trialsExpired: 0,
    paymentsPending: 0,
    paymentsOverdue: 0,
    converted: 0,
    closedLost: 0,
    activeClients: 0,
  };

  const now = Date.now();

  for (const lead of leads) {
    switch (lead.stage) {
      case 'new-lead': case 'new-inquiry':
      case 'sdr-new-lead': case 'inbound-new':
        counts.newLeads++;
        break;
      case 'contacted': case 'qualified': case 'awaiting-sdr':
      case 'sdr-contacted': case 'inbound-qualified': case 'inbound-awaiting-sdr':
        counts.contacted++;
        break;
      case 'replied': case 'sdr-replied':
        counts.replied++;
        break;
      case 'meeting-booked': case 'meeting-completed':
        counts.meetingsBooked++;
        break;
      case 'trial-proposed':
        counts.trialsTotal++;
        counts.trialsSetupPending++;
        break;
      case 'trial-active': {
        counts.trialsTotal++;
        counts.trialsActive++;
        if (lead.trialEndDate) {
          const daysLeft = Math.ceil((new Date(lead.trialEndDate).getTime() - now) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 0) counts.trialsExpired++;
          else if (daysLeft <= 3) counts.trialsEndingSoon++;
        }
        break;
      }
      case 'payment-pending':
        counts.paymentsPending++;
        if (lead.paymentStatus === 'overdue' || lead.paymentStatus === 'at-risk') {
          counts.paymentsOverdue++;
        } else if (lead.nextPaymentDate) {
          const daysUntil = Math.ceil((new Date(lead.nextPaymentDate).getTime() - now) / (1000 * 60 * 60 * 24));
          if (daysUntil < 0) counts.paymentsOverdue++;
        }
        break;
      case 'converted':
        counts.converted++;
        counts.activeClients++;
        if (lead.paymentStatus === 'overdue' || lead.paymentStatus === 'at-risk') {
          counts.paymentsOverdue++;
        }
        break;
      case 'closed-lost': case 'inbound-disqualified':
        counts.closedLost++;
        break;
    }
  }

  return counts;
}

// ═══════════════════════════════════════════════════════════
// STAGE CHANGE EXECUTOR — single entry point
// ═══════════════════════════════════════════════════════════

export function executeStageChange(
  lead: Lead,
  newStage: Stage,
  confirmedBy: string,
): { lead: Lead; valid: boolean; reason?: string } {
  // Validate transition
  if (!isValidTransition(lead.stage, newStage)) {
    return {
      lead,
      valid: false,
      reason: `Cannot move from ${STAGE_LABELS[lead.stage]} to ${STAGE_LABELS[newStage]}`,
    };
  }

  // Invalidate stale state
  const updated = invalidateOnStageChange(lead, newStage);

  return { lead: updated, valid: true };
}

// ═══════════════════════════════════════════════════════════
// ACTIVITY HISTORY CLEANUP
// ═══════════════════════════════════════════════════════════

/**
 * Check if an activity description contains legacy tool references.
 * Legacy activities are kept but marked so they don't generate actions.
 */
export function isLegacyActivity(description: string): boolean {
  const legacyTerms = ['smartlead', 'SmartLead', 'smart lead', 'SL:'];
  return legacyTerms.some(term => description.toLowerCase().includes(term.toLowerCase()));
}
