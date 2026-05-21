/**
 * STYLIQUE CRM — Commercial / Client State (first-class)
 *
 * The new authoritative state model for the simplified internal CRM.
 *
 *   Commercial flow:
 *     new_lead -> contacted -> replied -> meeting_booked
 *                          -> client_review -> closed_lost
 *
 *   Client flow:
 *     awaiting_payment → paid → onboarding_pending
 *                              → onboarding_done → active_client
 *                              → payment_due_soon → overdue → closed
 *
 * This module derives a single `CommercialState` value per lead that the
 * active product pages (Dashboard, Approvals, Clients,
 * OnboardingClients) use directly. It does NOT route through the legacy
 * trial buckets (canonical-view / post-trial / trial-engine), which are
 * now compatibility-only.
 */

import type { Lead } from '@/types/crm';
import { getPaymentDaysUntilDue } from '@/types/crm';

// ─── First-class states ─────────────────────────────────────────

export type CommercialState =
  // Commercial / pre-client
  | 'new_lead'
  | 'contacted'
  | 'replied'
  | 'meeting_booked'
  | 'conversion_pending'
  | 'closed_lost'
  // Client lifecycle
  | 'client_review'
  | 'onboarding_pending'
  | 'pilot'
  | 'contract'
  | 'active_client'
  | 'payment_due_soon'
  | 'overdue'
  | 'closed';

export const COMMERCIAL_LABEL: Record<CommercialState, string> = {
  new_lead: 'New Lead',
  contacted: 'Contacted',
  replied: 'Replied',
  meeting_booked: 'Meeting Scheduled',
  conversion_pending: 'Client Review',
  closed_lost: 'Closed Lost',
  client_review: 'Client Review',
  onboarding_pending: 'Onboarding Pending',
  pilot: 'Pilot',
  contract: 'Active Client',
  active_client: 'Active Client',
  payment_due_soon: 'Due Soon',
  overdue: 'Overdue',
  closed: 'Closed',
};

const PAYMENT_DUE_SOON_DAYS = 5;

/**
 * Derive the first-class commercial/client state from a lead.
 *
 * Stage strings on the underlying Lead may still include legacy values
 * (trial-proposed, trial-active, internal-decision, pricing-discussion).
 * These are mapped here as compatibility-only inputs into the new model:
 *   - trial-proposed / payment-pending → client_review
 *   - trial-active                     → pilot
 *   - converted                        → active client
 * The legacy trial strings do NOT remain visible in the product copy.
 */
export function getCommercialState(lead: Lead): CommercialState {
  const stage = lead.stage;

  // Final / closed states first.
  if (stage === 'closed-lost') return 'closed_lost';

  // Overdue is only a contract/recurring-client state.
  if (lead.paymentStatus === 'overdue') {
    if (stage === 'converted' || lead.contractSignedAt) return 'overdue';
    if (stage === 'trial-active') return 'pilot';
    return 'client_review';
  }

  if (stage === 'converted') {
    const days = getPaymentDaysUntilDue(lead);
    if (days !== null && days < 0) return 'overdue';
    if (days !== null && days >= 0 && days <= PAYMENT_DUE_SOON_DAYS) return 'payment_due_soon';
    return 'active_client';
  }

  if (stage === 'trial-active') {
    return 'pilot';
  }

  if (stage === 'trial-proposed' || stage === 'payment-pending') {
    if (lead.paymentStatus === 'paid' && hasReadyCredentials(lead) && !lead.onboardingDoneAt) return 'onboarding_pending';
    return 'client_review';
  }

  if (stage === 'meeting-completed' || stage === 'internal-decision' || stage === 'pricing-discussion') {
    return 'conversion_pending';
  }

  if (stage === 'meeting-booked') return 'meeting_booked';
  if (stage === 'sdr-replied' || stage === 'replied') return 'replied';

  // New lead family.
  const newLeadStages = new Set([
    'sdr-new-lead', 'new-lead', 'lead-added', 'inbound-new', 'new-inquiry',
    'ai-new-lead', 'pending-enrichment', 'pending-apollo', 'ready-for-outreach',
  ]);
  if (newLeadStages.has(stage)) return 'new_lead';

  // Everything else from the contacted family.
  return 'contacted';
}

/** Coarse phase: commercial vs client. Useful for page bucketing. */
export type CommercialPhase = 'commercial' | 'client' | 'lost';
export function getCommercialPhase(state: CommercialState): CommercialPhase {
  switch (state) {
    case 'closed_lost':
      return 'lost';
    case 'client_review':
    case 'onboarding_pending':
    case 'pilot':
    case 'active_client':
    case 'payment_due_soon':
    case 'overdue':
    case 'closed':
      return 'client';
    default:
      return 'commercial';
  }
}

// ─── Convenience predicates used by active pages ──────────────────

export const isConversionPending = (l: Lead) => getCommercialState(l) === 'conversion_pending';
export const isAwaitingPayment   = (l: Lead) => getCommercialState(l) === 'client_review';
export const isOverduePayment    = (l: Lead) => getCommercialState(l) === 'overdue';
export const isOnboardingPending = (l: Lead) => getCommercialState(l) === 'onboarding_pending';
export const isActiveClient      = (l: Lead) => {
  const s = getCommercialState(l);
  return s === 'active_client' || s === 'payment_due_soon' || s === 'pilot';
};
export const isPaidClient        = (l: Lead) => {
  const s = getCommercialState(l);
  return s === 'active_client' || s === 'payment_due_soon' || s === 'overdue' ||
         s === 'onboarding_pending' || s === 'pilot';
};

function hasReadyCredentials(lead: Lead): boolean {
  return !!(lead.credentials?.username && lead.credentials?.password);
}
