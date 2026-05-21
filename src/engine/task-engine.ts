/**
 * STYLIQUE CRM — Unified Task Engine V5
 * 
 * THE SINGLE SOURCE OF TRUTH for all task states.
 * 
 * Tasks are derived from TWO sources:
 * 1. Stored tasks (lead.tasks[]) — created by outcome engine
 * 2. Virtual tasks — derived from pipeline state when no stored task exists
 * 
 * Every lead in a non-terminal stage MUST produce exactly one of:
 *   - Action Required (user must do something now)
 *   - Upcoming (scheduled future action)
 *   - Awareness (owned but waiting on external)
 * 
 * V5: Integrates NBA engine for channel-specific manager guidance.
 */

import type { Lead, DealTask, TaskPriority } from '@/types/crm';
import { getLeadershipLabel, getOnboardingLabel } from '@/engine/role-matrix';
import { getTrialDaysLeft, hasValidCredentials, CLOSED_STAGES } from '@/types/crm';
import { getCanonicalState, canCurrentRoleAct, getReadOnlyStatusLabel, isActionableForRole, type ViewerRole, type OwnerRole } from '@/engine/canonical-state';
import { resolveAction, type ResolvedAction } from '@/engine/action-router';
import { getNextBestAction, type NextBestAction, type Channel } from '@/engine/nba-engine';

// ═══════════════════════════════════════════════════════════
// UNIFIED TASK ITEM — what surfaces in the UI
// ═══════════════════════════════════════════════════════════

export type TaskCategory = 'action_required' | 'upcoming' | 'awareness';

export interface UnifiedTaskItem {
  id: string;
  leadId: string;
  companyName: string;
  contactName: string;
  leadStage: string;
  
  /** Which tab this belongs to */
  category: TaskCategory;
  
  /** Main headline — manager-grade instruction */
  title: string;
  /** Why this needs action / why it's here */
  reason: string;
  /** Due date/time if applicable */
  dueDate: string | null;
  /** Is overdue? */
  isOverdue: boolean;
  /** Urgency level */
  urgency: 'critical' | 'high' | 'normal' | 'low';
  
  /** The resolved CTA action from action-router */
  action: ResolvedAction;
  
  /** NBA: channel recommendation */
  channel: Channel;
  channelLabel: string;
  /** NBA: due timing label */
  dueTiming: string;
  /** NBA: outcome previews */
  outcomes: Array<{ label: string; systemEffect: string }>;
  /** NBA: fallback if primary action fails */
  fallback: { instruction: string; channel: Channel } | null;
  
  /** If from a stored task, reference it */
  storedTaskId?: string;
  storedTaskType?: DealTask['type'];
  
  /** For awareness items: who currently owns the step */
  currentOwner?: string;
  /** For awareness: what event will move it to action */
  triggerEvent?: string;
  
  /** Trial days left if relevant */
  trialDaysLeft?: number | null;
}

// ═══════════════════════════════════════════════════════════
// MAIN ENTRY: Derive all tasks for a user
// ═══════════════════════════════════════════════════════════

