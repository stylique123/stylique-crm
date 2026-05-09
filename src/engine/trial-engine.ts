/**
 * COMPATIBILITY-ONLY (since the simplified internal CRM rebuild).
 *
 * Trials are no longer a first-class platform concept. The new active
 * model lives in `src/engine/commercial-state.ts`. This module is kept
 * for legacy consumers (CompanyDetailSheet, Pipeline trial setup dialog,
 * StepExecutionPanel) until they are migrated. Not used for new CRM flow.
 */
/**
 * STYLIQUE CRM — Trial Engine V3
 * 
 * Derives ALL trial state from the authoritative lifecycle engine.
 * No independent state calculation — delegates to getCompanyState.
 */

import type { Lead, DealTask } from '@/types/crm';
import { getTrialDaysLeft, hasValidCredentials, TEAM_MEMBERS } from '@/types/crm';
import { getCompanyState, getPageCounts, type CompanyState } from './lifecycle-engine';
import { getRoleForUser } from '@/lib/role';

// ═══════════════════════════════════════════════════════════
// CANONICAL TRIAL STATES — derived from lifecycle flags
// ═══════════════════════════════════════════════════════════

export type CanonicalTrialState =
  | 'setup-pending'
  | 'trial-ready'
  | 'trial-active'
  | 'ending-soon'
  | 'conversion-pending'
  | 'converted'
  | 'trial-lost';

export interface TrialStateInfo {
  state: CanonicalTrialState;
  label: string;
  color: string;
  urgency: 'normal' | 'warning' | 'critical';
}

/**
 * Derive trial display state from authoritative lifecycle engine.
 * This is a VIEW HELPER — not a source of truth.
 */
