/**
 * STYLIQUE CRM — Action Executor
 * 
 * Centralized execution engine. Every action:
 * 1. Executes immediately
 * 2. Logs automatically
 * 3. Updates timing memory (lastEmailAt, lastCallAt, etc.)
 * 4. Triggers next action recalculation
 * 5. Auto-completes (no manual "Done" needed)
 * 
 * IMPORTANT: Uses save/activity callbacks from company store context.
 * Never imports getLeads/saveLead/addActivity from store directly.
 */

import type { Lead, ActionCompletion, DealTask, Activity } from '@/types/crm';
import { recalculateNextAction, refreshTasksForStage, hasValidCredentials } from '@/types/crm';
import { uid } from '@/lib/store';
import { archiveStaleTasksForStage } from '@/engine/task-engine';
import { allowMutation } from '@/engine/hardening';
import { emitKPI } from '@/engine/kpi-integration';
import { emitCRMEvent, type CRMEventType } from '@/engine/event-bus';
import type { ActionKPIMetric, KPIActionEntry } from '@/types/kpi';

export type ExecutionChannel = 'email' | 'phone' | 'linkedin' | 'whatsapp' | 'meeting' | 'system';

export interface ExecutionResult {
  success: boolean;
  lead: Lead;
  nextAction?: string;
  message: string;
  /** Activity to log — caller must pass to store.addActivity */
  activity?: Activity;
}

/** Callbacks for persisting — provided by the component via useCompanyStore() */
export interface StoreBridge {
  saveCompany: (lead: Lead) => void;
  addActivity: (activity: Activity) => void;
}

// ═══════════════════════════════════════════════════════════
// CANONICAL LEAD MUTATION CONTRACT
// ═══════════════════════════════════════════════════════════
//
// Single trusted entry point for ALL Lead writes that originate outside
// the engines (page-level handlers, dialogs, etc.). Engines may continue
// to call bridge.saveCompany directly because they already bundle their
// own activity/KPI/event emission. Page handlers MUST go through this
// helper so we cannot drift on:
//   - record persistence
//   - activity logging
//   - KPI emission
//   - store refresh
//   - CRM event emission
//
// If you find yourself calling bridge.saveCompany followed by addActivity
// followed by emitKPI followed by refresh() at a page level — use this.
// ═══════════════════════════════════════════════════════════

export interface LeadMutationKPI {
  sdrId: string;
  contactName: string;
  metric: ActionKPIMetric;
  channel: KPIActionEntry['channel'];
  outcome?: string;
}

export interface LeadMutationInput {
  /** The fully-built next Lead state (caller has already applied recalculateNextAction). */
  lead: Lead;
  /** Optional activity to log alongside the write. */
  activity?: Activity;
  /** Optional KPI emissions tied to this mutation. */
  kpis?: LeadMutationKPI[];
  /** Optional CRM event to publish (defaults to none — store auto-refreshes on bus emissions). */
  event?: { type: CRMEventType; performedBy: string; description: string };
  /** Optional explicit refresh callback (typically useCompanyStore().refresh). */
  refresh?: () => void;
}

/**
 * Commit a single Lead mutation through the canonical path.
 * Order is fixed: persist → activity → KPI → event → refresh.
 */
export function commitLeadMutation(bridge: StoreBridge, input: LeadMutationInput): Lead {
  bridge.saveCompany(input.lead);
  if (input.activity) bridge.addActivity(input.activity);
  if (input.kpis && input.kpis.length) {
    for (const k of input.kpis) {
      emitKPI(k.sdrId, input.lead, k.contactName, k.metric, k.channel, k.outcome);
    }
  }
  if (input.event) emitCRMEvent(input.event.type, input.event.performedBy, input.event.description);
  if (input.refresh) input.refresh();
  return input.lead;
}

// ═══════════════════════════════════════════════════════════
// CORE EXECUTOR — every action flows through here
// ═══════════════════════════════════════════════════════════

