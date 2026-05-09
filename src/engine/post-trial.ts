/**
 * STYLIQUE CRM — Post-Trial Lifecycle Layer
 *
 * COMPATIBILITY-ONLY (since the simplified internal CRM rebuild).
 * The new authoritative state model lives in `src/engine/commercial-state.ts`
 * and is consumed by Dashboard, Conversions, Payments and OnboardingClients.
 *
 * This file is retained only because Pipeline, Tasks, and the company detail
 * drawer still depend on the legacy buckets while their internal rendering
 * is migrated. It MUST NOT be added as a new dependency. Safe to remove
 * once the remaining pages stop importing `getLifecycleBucket` /
 * `BUCKET_LABELS` / `getCanonicalLeadView`.
 *
 * Derived state. Sits on top of existing stages (no enum churn).
 * Splits the post-trial-end zone into clean buckets so Trials, Conversions,
 * and Ended pages never overlap.
 *
 * Buckets:
 *  • trial_pending_approval     trial-proposed + !approvedBy
 *  • trial_ready_to_start       trial-proposed + approvedBy + creds
 *  • trial_active               trial-active   + days left > 0
 *  • trial_ending_soon          trial-active   + 0 < days left <= 5
 *  • trial_ended_awaiting       trial-active expired OR payment-pending
 *                               WITHOUT explicit decision yet (within grace)
 *  • payment_window_open        explicit "continuing" OR payment-pending
 *                               within grace, paymentStatus !== paid
 *  • converted                  paymentStatus === paid (KPI conversion)
 *  • ended_no_response          past grace, no decision, not paid
 *  • ended_declined             postTrialDecision === 'declined' OR closed-lost
 *                               originating from a trial
 *  • closed                     archived after final outcome
 *
 * GRACE WINDOW = 7 days from trial end.
 *
 * KPI rule (locked): a "conversion" only counts when paymentStatus === 'paid'.
 *
 * Pages:
 *  • Trials page    → trial_pending_approval, trial_ready_to_start,
 *                     trial_active, trial_ending_soon, trial_ended_awaiting
 *  • Conversions    → converted (Active) + payment_window_open (Awaiting Payment)
 *  • Ended / Lost   → ended_no_response, ended_declined, closed (trial-origin)
 */

import type { Lead } from '@/types/crm';
import { getTrialDaysLeft, hasValidCredentials } from '@/types/crm';

export const POST_TRIAL_GRACE_DAYS = 7;

export type LifecycleBucket =
  | 'trial_pending_approval'
  | 'trial_ready_to_start'
  | 'trial_ready_to_start_blocked'
  | 'trial_active'
  | 'trial_ending_soon'
  | 'trial_ended_awaiting'
  | 'payment_window_open'
  | 'converted'
  | 'ended_no_response'
  | 'ended_declined'
  | 'closed'
  | 'not_in_lifecycle';

export type PostTrialDecision =
  | 'continuing'      // client agreed to continue — moves to payment_window_open
  | 'declined'        // client said no — moves to ended_declined
  | 'extend'          // trial extended — stays trial_active (with new dates)
  | undefined;

/** Days since trial ended (negative if still in trial). null if no trial. */
export function getDaysSinceTrialEnd(lead: Lead): number | null {
  if (!lead.trialEndDate) return null;
  return Math.floor((Date.now() - new Date(lead.trialEndDate).getTime()) / 86400000);
}

/** Days remaining in the post-trial decision window. null if not applicable. */
export function getGraceDaysLeft(lead: Lead): number | null {
  const sinceEnd = getDaysSinceTrialEnd(lead);
  if (sinceEnd === null || sinceEnd < 0) return null;
  return Math.max(0, POST_TRIAL_GRACE_DAYS - sinceEnd);
}