export function deriveUnifiedTasks(
  leads: Lead[],
  userId: string,
  role: 'sdr' | 'onboarding' | 'ceo' | 'coo',
): { actionRequired: UnifiedTaskItem[]; upcoming: UnifiedTaskItem[]; awareness: UnifiedTaskItem[] } {
  const viewerRole: ViewerRole = role === 'ceo' || role === 'coo' ? role : role === 'onboarding' ? 'onboarding' : 'sdr';
  
  const actionRequired: UnifiedTaskItem[] = [];
  const upcoming: UnifiedTaskItem[] = [];
  const awareness: UnifiedTaskItem[] = [];

  for (const lead of leads) {
    // Skip terminal stages — converted and closed leads produce no tasks
    if (CLOSED_STAGES.includes(lead.stage) || lead.stage === 'converted' || lead.stage === 'closed-lost' || lead.stage === 'unsubscribed' || lead.stage === 'cold-no-response' || lead.stage === 'inbound-disqualified') continue;

    const cs = getCanonicalState(lead);
    const isOwned = isLeadOwnedByUser(lead, userId, role);
    const canAct = canCurrentRoleAct(lead, viewerRole, userId);
    const resolvedAction = resolveAction(lead, viewerRole, userId);

    // Skip leads this user doesn't own or depend on
    if (!isOwned && !isRelevantForRole(lead, userId, role, cs)) continue;

    // Check for stored active tasks first
    const storedTasks = getActiveStoredTasks(lead, userId, role);
    
    if (canAct && resolvedAction.canAct && resolvedAction.intent !== 'none') {
      // USER CAN ACT — check if action required now or upcoming
      
      if (storedTasks.length > 0) {
        // Use stored tasks (they have due dates)
        for (const task of storedTasks) {
          const now = new Date();
          const due = new Date(task.dueDate);
          const isOverdue = due < now;
          const isDueToday = due.toDateString() === now.toDateString();
          
          if (isOverdue || isDueToday) {
            actionRequired.push(createTaskItem(lead, task, resolvedAction, 'action_required', isOverdue));
          } else {
            upcoming.push(createTaskItem(lead, task, resolvedAction, 'upcoming', false));
          }
        }
      } else {
        // No stored task — create virtual action-required item from pipeline state
        actionRequired.push(createVirtualTask(lead, resolvedAction, cs));
      }
    } else if (isOwned) {
      // USER OWNS but can't act — this is an AWARENESS item
      // Check for upcoming stored tasks first
      const futureTasks = storedTasks.filter(t => new Date(t.dueDate) > new Date());
      if (futureTasks.length > 0) {
        for (const task of futureTasks) {
          upcoming.push(createTaskItem(lead, task, resolvedAction, 'upcoming', false));
        }
      } else {
        // Pure awareness — use NBA for rich context
        const readOnlyLabel = getReadOnlyStatusLabel(lead, viewerRole);
        const nba = getNextBestAction(lead);
        awareness.push({
          id: `awareness-${lead.id}`,
          leadId: lead.id,
          companyName: lead.companyName,
          contactName: lead.contactName,
          leadStage: lead.stage,
          category: 'awareness',
          title: nba.isAction ? nba.instruction : (nba.instruction || lead.companyName),
          reason: nba.reason || readOnlyLabel || cs.next_action_label || 'Monitoring',
          dueDate: null,
          isOverdue: false,
          urgency: 'low',
          action: resolvedAction,
          channel: nba.channel,
          channelLabel: nba.channelLabel,
          dueTiming: nba.dueTiming,
          outcomes: nba.outcomes,
          fallback: nba.fallback,
          currentOwner: deriveCurrentOwnerName(cs.next_action_owner_role, lead),
          triggerEvent: deriveTriggerEvent(cs.next_action_owner_role, lead, cs),
          trialDaysLeft: getTrialDaysLeft(lead),
        });
      }
    }
  }

  // Sort: 1) overdue, 2) due today, 3) intent class (replies/meetings first,
  // then decision-pending follow-ups, then cold revival), 4) urgency, 5) due date.
  const urgencyOrder = { critical: 0, high: 1, normal: 2, low: 3 };
  const intentClass = (it: UnifiedTaskItem): number => {
    const i = it.action?.intent || '';
    const stage = it.leadStage;
    if (i === 'log_meeting_outcome' || i === 'book_meeting') return 0;
    if (stage === 'sdr-replied' || stage === 'replied' || stage === 'inbound-qualified') return 1;
    if (stage === 'internal-decision' || stage === 'pricing-discussion') return 2;
    if (stage === 'cold-no-response') return 4;
    return 3;
  };
  const todayStr = new Date().toDateString();
  const dueBucket = (it: UnifiedTaskItem): number => {
    if (it.isOverdue) return 0;
    if (it.dueDate && new Date(it.dueDate).toDateString() === todayStr) return 1;
    return 2;
  };
  actionRequired.sort((a, b) => {
    const db_ = dueBucket(a) - dueBucket(b);
    if (db_ !== 0) return db_;
    const ic = intentClass(a) - intentClass(b);
    if (ic !== 0) return ic;
    const ua = urgencyOrder[a.urgency] ?? 2;
    const ub = urgencyOrder[b.urgency] ?? 2;
    if (ua !== ub) return ua - ub;
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const dbb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - dbb;
  });

  upcoming.sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });

  return { actionRequired, upcoming, awareness };
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function isLeadOwnedByUser(lead: Lead, userId: string, role: string): boolean {
  if (role === 'sdr') return lead.assignedTo === userId || lead.assigned_sdr === userId;
  if (role === 'onboarding') {
    // Onboarding only owns the trial-prep / trial / payment-pending window.
    // Even on those leads, leadership-owned steps (approval, payment confirm)
    // must NOT surface here — that filtering happens via canCurrentRoleAct
    // in deriveUnifiedTasks. Awareness is allowed and expected.
    return ['trial-proposed', 'trial-active', 'payment-pending'].includes(lead.stage)
      || lead.assigned_onboarding_owner === userId;
  }
  if (role === 'ceo' || role === 'coo') {
    // Leadership "owns" only leads currently waiting on a leadership decision.
    // Everything else is SDR/onboarding execution and stays out of /tasks.
    const cs = getCanonicalState(lead);
    return cs.next_action_owner_role === 'leadership';
  }
  return false;
}