function executeCore(
  lead: Lead,
  actionLabel: string,
  channel: ExecutionChannel,
  performedBy: string,
  bridge: StoreBridge,
  notes?: string,
): Lead {
  // Duplicate-submit protection
  if (!allowMutation(lead.id, actionLabel)) {
    console.warn(`[ActionExecutor] Blocked duplicate: ${actionLabel} on ${lead.companyName}`);
    return lead;
  }
  const now = new Date().toISOString();

  // 1. Log the completion
  const completion: ActionCompletion = {
    id: uid(),
    action: actionLabel,
    completedAt: now,
    completedBy: performedBy,
    channel,
    notes,
  };

  // 2. Update timing memory
  const timingUpdate: Partial<Lead> = { lastContactedAt: now, updatedAt: now };
  switch (channel) {
    case 'email': timingUpdate.lastEmailAt = now; break;
    case 'phone': timingUpdate.lastCallAt = now; break;
    case 'linkedin': timingUpdate.lastLinkedinAt = now; break;
  }

  // 3. Build updated lead
  let updated: Lead = {
    ...lead,
    ...timingUpdate,
    actionCompletions: [...(lead.actionCompletions || []), completion],
  };

  // 4. Complete matching pending task
  const taskMatch = (updated.tasks || []).find(
    t => !t.completed && t.title.toLowerCase().includes(actionLabel.toLowerCase().slice(0, 20))
  );
  if (taskMatch) {
    updated.tasks = updated.tasks.map(t =>
      t.id === taskMatch.id
        ? { ...t, completed: true, completedAt: now, completedBy: performedBy, state: 'completed' as const }
        : t
    );
  }

  // 5. Recalculate next action
  const intel = recalculateNextAction(updated);
  updated = {
    ...updated,
    nextAction: intel.action,
    nextActionReason: intel.reason,
    nextActionUrgency: intel.urgency,
    nextFollowUp: intel.followUpDate,
  };

  // 6. Persist via store bridge
  bridge.saveCompany(updated);

  // 7. Log activity via store bridge
  bridge.addActivity({
    id: uid(),
    leadId: lead.id,
    type: channel === 'phone' ? 'call' : channel === 'email' ? 'email' : channel === 'meeting' ? 'meeting' : 'action-completed',
    description: `✓ ${actionLabel} — ${lead.companyName}`,
    createdAt: now,
    createdBy: performedBy,
  });

  return updated;
}

// ═══════════════════════════════════════════════════════════
// SPECIFIC EXECUTORS — typed, validated, auto-completing
// ═══════════════════════════════════════════════════════════

/** Execute email send — auto-completes action */
export function executeEmailSend(lead: Lead, performedBy: string, bridge: StoreBridge, draftSubject?: string): ExecutionResult {
  const label = draftSubject || 'Email sent';
  const updated = executeCore(lead, label, 'email', performedBy, bridge);
  emitKPI(performedBy, lead, lead.contactName, 'emails_sent', 'email');
  emitCRMEvent('outreach.email_sent', performedBy, `Email sent to ${lead.contactName} at ${lead.companyName}`, {
    leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
    nextStep: updated.nextAction,
  });
  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Email sent to ${lead.contactName} at ${lead.companyName}` };
}

/** Execute LinkedIn action — auto-completes on click */
export function executeLinkedinAction(lead: Lead, performedBy: string, bridge: StoreBridge): ExecutionResult {
  const updated = executeCore(lead, 'LinkedIn connect sent', 'linkedin', performedBy, bridge);
  emitKPI(performedBy, lead, lead.contactName, 'linkedin_actions', 'linkedin');
  emitCRMEvent('outreach.linkedin_sent', performedBy, `LinkedIn connect sent to ${lead.contactName} at ${lead.companyName}`, {
    leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
  });
  return { success: true, lead: updated, nextAction: updated.nextAction, message: `LinkedIn connect sent to ${lead.contactName} at ${lead.companyName}` };
}

/** Execute call completion — requires outcome */
export function executeCallComplete(
  lead: Lead,
  performedBy: string,
  bridge: StoreBridge,
  outcome: string,
  notes: string,
  callbackDate?: string,
): ExecutionResult {
  const label = `Call: ${outcome}`;
  let updated = executeCore(lead, label, 'phone', performedBy, bridge, notes);

  // Auto-create next task based on outcome
  const now = new Date().toISOString();
  let nextTask: DealTask | null = null;

  switch (outcome) {
    case 'interested':
      nextTask = {
        id: uid(), title: `Book meeting with ${lead.companyName}`,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        completed: false, assignedTo: lead.assignedTo, type: 'follow-up',
        autoGenerated: true, createdAt: now, priority: 'critical',
        reason: 'Lead interested — book meeting now',
      };
      break;
    case 'call-back-later':
      if (callbackDate) {
        nextTask = {
          id: uid(), title: `Call back ${lead.companyName}`,
          dueDate: new Date(callbackDate).toISOString(),
          completed: false, assignedTo: lead.assignedTo, type: 'follow-up',
          autoGenerated: true, createdAt: now, priority: 'high',
          reason: 'Callback from previous call',
        };
      }
      break;
    case 'no-answer':
      nextTask = {
        id: uid(), title: `Try ${lead.companyName} again — email or LinkedIn`,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        completed: false, assignedTo: lead.assignedTo, type: 'follow-up',
        autoGenerated: true, createdAt: now, priority: 'high',
        reason: 'No answer on call — switch channel',
      };
      break;
  }

  if (nextTask) {
    updated = { ...updated, tasks: [...(updated.tasks || []), nextTask] };
    bridge.saveCompany(updated);
  }

  emitKPI(performedBy, lead, lead.contactName, 'calls_made', 'call', outcome);
  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Call result added: ${outcome}` };
}

