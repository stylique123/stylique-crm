/**
 * Canonical Action Router — manager-grade CTA labels for every lead.
 *
 * Rules:
 *  - Same lead + same role + same state = same action everywhere
 *  - Leadership NEVER sees SDR execution actions
 *  - Onboarding NEVER sees SDR prospecting actions
 *  - SDR NEVER sees onboarding setup actions
 *  - Labels use direct manager language, never system jargon
 */

import type { Lead, DealTask } from '@/types/crm';
import {
  hasValidCredentials, getTrialDaysLeft, getPaymentDaysUntilDue,
  PLAN_PRICES, CLOSED_STAGES, CONVERTED_STAGES,
} from '@/types/crm';
import { getCanonicalState, canCurrentRoleAct, type ViewerRole } from '@/engine/canonical-state';
import { evaluateSDRTrigger, type SDRTriggerType } from '@/engine/sdr-flow-engine';

export type ActionIntent =
  | 'open_record'
  | 'outreach_start'
  | 'sdr_signal'
  | 'book_meeting'
  | 'log_meeting_outcome'
  | 'approve_trial'
  | 'add_credentials'
  | 'confirm_payment'
  | 'trial_setup'
  | 'activate_trial'
  | 'log_check_in'
  | 'review_usage'
  | 'call'
  | 'conversion_push'
  | 'stage_transition'
  | 'none';

export interface ResolvedAction {
  intent: ActionIntent;
  label: string;
  urgency: 'critical' | 'warning' | 'normal' | 'muted';
  triggerType?: SDRTriggerType;
  triggerTitle?: string;
  triggerReason?: string;
  canAct: boolean;
  readOnlyLabel?: string;
}

export function resolveAction(lead: Lead, viewerRole: ViewerRole, currentUser: string): ResolvedAction {
  const cs = getCanonicalState(lead);
  const canAct = canCurrentRoleAct(lead, viewerRole, currentUser);

  if (CLOSED_STAGES.includes(lead.stage) || cs.lifecycle_stage === 'lost') {
    return { intent: 'none', label: '', urgency: 'muted', canAct: false };
  }

  if (viewerRole === 'ceo' || viewerRole === 'coo') return resolveLeadershipAction(lead, cs);
  if (viewerRole === 'operations') {
    const action = resolveLeadershipAction(lead, cs);
    return { ...action, canAct: false, readOnlyLabel: action.readOnlyLabel || 'View only' };
  }
  if (viewerRole === 'onboarding') return resolveOnboardingAction(lead, cs, canAct);
  return resolveSDRAction(lead, cs, canAct, currentUser);
}

function resolveLeadershipAction(lead: Lead, cs: ReturnType<typeof getCanonicalState>): ResolvedAction {
  if (['needs_approval', 'needs_approval_and_credentials'].includes(cs.trial_stage)) {
    return { intent: 'approve_trial', label: `Approve`, urgency: 'warning', canAct: true };
  }
  // Approved-but-credentials-missing is NOT a leadership decision card.
  // It is a setup blocker surfaced in Risks/Trials/Onboarding only.
  // Leadership sees a passive read-only label here.
  if (cs.trial_stage === 'needs_credentials' && lead.approvedBy) {
    return {
      intent: 'open_record',
      label: 'Credentials missing',
      urgency: 'normal',
      canAct: false,
      readOnlyLabel: 'Credentials missing',
    };
  }
  if (cs.commercial_stage === 'payment_pending' || cs.commercial_stage === 'overdue') {
    const days = getPaymentDaysUntilDue(lead);
    const isOverdue = days !== null && days < 0;
    return {
      intent: 'confirm_payment',
      label: isOverdue ? 'Payment overdue' : 'Confirm payment',
      urgency: isOverdue ? 'warning' : 'warning',
      canAct: true,
    };
  }
  if (cs.trial_stage === 'ending' || cs.trial_stage === 'expired') {
    return { intent: 'open_record', label: 'Review client decision', urgency: 'warning', canAct: true };
  }
  return { intent: 'none', label: '', urgency: 'muted', canAct: false };
}

