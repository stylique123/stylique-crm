/**
 * STYLIQUE CRM — Battle Hardening Module
 * 
 * Audit trail, stuck lead detection, stale task cleanup,
 * duplicate-submit protection, reconciliation support.
 */

import type { Lead, Activity, DealTask } from '@/types/crm';
import { getCanonicalState, type CanonicalState } from '@/engine/canonical-state';
import { archiveStaleTasksForStage } from '@/engine/task-engine';
import { getLeads } from '@/lib/store';

// ═══════════════════════════════════════════════════════════
// AUDIT TRAIL — immutable mutation log
// ═══════════════════════════════════════════════════════════

export interface AuditEntry {
  id: string;
  timestamp: string;
  leadId: string;
  triggeredBy: string;
  source: 'human' | 'system' | 'integration';
  mutation: string;
  oldState: { stage: string; owner: string; action_owner?: string };
  newState: { stage: string; owner: string; action_owner?: string };
  metadata?: Record<string, unknown>;
}

const AUDIT_KEY = 'stylique-crm-audit-log';
const MAX_AUDIT_ENTRIES = 1000;

export function appendAuditEntry(entry: AuditEntry): void {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    const log: AuditEntry[] = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(log.slice(0, MAX_AUDIT_ENTRIES)));
  } catch { /* fail silently */ }
}

export function getAuditLog(leadId?: string): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    const log: AuditEntry[] = raw ? JSON.parse(raw) : [];
    return leadId ? log.filter(e => e.leadId === leadId) : log;
  } catch { return []; }
}