/** Execute meeting booking — auto-completes */
export function executeMeetingBooked(
  lead: Lead,
  performedBy: string,
  bridge: StoreBridge,
  meetingDate: string,
  meetingType: 'zoom' | 'google-meet' | 'teams' | 'other',
  meetingLink?: string,
): ExecutionResult {
  const now = new Date().toISOString();
  const meetingId = uid();

  // Create canonical meeting (used by Calendar)
  const canonicalMeeting = {
    meeting_id: meetingId,
    lead_id: lead.id,
    lead_key: lead.leadKey,
    owner: lead.assignedTo,
    source_flow: lead.entry_flow || 'sdr_manual',
    meeting_type: meetingType,
    meeting_source: 'sdr_booked' as const,
    scheduled_at: meetingDate,
    meeting_link: meetingLink || '',
    status: 'scheduled' as const,
    created_at: now,
    updated_at: now,
    sync_status: 'not_configured' as const,
  };

  // Legacy meetingNote (backward compat)
  const meetingNote = {
    id: meetingId, date: meetingDate, type: meetingType,
    link: meetingLink, summary: '', attendees: [lead.contactName], actionItems: ['Research brand + test product'],
  };
  const prepTask: DealTask = {
    id: uid(), title: `Prepare for meeting — ${lead.companyName}`,
    dueDate: new Date(new Date(meetingDate).getTime() - 86400000).toISOString(),
    completed: false, assignedTo: lead.assignedTo, type: 'meeting-prep',
    autoGenerated: true, createdAt: now, priority: 'high', reason: 'Prep for meeting',
    stageFamily: 'meeting',
  };

  // Archive stale tasks from previous stage
  const archivedTasks = archiveStaleTasksForStage(lead.tasks || [], 'meeting-booked');

  let updated: Lead = {
    ...lead,
    stage: 'meeting-booked',
    meeting_status: 'booked',
    updatedAt: now,
    lastContactedAt: now,
    nextFollowUp: meetingDate,
    meetings: [...(lead.meetings || []), canonicalMeeting],
    meetingNotes: [...(lead.meetingNotes || []), meetingNote],
    tasks: [...archivedTasks, prepTask],
  };

  const intel = recalculateNextAction(updated);
  updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

  // Log completion
  const completion: ActionCompletion = {
    id: uid(), action: 'Meeting booked', completedAt: now,
    completedBy: performedBy, channel: 'meeting',
  };
  updated.actionCompletions = [...(updated.actionCompletions || []), completion];

  bridge.saveCompany(updated);
  bridge.addActivity({ id: uid(), leadId: lead.id, type: 'meeting', description: `📅 Meeting booked with ${lead.contactName} at ${lead.companyName} on ${new Date(meetingDate).toLocaleDateString()}`, createdAt: now, createdBy: performedBy });
  emitKPI(performedBy, lead, lead.contactName, 'meetings_booked', 'meeting');
  emitCRMEvent('meeting.booked', performedBy, `Meeting booked with ${lead.contactName} at ${lead.companyName} on ${new Date(meetingDate).toLocaleDateString()}`, {
    leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
    nextStep: 'Prepare for meeting — research brand + test product',
  });

  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Meeting booked with ${lead.contactName} at ${lead.companyName} on ${new Date(meetingDate).toLocaleDateString()}` };
}

/** Execute trial approval — auto-completes, triggers next step */
export function executeTrialApproval(lead: Lead, performedBy: string, bridge: StoreBridge): ExecutionResult {
  const now = new Date().toISOString();
  let updated: Lead = { ...lead, approvedBy: performedBy, updatedAt: now };

  const completion: ActionCompletion = {
    id: uid(), action: 'Trial approved', completedAt: now,
    completedBy: performedBy, channel: 'system',
  };
  updated.actionCompletions = [...(updated.actionCompletions || []), completion];

  const intel = recalculateNextAction(updated);
  updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

  bridge.saveCompany(updated);
  bridge.addActivity({ id: uid(), leadId: lead.id, type: 'action-completed', description: `✓ Trial approved — ${lead.companyName}`, createdAt: now, createdBy: performedBy });

  const nextStep = hasValidCredentials(updated) ? 'Ready to activate trial' : 'Add credentials to proceed';
  return { success: true, lead: updated, nextAction: nextStep, message: `Approved: ${lead.companyName}` };
}

/** Execute credentials save — auto-completes, triggers trial activation */
export function executeCredentialsSave(
  lead: Lead,
  performedBy: string,
  bridge: StoreBridge,
  credentials: { username: string; password: string; loginUrl?: string; installationNotes?: string },
): ExecutionResult {
  const now = new Date().toISOString();
  let updated: Lead = {
    ...lead,
    credentials: { ...credentials, addedBy: performedBy, addedAt: now },
    credentialsAddedBy: performedBy,
    updatedAt: now,
  };

  const completion: ActionCompletion = {
    id: uid(), action: 'Credentials added', completedAt: now,
    completedBy: performedBy, channel: 'system',
  };
  updated.actionCompletions = [...(updated.actionCompletions || []), completion];

  const intel = recalculateNextAction(updated);
  updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

  bridge.saveCompany(updated);
  bridge.addActivity({ id: uid(), leadId: lead.id, type: 'action-completed', description: `✓ Credentials added — ${lead.companyName}`, createdAt: now, createdBy: performedBy });

  // Emit canonical event so all open pages re-derive buckets immediately.
  emitCRMEvent('credentials_added', performedBy, `Credentials added for ${lead.companyName}`, {
    leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
    nextStep: hasValidCredentials(updated) && updated.approvedBy ? 'Ready to activate trial' : 'Awaiting approval',
  });

  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Credentials saved for ${lead.companyName}` };
}