function isRelevantForRole(lead: Lead, userId: string, role: string, cs: ReturnType<typeof getCanonicalState>): boolean {
  // SDR sees awareness for their owned leads in trial/payment stages
  if (role === 'sdr' && (lead.assignedTo === userId || lead.assigned_sdr === userId)) {
    return ['trial-proposed', 'trial-active', 'payment-pending'].includes(lead.stage);
  }
  // Leadership sees items needing their decision
  if (role === 'ceo' || role === 'coo') {
    return cs.next_action_owner_role === 'leadership';
  }
  return false;
}

/** SDR task types — only the real SDR actionables.
 *  Excludes payment / trial-end (leadership-owned) — those are not SDR Do-Now items. */
const SDR_TASK_TYPES: DealTask['type'][] = ['follow-up', 'outreach', 'conversion-push', 'meeting-prep', 'meeting-summary', 'general'];
const ONBOARDING_TASK_TYPES: DealTask['type'][] = ['onboarding', 'check-in'];
const LEADERSHIP_TASK_TYPES: DealTask['type'][] = ['payment', 'trial-end'];

function getActiveStoredTasks(lead: Lead, userId: string, role: string): DealTask[] {
  const tasks = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled');
  
  switch (role) {
    case 'sdr':
      return tasks.filter(t => {
        if (t.assignedTo !== userId) return false;
        if (!SDR_TASK_TYPES.includes(t.type)) return false;
        return true;
      });
    case 'onboarding':
      return tasks.filter(t => {
        if (t.assignedTo !== userId && t.assignedTo !== 'muneeb') return false;
        if (!ONBOARDING_TASK_TYPES.includes(t.type)) return false;
        return true;
      });
    case 'ceo':
    case 'coo':
      return tasks.filter(t => LEADERSHIP_TASK_TYPES.includes(t.type));
    default:
      return [];
  }
}

function createTaskItem(
  lead: Lead,
  task: DealTask,
  action: ResolvedAction,
  category: TaskCategory,
  isOverdue: boolean,
): UnifiedTaskItem {
  const nba = getNextBestAction(lead);
  const urgency: UnifiedTaskItem['urgency'] = 
    isOverdue ? 'critical' :
    task.priority === 'critical' ? 'critical' :
    task.priority === 'high' ? 'high' :
    action.urgency === 'critical' ? 'critical' :
    action.urgency === 'warning' ? 'high' : 'normal';

  // Use role-appropriate titles
  const titleForRole = nba.isAction ? nba.instruction : (
    action.canAct && action.intent !== 'none' && action.intent !== 'open_record'
      ? action.label
      : task.title
  );
  const reasonForRole = nba.isAction ? nba.reason : (task.reason || action.label || '');

  return {
    id: task.id,
    leadId: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    leadStage: lead.stage,
    category,
    title: titleForRole,
    reason: reasonForRole,
    dueDate: task.dueDate,
    isOverdue,
    urgency,
    action,
    channel: nba.channel,
    channelLabel: nba.channelLabel,
    dueTiming: nba.dueTiming,
    outcomes: nba.outcomes,
    fallback: nba.fallback,
    storedTaskId: task.id,
    storedTaskType: task.type,
    trialDaysLeft: getTrialDaysLeft(lead),
  };
}

