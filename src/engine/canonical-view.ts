/**
 * STYLIQUE CRM — Canonical Lead View (single adapter)
 *
 * COMPATIBILITY-ONLY (since the simplified internal CRM rebuild).
 * The first-class commercial/client state model lives in
 * `src/engine/commercial-state.ts` and is what the active product pages
 * (Dashboard, Conversions, Payments, OnboardingClients) consume now.
 *
 * This adapter is retained to keep CompanyDetailSheet, LeadershipActionPanel,
 * StepExecutionPanel, and DecisionsPage working until they are migrated.
 * Not used for new CRM flow. Safe to remove after those consumers migrate.
 *
 * THE one object every page/component should consume to interpret a lead.
 *
 * It wraps the existing focused engines (canonical-state, post-trial,
 * billing-state, trial-engine) and exposes:
 *   - normalized lifecycle / trial / billing / conversion / ended buckets
 *   - the next required action + owner role
 *   - role visibility flags (can this role even see this record on this page?)
 *   - permission flags (can this role take this action right now?)
 *
 * Pages MUST NOT re-derive these. If a page needs a new fact about a lead,
 * add it here and consume it everywhere.
 */

import type { Lead } from '@/types/crm';
import type { CRMRole } from '@/lib/role';
import {
  getCanonicalState,
  type CanonicalState,
  type OwnerRole,
} from '@/engine/canonical-state';
import {
  getLifecycleBucket,
  getGraceDaysLeft,
  isInTrialsPageScope,
  isInConversionsPageScope,
  isInEndedPageScope,
  isCountedAsConversion,
  type LifecycleBucket,
} from '@/engine/post-trial';
import {
  getBillingState,
  isPaymentDecision,
  isPaymentRisk,
  type BillingState,
} from '@/engine/billing-state';
import { hasValidCredentials, getTrialDaysLeft } from '@/types/crm';

// ─── Display state for action panels (replaces legacy DecisionState) ──

/**
 * Visible action-panel state derived purely from the canonical view.
 * This is the single source of truth for what the LeadershipActionPanel
 * and StepExecutionPanel render. It must NOT be derived from raw lead.stage
 * anywhere else.
 */
export type CanonicalUrgency = 'critical' | 'action-needed' | 'on-track' | 'waiting';
export type CanonicalActionType =
  | 'call' | 'email' | 'linkedin' | 'meeting'
  | 'setup' | 'payment' | 'confirm' | 'review' | 'none';

export interface CanonicalDisplayState {
  summary: string;
  nextAction: string;
  reason: string;
  urgency: CanonicalUrgency;
  actionType: CanonicalActionType;
}

function classifyActionType(view: CanonicalLeadView): CanonicalActionType {
  const { bucket, billing, nextActionLabel } = view;
  if (view.permissions.canConfirmPayment) return 'payment';
  if (view.permissions.canApproveTrial) return 'confirm';
  if (view.permissions.canActivateTrial) return 'confirm';
  if (bucket === 'trial_pending_approval' || bucket === 'trial_ready_to_start_blocked') return 'setup';
  if (billing === 'awaiting_confirmation' || billing === 'overdue' || billing === 'awaiting_payment') return 'payment';
  if (bucket === 'trial_active' || bucket === 'trial_ending_soon' || bucket === 'trial_ended_awaiting') return 'review';
  // Fallback: infer from next-action label keywords (no raw stage access).
  const label = (nextActionLabel || '').toLowerCase();
  if (label.includes('call')) return 'call';
  if (label.includes('email') || label.includes('reply')) return 'email';
  if (label.includes('linkedin')) return 'linkedin';
  if (label.includes('meeting') || label.includes('book')) return 'meeting';
  if (view.nextActionOwnerRole === 'none') return 'none';
  return 'review';
}

function classifyUrgency(view: CanonicalLeadView): CanonicalUrgency {
  const { bucket, billing, trialDaysLeft, graceDaysLeft } = view;
  if (billing === 'overdue') return 'critical';
  if (bucket === 'trial_ended_awaiting') return 'critical';
  if (bucket === 'trial_ending_soon' || (trialDaysLeft !== null && trialDaysLeft <= 2)) return 'critical';
  if (view.permissions.canConfirmPayment) return 'action-needed';
  if (view.permissions.canApproveTrial) return 'action-needed';
  if (view.permissions.canActivateTrial) return 'action-needed';
  if (bucket === 'trial_pending_approval' || bucket === 'trial_ready_to_start_blocked') return 'action-needed';
  if (graceDaysLeft !== null && graceDaysLeft <= 2) return 'action-needed';
  if (view.nextActionOwnerRole === 'none') return 'waiting';
  return 'on-track';
}