/** Single source of truth for which bucket a lead belongs to right now. */
export function getLifecycleBucket(lead: Lead): LifecycleBucket {
  // Closed-lost as final state — split by origin (trial vs. cold)
  if (lead.stage === 'closed-lost') {
    if (lead.postTrialDecision === 'declined' || lead.trialEndDate) return 'ended_declined';
    return 'closed';
  }

  // Trial proposed → approval / setup
  if (lead.stage === 'trial-proposed') {
    if (!lead.approvedBy) return 'trial_pending_approval';
    // Approved but credentials missing → unified blocked state (NOT pending approval).
    if (!hasValidCredentials(lead)) return 'trial_ready_to_start_blocked';
    return 'trial_ready_to_start';
  }

  // Active trial → still running OR ended (auto-derived)
  if (lead.stage === 'trial-active') {
    const dl = getTrialDaysLeft(lead);
    if (dl !== null && dl > 5) return 'trial_active';
    if (dl !== null && dl > 0) return 'trial_ending_soon';
    // Trial expired — derive post-trial bucket
    return derivePostTrialBucket(lead);
  }

  // Payment-pending = post-trial commercial state
  if (lead.stage === 'payment-pending') {
    return derivePostTrialBucket(lead);
  }

  // Converted lifecycle stage
  if (lead.stage === 'converted') {
    if (lead.paymentStatus === 'paid') return 'converted';
    // Converted record but unpaid → still in payment window
    return 'payment_window_open';
  }

  return 'not_in_lifecycle';
}

function derivePostTrialBucket(lead: Lead): LifecycleBucket {
  // Paid takes precedence — full conversion
  if (lead.paymentStatus === 'paid') return 'converted';

  const decision = lead.postTrialDecision;
  const graceLeft = getGraceDaysLeft(lead);

  if (decision === 'declined') return 'ended_declined';

  if (decision === 'continuing') {
    return 'payment_window_open';
  }

  // No decision yet
  if (graceLeft !== null && graceLeft > 0) {
    return 'trial_ended_awaiting';
  }

  // Past grace + no decision + unpaid = ended without response
  return 'ended_no_response';
}

// ─── Page-scope helpers ─────────────────────────────────────

/** Trials page: only true in-flight or post-trial-awaiting records. */
export function isInTrialsPageScope(lead: Lead): boolean {
  const b = getLifecycleBucket(lead);
  return (
    b === 'trial_pending_approval' ||
    b === 'trial_ready_to_start' ||
    b === 'trial_ready_to_start_blocked' ||
    b === 'trial_active' ||
    b === 'trial_ending_soon' ||
    b === 'trial_ended_awaiting'
  );
}

/** Conversions page: only true paid clients + awaiting-payment continuations. */
export function isInConversionsPageScope(lead: Lead): boolean {
  const b = getLifecycleBucket(lead);
  return b === 'converted' || b === 'payment_window_open';
}

/** Ended / Lost page: trials that did not convert. */
export function isInEndedPageScope(lead: Lead): boolean {
  const b = getLifecycleBucket(lead);
  return b === 'ended_no_response' || b === 'ended_declined' || (b === 'closed' && !!lead.trialEndDate);
}

/** KPI rule: only paid conversions count. */
export function isCountedAsConversion(lead: Lead): boolean {
  return getLifecycleBucket(lead) === 'converted' && lead.paymentStatus === 'paid';
}

// ─── Labels ─────────────────────────────────────────────────

export const BUCKET_LABELS: Record<LifecycleBucket, string> = {
  trial_pending_approval: 'Client review — pending approval',
  trial_ready_to_start: 'Onboarding — ready to start',
  trial_ready_to_start_blocked: 'Onboarding — blocked by missing credentials',
  trial_active: 'Active client — onboarding window',
  trial_ending_soon: 'Active client — renewal due soon',
  trial_ended_awaiting: 'Active client — awaiting decision',
  payment_window_open: 'Awaiting payment',
  converted: 'Active client',
  ended_no_response: 'Ended — no response',
  ended_declined: 'Ended — declined',
  closed: 'Closed',
  not_in_lifecycle: '',
};