/**
 * ATOMIC trial setup — handles approval + credentials in ONE save cycle.
 * This is the ONLY function that should be called from TrialSetupDialog completion.
 * Prevents stale-read bugs where sequential saves overwrite each other.
 */
export function executeAtomicTrialSetup(
  lead: Lead,
  performedBy: string,
  bridge: StoreBridge,
  setup: { approved: boolean; credentials?: { username: string; password: string; loginUrl?: string; installationNotes?: string } },
): ExecutionResult {
  const now = new Date().toISOString();
  let updated: Lead = { ...lead, updatedAt: now };
  const completions: ActionCompletion[] = [...(updated.actionCompletions || [])];
  const activities: { desc: string }[] = [];

  // 1. Apply approval if needed
  if (setup.approved && !updated.approvedBy) {
    updated.approvedBy = performedBy;
    completions.push({
      id: uid(), action: 'Trial approved', completedAt: now,
      completedBy: performedBy, channel: 'system',
    });
    activities.push({ desc: `✓ Trial approved — ${lead.companyName}` });
  }

  // 2. Apply credentials if provided (on the SAME object, not a stale re-read)
  if (setup.credentials) {
    updated.credentials = { ...setup.credentials, addedBy: performedBy, addedAt: now };
    updated.credentialsAddedBy = performedBy;
    completions.push({
      id: uid(), action: 'Credentials added', completedAt: now,
      completedBy: performedBy, channel: 'system',
    });
    activities.push({ desc: `✓ Credentials added — ${lead.companyName}` });
  }

  updated.actionCompletions = completions;

  // 3. Recalculate next action ONCE with the fully-updated object
  const intel = recalculateNextAction(updated);
  updated = {
    ...updated,
    nextAction: intel.action,
    nextActionReason: intel.reason,
    nextActionUrgency: intel.urgency,
    nextFollowUp: intel.followUpDate,
  };

  // 4. ONE save — atomic, no stale reads
  bridge.saveCompany(updated);

  // 5. Log all activities
  activities.forEach(a => {
    bridge.addActivity({
      id: uid(), leadId: lead.id, type: 'action-completed',
      description: a.desc, createdAt: now, createdBy: performedBy,
    });
  });

  // 6. AUTO-ACTIVATION: if approval + credentials are now both present, start the trial.
  // The dialog CTA reads "Save & Start Trial" — honor that contract.
  const isReadyToStart = !!updated.approvedBy && hasValidCredentials(updated);
  if (isReadyToStart && updated.stage === 'trial-proposed') {
    const activation = executeTrialActivation(updated, performedBy, bridge, 14);
    if (activation.success) {
      return {
        success: true,
        lead: activation.lead,
        nextAction: activation.nextAction,
        message: `Trial started for ${lead.companyName}`,
      };
    }
  }

  const message = isReadyToStart
    ? `${lead.companyName} — ready to activate trial`
    : `Trial setup updated for ${lead.companyName}`;

  // Emit canonical event so Decisions / Trials / Tasks pages re-derive buckets.
  // (When auto-activation runs above, executeTrialActivation already emits its own event.)
  if (setup.approved && !lead.approvedBy) {
    emitCRMEvent('trial_approved', performedBy, `Trial approved for ${lead.companyName}`, {
      leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
      nextStep: isReadyToStart ? 'Ready to activate trial' : 'Awaiting credentials',
    });
  }
  if (setup.credentials) {
    emitCRMEvent('credentials_added', performedBy, `Credentials added for ${lead.companyName}`, {
      leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
      nextStep: isReadyToStart ? 'Ready to activate trial' : 'Awaiting approval',
    });
  }

  return { success: true, lead: updated, nextAction: updated.nextAction, message };
}