function createVirtualTask(
  lead: Lead,
  action: ResolvedAction,
  cs: ReturnType<typeof getCanonicalState>,
): UnifiedTaskItem {
  const nba = getNextBestAction(lead);
  const urgency: UnifiedTaskItem['urgency'] =
    action.urgency === 'critical' ? 'critical' :
    action.urgency === 'warning' ? 'high' : 'normal';

  return {
    id: `virtual-${lead.id}`,
    leadId: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    leadStage: lead.stage,
    category: 'action_required',
    title: nba.isAction ? nba.instruction : action.label,
    reason: nba.isAction ? nba.reason : (cs.status_label || cs.next_action_label || ''),
    dueDate: lead.next_action_due_at || new Date().toISOString(),
    isOverdue: false,
    urgency,
    action,
    channel: nba.channel,
    channelLabel: nba.channelLabel,
    dueTiming: nba.dueTiming,
    outcomes: nba.outcomes,
    fallback: nba.fallback,
    trialDaysLeft: getTrialDaysLeft(lead),
  };
}

function deriveCurrentOwnerName(ownerRole: OwnerRole, lead: Lead): string {
  switch (ownerRole) {
    case 'leadership': return 'CEO/COO';
    case 'onboarding': return lead.assigned_onboarding_owner ? capitalize(lead.assigned_onboarding_owner) : 'Muneeb';
    case 'sdr': return lead.assignedTo ? capitalize(lead.assignedTo) : 'SDR';
    case 'automation': return 'AI System';
    default: return '';
  }
}