/** Create audit entry from lead mutation */
export function createAuditEntry(
  oldLead: Lead,
  newLead: Lead,
  triggeredBy: string,
  mutation: string,
  source: AuditEntry['source'] = 'human',
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    leadId: newLead.id,
    triggeredBy,
    source,
    mutation,
    oldState: {
      stage: oldLead.stage,
      owner: oldLead.assignedTo || '',
      action_owner: oldLead.action_owner,
    },
    newState: {
      stage: newLead.stage,
      owner: newLead.assignedTo || '',
      action_owner: newLead.action_owner,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// DUPLICATE-SUBMIT PROTECTION
// ═══════════════════════════════════════════════════════════

const recentMutations = new Map<string, number>();
const DEDUPE_WINDOW_MS = 2000;

/**
 * Returns true if this mutation should be allowed.
 * Returns false if a duplicate was detected within the window.
 */
export function allowMutation(leadId: string, action: string): boolean {
  const key = `${leadId}:${action}`;
  const lastAt = recentMutations.get(key);
  const now = Date.now();
  if (lastAt && now - lastAt < DEDUPE_WINDOW_MS) {
    console.warn(`[Hardening] Duplicate submit blocked: ${key}`);
    return false;
  }
  recentMutations.set(key, now);
  // Cleanup old entries periodically
  if (recentMutations.size > 500) {
    for (const [k, v] of recentMutations) {
      if (now - v > DEDUPE_WINDOW_MS * 5) recentMutations.delete(k);
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════
// STUCK LEAD DETECTION
// ═══════════════════════════════════════════════════════════

export interface StuckLead {
  lead: Lead;
  state: CanonicalState;
  reason: string;
  daysSinceUpdate: number;
}

/**
 * Find leads that are stuck — no progress for too long
 * given their current lifecycle stage.
 */
export function detectStuckLeads(leads: Lead[]): StuckLead[] {
  const now = Date.now();
  const stuck: StuckLead[] = [];

  for (const lead of leads) {
    const state = getCanonicalState(lead);
    const daysSince = Math.floor((now - new Date(lead.updatedAt).getTime()) / 86400000);

    // Skip terminal states
    if (['closed', 'converted', 'lost', 'unsubscribed', 'cold_no_response'].includes(state.lifecycle_stage)) continue;

    // Prospecting stuck > 7 days
    if (state.lifecycle_stage === 'new_lead' && daysSince > 7) {
      stuck.push({ lead, state, reason: `New lead with no activity for ${daysSince}d`, daysSinceUpdate: daysSince });
      continue;
    }

    // Contacted but no reply > 10 days
    if (state.lifecycle_stage === 'contacted' && daysSince > 10) {
      stuck.push({ lead, state, reason: `Contacted but no progress for ${daysSince}d`, daysSinceUpdate: daysSince });
      continue;
    }

    // Meeting booked but not completed > 5 days past meeting
    if (state.lifecycle_stage === 'meeting_booked') {
      const lastMeeting = lead.meetingNotes?.[lead.meetingNotes.length - 1];
      if (lastMeeting && new Date(lastMeeting.date).getTime() < now - 5 * 86400000) {
        stuck.push({ lead, state, reason: 'Meeting date passed 5+ days ago — no outcome added', daysSinceUpdate: daysSince });
        continue;
      }
    }

    // Client Review waiting too long.
    if (state.lifecycle_stage === 'trial_proposed' && daysSince > 5) {
      stuck.push({ lead, state, reason: `Client Review ${daysSince}d old`, daysSinceUpdate: daysSince });
      continue;
    }

    // Payment pending > 7 days
    if (state.lifecycle_stage === 'conversion_pending' && daysSince > 7) {
      stuck.push({ lead, state, reason: `Decision pending ${daysSince}d`, daysSinceUpdate: daysSince });
      continue;
    }

    // Generic stuck: any lead with no update > 14 days
    if (daysSince > 14 && state.next_required_action !== 'no_action') {
      stuck.push({ lead, state, reason: `No activity for ${daysSince}d`, daysSinceUpdate: daysSince });
    }
  }

  return stuck.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
}

// ═══════════════════════════════════════════════════════════
// STALE TASK AUTO-ARCHIVAL — periodic cleanup
// ═══════════════════════════════════════════════════════════

/**
 * Run periodic stale task cleanup across all leads.
 * Archives auto-generated tasks that don't match current stage.
 * Returns list of affected lead IDs.
 */
export function cleanupStaleTasks(
  leads: Lead[],
  saveFn: (lead: Lead) => void,
): string[] {
  const affected: string[] = [];

  for (const lead of leads) {
    const activeTasks = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled');
    if (activeTasks.length === 0) continue;

    const cleaned = archiveStaleTasksForStage(lead.tasks || [], lead.stage);
    const wasChanged = cleaned.some((t, i) => t.state !== (lead.tasks || [])[i]?.state);

    if (wasChanged) {
      saveFn({ ...lead, tasks: cleaned, updatedAt: new Date().toISOString() });
      affected.push(lead.id);
    }
  }

  return affected;
}

// ═══════════════════════════════════════════════════════════
// RECONCILIATION — hourly consistency check
// ═══════════════════════════════════════════════════════════

export interface ReconciliationResult {
  timestamp: string;
  totalLeads: number;
  stuckLeads: number;
  staleTasksCleaned: number;
  orphanedTasks: number;
  syncDegraded: number;
}

/**
 * Run full reconciliation across all leads.
 * Detects stuck leads, cleans stale tasks, finds sync issues.
 */
export function runReconciliation(
  leads: Lead[],
  saveFn: (lead: Lead) => void,
): ReconciliationResult {
  const stuck = detectStuckLeads(leads);
  const cleaned = cleanupStaleTasks(leads, saveFn);

  // Count orphaned tasks (tasks for stages the lead has moved past)
  let orphaned = 0;
  for (const lead of leads) {
    const active = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled');
    // Check for tasks with no valid assignee
    orphaned += active.filter(t => t.assignedTo && !t.assignedTo.trim()).length;
  }

  // Count sync-degraded leads
  const syncDegraded = leads.filter(l => l.sync_status === 'failed' || l.sync_status === 'pending').length;

  return {
    timestamp: new Date().toISOString(),
    totalLeads: leads.length,
    stuckLeads: stuck.length,
    staleTasksCleaned: cleaned.length,
    orphanedTasks: orphaned,
    syncDegraded,
  };
}

// ═══════════════════════════════════════════════════════════
// OWNERSHIP VALIDATION — prevent wrong-role actions
// ═══════════════════════════════════════════════════════════

/**
 * Validate that the current user CAN perform the given action on this lead.
 * Returns { allowed, reason } for gating UI and blocking mutations.
 */
export function validateOwnership(
  lead: Lead,
  userId: string,
  userRole: 'sdr' | 'onboarding' | 'ceo' | 'coo',
  action: string,
): { allowed: boolean; reason?: string } {
  const state = getCanonicalState(lead);

  // Leadership can always override
  if (userRole === 'ceo' || userRole === 'coo') {
    return { allowed: true };
  }

  // Onboarding: can only act when next action owner is onboarding
  if (userRole === 'onboarding') {
    if (state.next_action_owner_role !== 'onboarding') {
      return { allowed: false, reason: `Action owned by ${state.next_action_owner_role}` };
    }
    return { allowed: true };
  }

  // SDR: must be assigned AND next action must be SDR-owned
  if (userRole === 'sdr') {
    const isAssigned = lead.assignedTo === userId || lead.assigned_sdr === userId;
    if (!isAssigned) {
      return { allowed: false, reason: 'Not assigned to you' };
    }
    if (state.next_action_owner_role !== 'sdr' && state.next_action_owner_role !== 'none') {
      return { allowed: false, reason: `Action owned by ${state.next_action_owner_role}` };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Unknown role' };
}

// ═══════════════════════════════════════════════════════════
// ONE ACTIVE NEXT ACTION — ensure no competing truths
// ═══════════════════════════════════════════════════════════

/**
 * Ensure a lead has exactly one non-completed active task.
 * If multiple auto-generated tasks exist for the same type,
 * keep only the most recent and archive the rest.
 */
export function deduplicateActiveTasks(lead: Lead): Lead {
  const tasks = lead.tasks || [];
  const active = tasks.filter(t => !t.completed && t.state !== 'cancelled' && t.autoGenerated);
  
  // Group by type
  const byType = new Map<string, DealTask[]>();
  for (const t of active) {
    const existing = byType.get(t.type) || [];
    existing.push(t);
    byType.set(t.type, existing);
  }

  const now = new Date().toISOString();
  const toCancel = new Set<string>();

  for (const [, group] of byType) {
    if (group.length <= 1) continue;
    // Keep the newest, cancel the rest
    const sorted = group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (let i = 1; i < sorted.length; i++) {
      toCancel.add(sorted[i].id);
    }
  }

  if (toCancel.size === 0) return lead;

  return {
    ...lead,
    tasks: tasks.map(t =>
      toCancel.has(t.id)
        ? { ...t, completed: true, state: 'cancelled' as const, cancelledAt: now, cancelReason: 'Deduplicated — newer task exists' }
        : t
    ),
  };
}