function resolveOnboardingAction(lead: Lead, cs: ReturnType<typeof getCanonicalState>, canAct: boolean): ResolvedAction {
  if (cs.trial_stage === 'needs_approval' || cs.trial_stage === 'needs_approval_and_credentials') {
    return {
      intent: 'open_record', label: 'Waiting for approval', urgency: 'normal', canAct: false,
      readOnlyLabel: 'Waiting for approval',
    };
  }
  if (!canAct) return { intent: 'none', label: '', urgency: 'muted', canAct: false };
  if (cs.trial_stage === 'needs_credentials') {
    // Onboarding never enters credentials. Always shown as waiting.
    return {
      intent: 'open_record', label: 'Waiting for credentials', urgency: 'normal', canAct: false,
      readOnlyLabel: 'Credentials missing',
    };
  }
  if (cs.trial_stage === 'ready_to_activate') {
    // Direct, idempotent activation — no setup dialog, no credential prompt.
    return { intent: 'activate_trial', label: `Done & verified — ${lead.companyName}`, urgency: 'warning', canAct: true };
  }
  if (lead.stage === 'trial-active') {
    const nextTask = getNextOnboardingTask(lead);
    if (nextTask) {
      const isCheckIn = /check.?in/i.test(nextTask.type) || /check.?in/i.test(nextTask.title);
      const isUsage = /usage|review/i.test(nextTask.title);
      if (isCheckIn) return { intent: 'log_check_in', label: `Complete check-in — ${lead.companyName}`, urgency: 'warning', canAct: true };
      if (isUsage) return { intent: 'review_usage', label: `Check-in due — ${lead.companyName}`, urgency: 'warning', canAct: true };
      return { intent: 'log_check_in', label: nextTask.title?.substring(0, 40) || 'Add onboarding result', urgency: 'warning', canAct: true };
    }
    const dl = getTrialDaysLeft(lead);
    return {
      intent: 'open_record',
      label: dl !== null ? `Onboarding active — ${dl}d left` : 'Onboarding active',
      urgency: dl !== null && dl <= 3 ? 'warning' : 'normal',
      canAct: true,
    };
  }
  return { intent: 'none', label: '', urgency: 'muted', canAct: false };
}