function deriveTriggerEvent(ownerRole: OwnerRole, lead: Lead, cs: ReturnType<typeof getCanonicalState>): string {
  if (ownerRole === 'leadership') {
    if (cs.trial_stage === 'needs_approval' || cs.trial_stage === 'needs_approval_and_credentials') {
      return 'CEO/COO approves trial → onboarding can proceed';
    }
    if (cs.commercial_stage === 'payment_pending') return 'Payment confirmed → client activated';
    return 'Leadership decision pending';
  }
  if (ownerRole === 'onboarding') {
    if (cs.trial_stage === 'needs_credentials') return 'Credentials added → trial can activate';
    if (cs.trial_stage === 'ready_to_activate') return 'Onboarding activates → trial begins';
    if (cs.trial_stage === 'active') {
      const dl = getTrialDaysLeft(lead);
      return dl !== null ? `Check-in or conversion push at day ${14 - dl}` : 'Monitoring trial usage';
    }
    return 'Onboarding completes setup';
  }
  if (ownerRole === 'automation') return 'Reply, warm threshold, or sequence completion triggers SDR action';
  return '';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ═══════════════════════════════════════════════════════════
// STALE TASK ARCHIVAL — called on every stage change
// ═══════════════════════════════════════════════════════════

export function archiveStaleTasksForStage(tasks: DealTask[], newStage: string): DealTask[] {
  const now = new Date().toISOString();
  const STAGE_TO_FAMILY: Record<string, string> = {
    'new-lead': 'prospecting', 'contacted': 'prospecting', 'lead-added': 'prospecting',
    'outreach-1': 'prospecting', 'outreach-2': 'prospecting', 'outreach-3': 'prospecting',
    'sequence-completed': 'prospecting', 'new-inquiry': 'prospecting',
    'ai-new-lead': 'prospecting', 'pending-enrichment': 'prospecting', 'pending-apollo': 'prospecting',
    'ready-for-outreach': 'prospecting', 'email-sent-d0': 'prospecting', 'followup-1-d3': 'prospecting',
    'followup-2-d7': 'prospecting', 'followup-3-d14': 'prospecting', 'round4-d17': 'prospecting',
    'inbound-new': 'prospecting', 'inbound-qualified': 'engagement',
    'inbound-awaiting-sdr': 'engagement', 'inbound-disqualified': 'closed',
    'sdr-new-lead': 'prospecting', 'sdr-contacted': 'prospecting', 'sdr-replied': 'engagement',
    'replied': 'engagement', 'awaiting-sdr': 'engagement', 'qualified': 'engagement',
    'meeting-booked': 'meeting', 'meeting-completed': 'meeting',
    'internal-decision': 'meeting', 'pricing-discussion': 'meeting',
    'trial-proposed': 'trial-prep',
    'trial-active': 'trial',
    'payment-pending': 'payment',
    'converted': 'customer',
    'closed-lost': 'closed',
  };

  const FAMILY_ORDER = ['prospecting', 'engagement', 'meeting', 'trial-prep', 'trial', 'payment', 'customer', 'closed'];
  const newFamily = STAGE_TO_FAMILY[newStage] || 'prospecting';
  const newFamilyIdx = FAMILY_ORDER.indexOf(newFamily);

  const ARCHIVE_ON_STAGE: Record<string, DealTask['type'][]> = {
    'trial-proposed': ['outreach', 'follow-up', 'meeting-prep', 'meeting-summary'],
    'trial-active': ['outreach', 'follow-up', 'meeting-prep', 'meeting-summary', 'onboarding', 'check-in'],
    'payment-pending': ['onboarding', 'check-in', 'conversion-push', 'trial-end'],
    'converted': ['onboarding', 'check-in', 'conversion-push', 'trial-end', 'payment', 'follow-up'],
    'closed-lost': ['outreach', 'follow-up', 'onboarding', 'check-in', 'conversion-push', 'trial-end', 'payment', 'meeting-prep', 'meeting-summary'],
  };

  const archiveTypes = ARCHIVE_ON_STAGE[newStage] || [];

  return tasks.map(task => {
    if (task.completed || task.state === 'cancelled') return task;
    if (!task.autoGenerated) return task;

    if (archiveTypes.includes(task.type)) {
      return { ...task, state: 'cancelled' as const, completed: true, cancelledAt: now, cancelReason: `Archived: stage changed to ${newStage}` };
    }

    if (task.stageFamily) {
      const taskFamilyIdx = FAMILY_ORDER.indexOf(task.stageFamily);
      if (taskFamilyIdx >= 0 && taskFamilyIdx < newFamilyIdx) {
        return { ...task, state: 'cancelled' as const, completed: true, cancelledAt: now, cancelReason: `Archived: stage progressed past ${task.stageFamily}` };
      }
    }

    return task;
  });
}

// ═══════════════════════════════════════════════════════════
// LEGACY EXPORTS (kept for backward compat)
// ═══════════════════════════════════════════════════════════

export interface TaskWithContext extends DealTask {
  leadId: string;
  companyName: string;
  contactName: string;
  leadStage: string;
}

export function getTasksForUser(
  leads: Lead[],
  userId: string,
  role: 'sdr' | 'onboarding' | 'ceo' | 'coo',
): { doNow: TaskWithContext[]; nextUp: TaskWithContext[]; waiting: TaskWithContext[]; total: number } {
  // Delegate to unified engine and map back
  const { actionRequired, upcoming, awareness } = deriveUnifiedTasks(leads, userId, role);
  
  const mapToLegacy = (item: UnifiedTaskItem): TaskWithContext => ({
    id: item.storedTaskId || item.id,
    title: item.title,
    dueDate: item.dueDate || new Date().toISOString(),
    completed: false,
    assignedTo: userId,
    type: item.storedTaskType || 'general',
    createdAt: new Date().toISOString(),
    leadId: item.leadId,
    companyName: item.companyName,
    contactName: item.contactName,
    leadStage: item.leadStage,
    reason: item.reason,
    priority: item.urgency as TaskPriority,
  });

  return {
    doNow: actionRequired.map(mapToLegacy),
    nextUp: upcoming.map(mapToLegacy),
    waiting: awareness.map(mapToLegacy),
    total: actionRequired.length + upcoming.length + awareness.length,
  };
}