function buildSummary(view: CanonicalLeadView): string {
  const { bucket, lead, trialDaysLeft, billing } = view;
  if (billing === 'overdue') return `Payment overdue — ${lead.companyName}`;
  if (billing === 'awaiting_confirmation') return `Payment proof submitted — confirm`;
  if (billing === 'awaiting_payment') return `Awaiting payment from ${lead.contactName}`;
  if (bucket === 'trial_active' && trialDaysLeft !== null) return `Onboarding active — ${trialDaysLeft}d left`;
  if (bucket === 'trial_ending_soon' && trialDaysLeft !== null) return `Decision due in ${trialDaysLeft}d`;
  if (bucket === 'trial_ended_awaiting') return `Decision pending`;
  if (bucket === 'trial_pending_approval') return `Client Review`;
  if (bucket === 'trial_ready_to_start_blocked') return `Credentials missing`;
  if (bucket === 'trial_ready_to_start') return `Onboarding queue`;
  return view.state.next_action_label || lead.companyName;
}

function buildReason(view: CanonicalLeadView): string {
  if (view.permissions.canConfirmPayment) return 'Payment proof submitted — leadership confirmation required';
  if (view.permissions.canApproveTrial) return 'Approval required';
  if (view.permissions.canActivateTrial) return 'Approved + credentials ready';
  if (view.onboardingBlocker?.kind === 'awaiting_credentials') return 'Credentials missing';
  if (view.onboardingBlocker?.kind === 'awaiting_approval') return 'Awaiting leadership approval';
  if (view.onboardingBlocker?.kind === 'awaiting_sdr_handoff') return 'Decision pending';
  if (view.nextActionOwnerRole === 'none') return '';
  return `With ${view.nextActionOwnerRole}`;
}

/**
 * THE display adapter for action panels. Pages MUST pass this (or the view
 * itself) to LeadershipActionPanel / StepExecutionPanel. Do not reach into
 * decision-engine for visible meaning.
 */
export function getCanonicalDisplayState(view: CanonicalLeadView): CanonicalDisplayState {
  return {
    summary: buildSummary(view),
    nextAction: view.nextActionLabel || 'No action required',
    reason: buildReason(view),
    urgency: classifyUrgency(view),
    actionType: classifyActionType(view),
  };
}

// ─── Permission flags ─────────────────────────────────────────────

export interface CanonicalPermissions {
  canApproveTrial: boolean;
  canConfirmPayment: boolean;
  canViewCredentials: boolean;
  canEditCredentials: boolean;
  canActivateTrial: boolean;
  canStartOutreach: boolean;
  canLogCheckIn: boolean;
  canHandOff: boolean;
}

// ─── Page visibility flags ────────────────────────────────────────

export interface CanonicalPageVisibility {
  canAppearInTrials: boolean;
  canAppearInConversions: boolean;
  canAppearInEnded: boolean;
  canAppearInClients: boolean;
  canAppearInDecisions: boolean;
  canAppearInRisks: boolean;
}

// ─── Onboarding blocker ───────────────────────────────────────────

export type OnboardingBlocker =
  | { kind: 'awaiting_approval'; resolvedBy: 'leadership' }
  | { kind: 'awaiting_credentials'; resolvedBy: 'leadership' }
  | { kind: 'awaiting_sdr_handoff'; resolvedBy: 'sdr' }
  | null;

// ─── Final canonical view ─────────────────────────────────────────

export interface CanonicalLeadView {
  /** raw lead reference */
  lead: Lead;

  /** focused engine outputs (already canonical) */
  state: CanonicalState;
  bucket: LifecycleBucket;
  billing: BillingState;

  /** business meanings */
  isConverted: boolean;
  isEnded: boolean;
  isPaymentDecision: boolean;
  isPaymentRisk: boolean;
  onboardingBlocker: OnboardingBlocker;

  /** ownership */
  currentOwnerRole: OwnerRole;
  nextActionOwnerRole: OwnerRole;
  nextActionLabel: string;

  /** numeric facts for UI */
  trialDaysLeft: number | null;
  graceDaysLeft: number | null;

  /** page visibility (single source of truth for which page a record is on) */
  pages: CanonicalPageVisibility;

  /** permissions for the viewer */
  permissions: CanonicalPermissions;
}

// ─── Role-permission matrix (the only place this is decided) ──────