function resolveSDRAction(lead: Lead, cs: ReturnType<typeof getCanonicalState>, canAct: boolean, currentUser: string): ResolvedAction {
  if (!canAct) return { intent: 'none', label: '', urgency: 'muted', canAct: false };

  // Closed / Converted
  if (['converted', 'closed', 'lost', 'unsubscribed', 'cold_no_response'].includes(cs.lifecycle_stage)) {
    return { intent: 'open_record', label: cs.lifecycle_stage === 'converted' ? 'View client' : 'View closed', urgency: 'muted', canAct: false };
  }

  // Payment
  if (cs.commercial_stage === 'payment_pending') {
    return { intent: 'open_record', label: 'Payment pending — leadership confirming', urgency: 'normal', canAct: false, readOnlyLabel: 'Leadership handling payment' };
  }
  if (cs.commercial_stage === 'overdue') {
    return { intent: 'open_record', label: 'Payment overdue', urgency: 'warning', canAct: true };
  }

  // Active onboarding / awaiting payment compatibility state.
  if (cs.lifecycle_stage === 'trial_active' || lead.stage === 'trial-active') {
    const daysLeft = getTrialDaysLeft(lead);
    if (daysLeft !== null && daysLeft <= 3) {
      return { intent: 'open_record', label: `Client decision due in ${daysLeft}d`, urgency: 'warning', canAct: true };
    }
    const convTask = getNextConversionTask(lead);
    if (convTask) {
      return { intent: 'call', label: convTask.title?.substring(0, 40) || 'Decision pending', urgency: 'warning', canAct: true };
    }
    return { intent: 'call', label: daysLeft !== null ? `Decision due in ${daysLeft}d` : 'Decision pending', urgency: 'normal', canAct: true };
  }

  // Client Review — SDR awareness
  if (cs.lifecycle_stage === 'trial_proposed' || cs.lifecycle_stage === 'trial_ready') {
    if (cs.trial_stage === 'needs_approval' || cs.trial_stage === 'needs_approval_and_credentials') {
      return { intent: 'open_record', label: 'Client Review', urgency: 'normal', canAct: true, readOnlyLabel: 'Waiting for approval' };
    }
    if (cs.trial_stage === 'needs_credentials') {
      return { intent: 'open_record', label: 'Waiting on credentials', urgency: 'normal', canAct: true, readOnlyLabel: 'Onboarding adding credentials' };
    }
    if (cs.trial_stage === 'ready_to_activate') {
      return { intent: 'open_record', label: 'Onboarding queue', urgency: 'normal', canAct: true, readOnlyLabel: 'Onboarding queue' };
    }
    return { intent: 'open_record', label: 'Client Review', urgency: 'normal', canAct: true };
  }

  // Decision pending
  if (cs.lifecycle_stage === 'conversion_pending') {
    return { intent: 'open_record', label: 'Decision pending', urgency: 'warning', canAct: true };
  }

  // Meeting completed
  if (cs.lifecycle_stage === 'meeting_completed' || lead.stage === 'meeting-completed') {
    const pastNoSummary = lead.meetingNotes?.find(m => new Date(m.date) < new Date() && !m.summary?.trim());
    if (pastNoSummary) {
      return { intent: 'log_meeting_outcome', label: 'Meeting result missing', urgency: 'warning', canAct: true };
    }
    const nextTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
    return {
      intent: 'open_record',
      label: nextTask?.title?.substring(0, 40) || 'Send follow-up materials',
      urgency: 'warning', canAct: true,
    };
  }

  // Internal decision
  if (cs.lifecycle_stage === 'internal_decision' || lead.stage === 'internal-decision') {
    const nextTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
    return { intent: 'call', label: nextTask?.title?.substring(0, 40) || `Check back — internal decision`, urgency: 'warning', canAct: true };
  }

  // Pricing
  if (cs.lifecycle_stage === 'pricing_discussion' || lead.stage === 'pricing-discussion') {
    const nextTask = (lead.tasks || []).find(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
    return { intent: 'open_record', label: nextTask?.title?.substring(0, 40) || `Send pricing follow-up`, urgency: 'warning', canAct: true };
  }

  // Meeting booked
  if (cs.lifecycle_stage === 'meeting_booked' || lead.stage === 'meeting-booked') {
    const now = new Date();
    const pastMeeting = lead.meetingNotes?.find(m => new Date(m.date) < now && !m.summary?.trim());
    if (pastMeeting) {
      return { intent: 'log_meeting_outcome', label: 'Meeting result missing', urgency: 'warning', canAct: true };
    }
    const todayMeeting = lead.meetingNotes?.find(m => {
      const diff = new Date(m.date).getTime() - now.getTime();
      return diff > 0 && diff < 24 * 60 * 60 * 1000;
    });
    if (todayMeeting) {
      return { intent: 'log_meeting_outcome', label: 'Meeting today', urgency: 'warning', canAct: true };
    }
    return { intent: 'open_record', label: 'Prepare for meeting', urgency: 'normal', canAct: true };
  }

  // Replied — book meeting
  if (cs.lifecycle_stage === 'replied' || lead.stage === 'replied' || lead.stage === 'sdr-replied') {
    return { intent: 'book_meeting', label: 'Schedule meeting', urgency: 'warning', canAct: true };
  }

  // Contacted — signal-driven
  if (cs.lifecycle_stage === 'contacted') {
    if (cs.entry_flow === 'sdr_manual' || lead.pipeline === 'outbound-sdr') {
      const trigger = evaluateSDRTrigger(lead);

      if (trigger.type === 'outreach_entry') {
        const daysSince = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
        if (daysSince <= 1) {
          return {
            intent: 'outreach_start', label: 'Contact', urgency: 'normal', canAct: true,
            triggerType: trigger.type, triggerTitle: trigger.title, triggerReason: trigger.reason,
          };
        }
        return {
          intent: 'sdr_signal', label: 'Follow up — no response yet', urgency: 'warning', canAct: true,
          triggerType: 'day5_no_response', triggerTitle: 'Follow up required',
          triggerReason: `Lead contacted ${daysSince} days ago — follow up or add status`,
        };
      }

      if (trigger.type !== 'no_trigger' && trigger.type !== 'email_automation_check') {
        const labelMap: Partial<Record<SDRTriggerType, string>> = {
          linkedin_accepted: 'LinkedIn accepted',
          warm_open_signal: 'Email opened',
          day5_no_response: 'Follow-up due',
          post_call_no_response: 'Send Instagram DM',
          reply_received: 'Schedule meeting',
          linkedin_pending: 'Check LinkedIn status',
        };
        return {
          intent: 'sdr_signal',
          label: labelMap[trigger.type] || trigger.taskLabel || 'Add outcome',
          urgency: trigger.type === 'linkedin_pending' ? 'muted' : 'warning',
          canAct: true,
          triggerType: trigger.type, triggerTitle: trigger.title, triggerReason: trigger.reason,
        };
      }
    }
    return { intent: 'open_record', label: 'Waiting for reply', urgency: 'normal', canAct: true };
  }

  // New lead
  if (cs.lifecycle_stage === 'new_lead') {
    if (['new-inquiry', 'qualified', 'awaiting-sdr'].includes(lead.stage)) {
      return { intent: 'call', label: 'No outreach yet', urgency: 'normal', canAct: true };
    }
    return { intent: 'outreach_start', label: 'Contact', urgency: 'warning', canAct: true };
  }

  return { intent: 'none', label: '', urgency: 'muted', canAct: false };
}

function getNextOnboardingTask(lead: Lead): DealTask | null {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (lead.tasks || [])
    .filter(t => !t.completed && t.state !== 'cancelled' && ['onboarding', 'check-in'].includes(t.type) && new Date(t.dueDate) <= endOfToday)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null;
}

function getNextConversionTask(lead: Lead): DealTask | null {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (lead.tasks || [])
    .filter(t => !t.completed && t.state !== 'cancelled' && ['conversion-push', 'follow-up'].includes(t.type) && new Date(t.dueDate) <= endOfToday)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null;
}