/**
 * TRIAL ACTIVATION — moves trial-proposed + ready_to_activate → trial-active.
 * Sets trial start/end dates and archives all setup tasks atomically.
 */
export function executeTrialActivation(
  lead: Lead,
  performedBy: string,
  bridge: StoreBridge,
  trialDays: number = 14,
): ExecutionResult {
  if (lead.stage !== 'trial-proposed') {
    return { success: false, lead, message: 'Cannot activate — not in Trial Proposed stage' };
  }
  if (!lead.approvedBy || !hasValidCredentials(lead)) {
    return { success: false, lead, message: 'Cannot activate — approval or credentials missing' };
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + trialDays * 86400000);
  const nowISO = now.toISOString();

  // Archive all setup tasks (using top-level import)
  let tasks = archiveStaleTasksForStage(lead.tasks || [], 'trial-active');

  // Add Day 2 onboarding check-in
  tasks = [...tasks, {
    id: uid(), title: `Day 2 check-in — ${lead.companyName}`,
    dueDate: new Date(now.getTime() + 2 * 86400000).toISOString(),
    completed: false, assignedTo: 'muneeb', type: 'check-in' as const,
    autoGenerated: true, createdAt: nowISO, priority: 'medium' as const,
    reason: 'Trial just started — check if client is using the product',
    stageFamily: 'trial',
  }];

  let updated: Lead = {
    ...lead,
    stage: 'trial-active',
    trialStartDate: nowISO,
    trialEndDate: endDate.toISOString(),
    updatedAt: nowISO,
    lastContactedAt: nowISO,
    tasks,
    actionCompletions: [
      ...(lead.actionCompletions || []),
      { id: uid(), action: 'Trial activated', completedAt: nowISO, completedBy: performedBy, channel: 'system' },
    ],
  };

  const intel = recalculateNextAction(updated);
  updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

  bridge.saveCompany(updated);
  bridge.addActivity({
    id: uid(), leadId: lead.id, type: 'action-completed',
    description: `Trial activated for ${lead.companyName} (${trialDays} days)`,
    createdAt: nowISO, createdBy: performedBy,
  });
  emitCRMEvent('trial_activated', performedBy, `Trial activated for ${lead.companyName} — ${trialDays} day trial starting now`, {
    leadId: lead.id, companyName: lead.companyName, contactName: lead.contactName,
    nextStep: 'Day 2 onboarding check-in scheduled',
  });

  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Trial activated for ${lead.companyName} — ${trialDays} day trial starting now` };
}

/** Execute skip — requires reason, logs to timeline */
export function executeSkip(lead: Lead, performedBy: string, bridge: StoreBridge, actionLabel: string, reason: string): ExecutionResult {
  const updated = executeCore(lead, `Skipped: ${actionLabel}`, 'system', performedBy, bridge, reason);
  bridge.addActivity({ id: uid(), leadId: lead.id, type: 'action-completed', description: `⏭ Skipped: ${actionLabel} — ${reason}`, createdAt: new Date().toISOString(), createdBy: performedBy });
  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Skipped: ${actionLabel}` };
}

/** Execute generic action completion (Done button for non-auto-completing actions) */
export function executeGenericComplete(lead: Lead, performedBy: string, bridge: StoreBridge, actionLabel: string): ExecutionResult {
  const updated = executeCore(lead, actionLabel, 'system', performedBy, bridge);
  return { success: true, lead: updated, nextAction: updated.nextAction, message: `Done: ${actionLabel}` };
}
