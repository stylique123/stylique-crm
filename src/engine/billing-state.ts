/**
 * STYLIQUE CRM — Billing State Machine
 *
 * Single source of truth for what a payment record means. Keeps Decisions,
 * Risks, Payments, and Conversions from disagreeing.
 *
 * States:
 *  • awaiting_payment        — converted/agreed but no proof yet, in window
 *  • awaiting_confirmation   — proof submitted (paymentClaimedAt) — leadership must confirm
 *  • paid                    — paymentStatus === 'paid'
 *  • overdue                 — past due date with no proof
 *  • closed                  — written off / not pursued
 *  • not_billable            — pre-conversion lead
 *
 * Routing rules:
 *  • Decisions page surfaces ONLY awaiting_confirmation (proof to verify) +
 *    trial-approval pending. Overdue is NOT a "confirmation" decision —
 *    it goes to Risks as an escalation.
 *  • Risks page surfaces overdue as escalation; never as "confirm payment".
 *  • Payments page differentiates all four operational states.
 */

import type { Lead } from '@/types/crm';
import { getPaymentDaysUntilDue } from '@/types/crm';

export type BillingState =
  | 'awaiting_payment'
  | 'awaiting_confirmation'
  | 'paid'
  | 'overdue'
  | 'closed'
  | 'not_billable';

export const BILLING_LABEL: Record<BillingState, string> = {
  awaiting_payment: 'Client Review',
  awaiting_confirmation: 'Awaiting Confirmation',
  paid: 'Paid',
  overdue: 'Overdue',
  closed: 'Closed',
  not_billable: 'Client Review',
};

export function getBillingState(lead: Lead): BillingState {
  if (lead.paymentStatus === 'paid') return 'paid';

  // STRICT: only records actually in the billing collection window count.
  // Trial-stage records (trial-proposed, trial-active, etc.) MUST NOT
  // appear in Payments — they belong in /trials. A record enters the
  // billing window only once stage advances to 'payment-pending' or
  // 'converted' (commercial agreement to continue exists).
  const inBillingWindow = lead.stage === 'payment-pending' || lead.stage === 'converted';
  if (!inBillingWindow) {
    if (lead.stage === 'closed-lost') return 'closed';
    return 'not_billable';
  }

  // Proof submitted — needs leadership verification.
  if (lead.paymentClaimedAt) {
    return 'awaiting_confirmation';
  }

  // Real overdue ONLY when due date has passed.
  const days = getPaymentDaysUntilDue(lead);
  if (days !== null && days < 0) return 'overdue';

  // Otherwise we're still inside the agreed payment window.
  return 'awaiting_payment';
}

/** Decisions page filter: only items needing real leadership verification. */
export function isPaymentDecision(lead: Lead): boolean {
  return getBillingState(lead) === 'awaiting_confirmation';
}

/** Risks page filter: overdue payments needing escalation. */
export function isPaymentRisk(lead: Lead): boolean {
  return getBillingState(lead) === 'overdue';
}