function derivePermissions(
  lead: Lead,
  state: CanonicalState,
  bucket: LifecycleBucket,
  billing: BillingState,
  viewerRole: CRMRole,
  viewerUser: string,
): CanonicalPermissions {
  const isLeadership = viewerRole === 'ceo' || viewerRole === 'coo';
  const isOnboarding = viewerRole === 'onboarding';
  const isSdr = viewerRole === 'sdr';
  const isAssignedSdr = !!lead.assignedTo && lead.assignedTo === viewerUser;
  const hasCreds = hasValidCredentials(lead);

  return {
    // Approve trial — ONLY leadership, ONLY when pending approval.
    canApproveTrial: isLeadership && bucket === 'trial_pending_approval',

    // Confirm payment — ONLY leadership, ONLY when proof submitted.
    canConfirmPayment: isLeadership && billing === 'awaiting_confirmation',

    // View credentials — onboarding + leadership.
    canViewCredentials: isLeadership || isOnboarding,

    // Edit credentials — leadership ONLY. Onboarding is hard-blocked.
    canEditCredentials: isLeadership,

    // Activate trial — onboarding ONLY (leadership cannot click activate),
    // and only when both approval + creds are in place.
    canActivateTrial:
      isOnboarding && bucket === 'trial_ready_to_start' && hasCreds && !!lead.approvedBy,

    // Start outreach — assigned SDR only.
    canStartOutreach: isSdr && isAssignedSdr,

    // Log check-in — onboarding only, on active trials.
    canLogCheckIn: isOnboarding && (bucket === 'trial_active' || bucket === 'trial_ending_soon'),

    // Hand off to SDR — onboarding only, when trial is ending/ended.
    canHandOff:
      isOnboarding &&
      (bucket === 'trial_ending_soon' || bucket === 'trial_ended_awaiting'),
  };
}

function derivePageVisibility(
  lead: Lead,
  bucket: LifecycleBucket,
  billing: BillingState,
): CanonicalPageVisibility {
  return {
    canAppearInTrials: isInTrialsPageScope(lead),
    canAppearInConversions: isInConversionsPageScope(lead),
    canAppearInEnded: isInEndedPageScope(lead),
    canAppearInClients: isCountedAsConversion(lead),
    // Decisions = only items leadership must act on.
    canAppearInDecisions:
      bucket === 'trial_pending_approval' || billing === 'awaiting_confirmation',
    // Risks = handled by leadership-risk-engine; flag here is a hint only.
    canAppearInRisks: billing === 'overdue' || bucket === 'trial_ready_to_start_blocked',
  };
}

function deriveOnboardingBlocker(
  lead: Lead,
  bucket: LifecycleBucket,
): OnboardingBlocker {
  if (bucket === 'trial_pending_approval') {
    return { kind: 'awaiting_approval', resolvedBy: 'leadership' };
  }
  if (bucket === 'trial_ready_to_start_blocked') {
    return { kind: 'awaiting_credentials', resolvedBy: 'leadership' };
  }
  if (bucket === 'trial_ended_awaiting') {
    return { kind: 'awaiting_sdr_handoff', resolvedBy: 'sdr' };
  }
  return null;
}

/**
 * THE function. Pages call this and read every fact from the result.
 *
 * `viewerRole` + `viewerUser` are required so permissions can be evaluated
 * once at the source. Pass them from useUser().
 */
export function getCanonicalLeadView(
  lead: Lead,
  viewerRole: CRMRole,
  viewerUser: string,
): CanonicalLeadView {
  const state = getCanonicalState(lead);
  const bucket = getLifecycleBucket(lead);
  const billing = getBillingState(lead);

  return {
    lead,
    state,
    bucket,
    billing,

    isConverted: isCountedAsConversion(lead),
    isEnded: isInEndedPageScope(lead),
    isPaymentDecision: isPaymentDecision(lead),
    isPaymentRisk: isPaymentRisk(lead),
    onboardingBlocker: deriveOnboardingBlocker(lead, bucket),

    currentOwnerRole: state.current_owner_role,
    nextActionOwnerRole: state.next_action_owner_role,
    nextActionLabel: state.next_action_label,

    trialDaysLeft: getTrialDaysLeft(lead),
    graceDaysLeft: getGraceDaysLeft(lead),

    pages: derivePageVisibility(lead, bucket, billing),
    permissions: derivePermissions(lead, state, bucket, billing, viewerRole, viewerUser),
  };
}

/** Build views for a list — pass once, share across child components. */
export function getCanonicalLeadViews(
  leads: Lead[],
  viewerRole: CRMRole,
  viewerUser: string,
): CanonicalLeadView[] {
  return leads.map(l => getCanonicalLeadView(l, viewerRole, viewerUser));
}