export function getCanonicalTrialState(lead: Lead): TrialStateInfo {
  const s = getCompanyState(lead);

  if (lead.stage === 'converted') return { state: 'converted', label: 'Converted', color: 'text-success', urgency: 'normal' };
  if (lead.stage === 'closed-lost') return { state: 'trial-lost', label: 'Lost', color: 'text-muted-foreground', urgency: 'normal' };
  if (lead.stage === 'payment-pending') return { state: 'conversion-pending', label: 'Conversion Pending', color: 'text-warning', urgency: 'warning' };

  if (lead.stage === 'trial-proposed') {
    if (s.trialSetupStatus === 'ready_to_activate') return { state: 'trial-ready', label: 'Ready to activate client', color: 'text-primary', urgency: 'normal' };
    // Use canonical trialSetupStatus for label
    const labelMap: Record<string, string> = {
      needs_approval: 'Needs approval',
      needs_credentials: 'Needs credentials',
      needs_approval_and_credentials: 'Needs approval + credentials',
    };
    return { state: 'setup-pending', label: labelMap[s.trialSetupStatus] || 'Setup pending', color: 'text-warning', urgency: 'warning' };
  }

  if (lead.stage === 'trial-active') {
    if (s.trialSetupStatus === 'ended') return { state: 'conversion-pending', label: 'Expired — convert now', color: 'text-destructive', urgency: 'critical' };
    if (s.trialSetupStatus === 'ending') return { state: 'ending-soon', label: `${s.trialDaysLeft}d left`, color: 'text-destructive', urgency: 'critical' };
    return { state: 'trial-active', label: 'Active client', color: 'text-success', urgency: 'normal' };
  }

  return { state: 'setup-pending', label: 'Proposed', color: 'text-muted-foreground', urgency: 'normal' };
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING STAGE LABEL — execution-grade single source of truth
// for the onboarding role. Replaces vague "Trial Proposed" with
// one of: Blocked: Approval needed, Blocked: Credentials missing,
// Ready to activate, Active: monitor, Check-in due, Usage review due,
// Ready for SDR handoff, Completed.
// ═══════════════════════════════════════════════════════════

export type OnboardingStageKey =
  | 'approval-blocked'
  | 'credentials-blocked'
  | 'ready-to-activate'
  | 'active-monitor'
  | 'check-in-due'
  | 'usage-review-due'
  | 'ready-for-handoff'
  | 'completed';

export interface OnboardingStageInfo {
  key: OnboardingStageKey;
  label: string;
  /** True when the blocker is OUTSIDE onboarding ownership — should be in WAITING bucket. */
  blocked: boolean;
  /** Who must act to unblock (only set when blocked=true). */
  blockedBy?: 'leadership' | 'sdr';
}

export function getOnboardingStage(lead: Lead): OnboardingStageInfo {
  const ts = getCanonicalTrialState(lead);
  const hasCreds = hasValidCredentials(lead);

  if (ts.state === 'converted') return { key: 'completed', label: 'Completed', blocked: false };
  if (ts.state === 'trial-lost') return { key: 'completed', label: 'Completed', blocked: false };

  if (ts.state === 'setup-pending') {
    if (!lead.approvedBy) return { key: 'approval-blocked', label: 'Blocked: Approval needed', blocked: true, blockedBy: 'leadership' };
    if (!hasCreds) return { key: 'credentials-blocked', label: 'Blocked: Credentials missing', blocked: true, blockedBy: 'leadership' };
    return { key: 'ready-to-activate', label: 'Ready to activate', blocked: false };
  }

  if (ts.state === 'trial-ready') return { key: 'ready-to-activate', label: 'Ready to activate', blocked: false };

  if (ts.state === 'trial-active') {
    const nextTask = getNextOnboardingTask(lead);
    if (nextTask) {
      const t = nextTask.title.toLowerCase();
      if (/check.?in/.test(t) || nextTask.type === 'check-in') return { key: 'check-in-due', label: 'Check-in due', blocked: false };
      if (/usage|review/.test(t)) return { key: 'usage-review-due', label: 'Usage review due', blocked: false };
    }
    return { key: 'active-monitor', label: 'Active: monitor', blocked: false };
  }

  if (ts.state === 'ending-soon' || ts.state === 'conversion-pending') {
    return { key: 'ready-for-handoff', label: 'Ready for SDR handoff', blocked: false };
  }

  return { key: 'active-monitor', label: 'Active: monitor', blocked: false };
}

// ═══════════════════════════════════════════════════════════
// TRIAL COUNTS — derived from authoritative PageCounts
// ═══════════════════════════════════════════════════════════

export interface TrialCounts {
  total: number;
  setupPending: number;
  readyToActivate: number;
  active: number;
  endingSoon: number;
  conversionPending: number;
}

export function getTrialCounts(leads: Lead[]): TrialCounts {
  const pc = getPageCounts(leads);
  return {
    total: pc.trialsTotal,
    setupPending: pc.trialsSetupPending,
    readyToActivate: pc.trialsReadyToActivate,
    active: pc.trialsActive,
    endingSoon: pc.trialsEndingSoon,
    conversionPending: pc.trialsExpired,
  };
}

// ═══════════════════════════════════════════════════════════
// ROLE-FILTERED TRIAL VIEWS
// ═══════════════════════════════════════════════════════════

export type TrialRole = 'sdr' | 'onboarding' | 'leadership';

export function getTrialRole(userId: string): TrialRole {
  // Thin alias over the unified role model. TrialRole collapses CEO+COO
  // into 'leadership' for trial-engine semantics; everything else 1:1.
  // New code should consume CRMRole from '@/lib/role' directly.
  const r = getRoleForUser(userId);
  if (r === 'ceo' || r === 'coo') return 'leadership';
  if (r === 'onboarding') return 'onboarding';
  return 'sdr';
}

export function getRoleTrialAction(lead: Lead, role: TrialRole): string {
  const ts = getCanonicalTrialState(lead);
  const daysLeft = getTrialDaysLeft(lead);

  switch (role) {
    case 'sdr':
      switch (ts.state) {
        case 'setup-pending': return 'Setup in progress — no SDR action';
        case 'trial-ready': return 'Onboarding starting — standby';
        case 'trial-active': return daysLeft !== null && daysLeft <= 5 ? `Decision due in ${daysLeft}d` : 'Active client';
        case 'ending-soon': return `Decision due in ${daysLeft}d`;
        case 'conversion-pending': return `Decision pending`;
        default: return 'No action needed';
      }
    case 'onboarding':
      switch (ts.state) {
        case 'setup-pending': {
          if (!lead.approvedBy) return 'Waiting for approval';
          if (!lead.credentials || !lead.credentials.username) return 'Waiting for credentials';
          return `Activate client — ${lead.companyName}`;
        }
        case 'trial-ready': return `Activate client — ${lead.companyName}`;
        case 'trial-active': {
          const nextTask = getNextOnboardingTask(lead);
          if (nextTask) {
            // Promote known onboarding task types into precise execution language.
            if (/check.?in/i.test(nextTask.type) || /check.?in/i.test(nextTask.title)) {
              return `Complete check-in — ${lead.companyName}`;
            }
            if (/usage|low usage|review/i.test(nextTask.title)) {
              return `Review usage — ${lead.companyName}`;
            }
            return nextTask.title;
          }
          return `Monitor onboarding — ${lead.companyName}`;
        }
        case 'ending-soon': return `Hand off to SDR — ${lead.companyName}`;
        case 'conversion-pending': return `Hand off to SDR — ${lead.companyName}`;
        default: return 'No action needed';
      }
    case 'leadership':
      switch (ts.state) {
        case 'setup-pending': {
          if (!lead.approvedBy) return 'Approve client review';
          return 'Setup in progress — credentials pending';
        }
        case 'trial-ready': return 'Ready to activate — will start soon';
        case 'trial-active': return daysLeft !== null && daysLeft <= 5 ? `Renewal due in ${daysLeft}d — monitor` : 'Active client';
        case 'ending-soon': return `Renewal decision due in ${daysLeft}d`;
        case 'conversion-pending': return 'Conversion pending';
        default: return 'No action needed';
      }
  }
}

export function getNextOnboardingTask(lead: Lead): DealTask | null {
  return (lead.tasks || [])
    .filter(t => !t.completed && t.state !== 'cancelled' && t.assignedTo === 'muneeb')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null;
}

export function getVisibleTrialTasks(lead: Lead, role: TrialRole, userId: string): DealTask[] {
  const tasks = (lead.tasks || []).filter(t => !t.completed && t.state !== 'cancelled');
  switch (role) {
    case 'sdr':
      return tasks.filter(t => t.assignedTo === userId && ['conversion-push', 'follow-up'].includes(t.type));
    case 'onboarding':
      return tasks.filter(t => t.assignedTo === 'muneeb' || ['onboarding', 'check-in'].includes(t.type));
    case 'leadership':
      return [];
  }
}

// ═══════════════════════════════════════════════════════════
// CREDENTIAL SECURITY
// Onboarding: view + reveal (audited), NO edit by default.
// Leadership: full access (view, reveal, edit).
// SDR: masked, no reveal, no edit.
// ═══════════════════════════════════════════════════════════

const CREDENTIAL_VISIBLE_ROLES: TrialRole[] = ['onboarding', 'leadership'];
const CREDENTIAL_EDIT_ROLES: TrialRole[] = ['leadership'];

export function canViewCredentials(role: TrialRole): boolean {
  return CREDENTIAL_VISIBLE_ROLES.includes(role);
}

export function canEditCredentials(role: TrialRole): boolean {
  return CREDENTIAL_EDIT_ROLES.includes(role);
}

export function maskCredentialValue(value: string, role: TrialRole): string {
  if (canViewCredentials(role)) return value;
  if (value.length <= 4) return '••••';
  return value.slice(0, 2) + '••••' + value.slice(-2);
}

// ═══════════════════════════════════════════════════════════
// PRIORITY SORTING
// ═══════════════════════════════════════════════════════════

const STATE_PRIORITY: Record<CanonicalTrialState, number> = {
  'conversion-pending': 0,
  'ending-soon': 1,
  'setup-pending': 2,
  'trial-ready': 3,
  'trial-active': 4,
  'converted': 6,
  'trial-lost': 7,
};

export function getTrialSortPriority(lead: Lead): number {
  const ts = getCanonicalTrialState(lead);
  return STATE_PRIORITY[ts.state] ?? 99;
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING OUTCOMES
// ═══════════════════════════════════════════════════════════

export interface OnboardingOutcome {
  value: string;
  label: string;
  description: string;
}

export const CHECK_IN_OUTCOMES: OnboardingOutcome[] = [
  { value: 'going-well', label: 'Going well', description: 'Client is actively using the product' },
  { value: 'needs-help', label: 'Needs help', description: 'Client has questions or issues' },
  { value: 'setup-incomplete', label: 'Setup incomplete', description: 'Account not fully set up yet' },
  { value: 'not-responsive', label: 'Not responsive', description: 'Client not replying to outreach' },
  { value: 'wants-guidance', label: 'Wants more guidance', description: 'Needs walkthrough or training' },
];

export const FEEDBACK_CALL_OUTCOMES: OnboardingOutcome[] = [
  { value: 'happy', label: 'Happy', description: 'Client satisfied with the product' },
  { value: 'confused', label: 'Confused', description: 'Needs more explanation or training' },
  { value: 'needs-support', label: 'Needs support', description: 'Technical or setup issues' },
  { value: 'wants-pricing', label: 'Pricing discussion', description: 'Ready to talk about plans' },
  { value: 'not-interested', label: 'Not interested', description: 'Unlikely to convert' },
];
