/**
 * STYLIQUE CRM — Stage Alias Normalizer
 *
 * One canonical predicate layer for raw `lead.stage` interpretation.
 *
 * Background
 * ──────────
 * `lead.stage` may carry either a current stage id (e.g. `sdr-new-lead`)
 * or a legacy alias (e.g. `new-lead`, `lead-added`, `new-inquiry`,
 * `qualified`, `awaiting-sdr`). Treating those raw strings as equivalent
 * via scattered `===` checks across pages and services is the root cause
 * of ghost cards, wrong buckets, wrong task visibility and KPI drift.
 *
 * Rules
 * ─────
 * • Outside of deep engine internals (state machine, lifecycle engine,
 *   canonical-state derivation), code MUST use these helpers instead of
 *   raw stage equality on alias families.
 * • This module does NOT redesign the lifecycle and does NOT rename
 *   product states. It only canonicalises equivalence between raw aliases
 *   that the codebase already treats as the same logical stage.
 * • Predicates accept `string | undefined` so callers don't need to cast.
 */

import type { Stage } from '@/types/crm';
import { normalizeStage as normalizeStageInternal } from '@/types/crm';

/** Family identifier returned by `getStageFamilyAlias`. */
export type StageAliasFamily =
  | 'new-lead'
  | 'contacted'
  | 'replied'
  | 'meeting-booked'
  | 'meeting-completed'
  | 'trial-proposed'
  | 'trial-active'
  | 'payment-pending'
  | 'converted'
  | 'closed'
  | 'inbound-new'
  | 'inbound-qualified'
  | 'inbound-awaiting-sdr'
  | 'unknown';

// ── Family membership tables (raw alias strings, not just current ids) ──

const NEW_LEAD_ALIASES = new Set<string>([
  'sdr-new-lead', 'new-lead', 'lead-added', 'ai-new-lead',
]);

const CONTACTED_ALIASES = new Set<string>([
  'sdr-contacted', 'contacted',
]);

const REPLIED_ALIASES = new Set<string>([
  'sdr-replied', 'replied',
]);

const MEETING_BOOKED_ALIASES = new Set<string>([
  'meeting-booked',
]);

const MEETING_COMPLETED_ALIASES = new Set<string>([
  'meeting-completed', 'internal-decision', 'pricing-discussion',
]);

const TRIAL_PROPOSED_ALIASES = new Set<string>([
  'trial-proposed',
]);

const TRIAL_ACTIVE_ALIASES = new Set<string>([
  'trial-active',
]);

const PAYMENT_PENDING_ALIASES = new Set<string>([
  'payment-pending',
]);

const CONVERTED_ALIASES = new Set<string>([
  'converted',
]);

const CLOSED_ALIASES = new Set<string>([
  'closed-lost', 'inbound-disqualified', 'unsubscribed', 'cold-no-response',
]);

const INBOUND_NEW_ALIASES = new Set<string>([
  'inbound-new', 'new-inquiry',
]);

const INBOUND_QUALIFIED_ALIASES = new Set<string>([
  'inbound-qualified', 'qualified',
]);

const INBOUND_AWAITING_SDR_ALIASES = new Set<string>([
  'inbound-awaiting-sdr', 'awaiting-sdr',
]);

// ── Public predicates ──

const s = (v: string | undefined | null): string => (v ?? '');

export function isNewLeadStage(stage: string | undefined | null): boolean {
  return NEW_LEAD_ALIASES.has(s(stage));
}
export function isContactedStage(stage: string | undefined | null): boolean {
  return CONTACTED_ALIASES.has(s(stage));
}
export function isRepliedStage(stage: string | undefined | null): boolean {
  return REPLIED_ALIASES.has(s(stage));
}
export function isMeetingBookedStage(stage: string | undefined | null): boolean {
  return MEETING_BOOKED_ALIASES.has(s(stage));
}
export function isMeetingCompletedStage(stage: string | undefined | null): boolean {
  return MEETING_COMPLETED_ALIASES.has(s(stage));
}
export function isTrialProposedStage(stage: string | undefined | null): boolean {
  return TRIAL_PROPOSED_ALIASES.has(s(stage));
}
export function isTrialActiveStage(stage: string | undefined | null): boolean {
  return TRIAL_ACTIVE_ALIASES.has(s(stage));
}
export function isPaymentPendingStage(stage: string | undefined | null): boolean {
  return PAYMENT_PENDING_ALIASES.has(s(stage));
}
export function isConvertedStage(stage: string | undefined | null): boolean {
  return CONVERTED_ALIASES.has(s(stage));
}
export function isClosedStage(stage: string | undefined | null): boolean {
  return CLOSED_ALIASES.has(s(stage));
}
export function isInboundNewStage(stage: string | undefined | null): boolean {
  return INBOUND_NEW_ALIASES.has(s(stage));
}
export function isInboundQualifiedStage(stage: string | undefined | null): boolean {
  return INBOUND_QUALIFIED_ALIASES.has(s(stage));
}
export function isInboundAwaitingSdrStage(stage: string | undefined | null): boolean {
  return INBOUND_AWAITING_SDR_ALIASES.has(s(stage));
}

/** True if the raw stage represents an inbound prospecting state needing first human contact. */
export function isInboundPickupStage(stage: string | undefined | null): boolean {
  return isInboundNewStage(stage)
    || isInboundQualifiedStage(stage)
    || isInboundAwaitingSdrStage(stage);
}

// ── Family classifier ──

export function getStageFamilyAlias(stage: string | undefined | null): StageAliasFamily {
  if (isNewLeadStage(stage)) return 'new-lead';
  if (isContactedStage(stage)) return 'contacted';
  if (isRepliedStage(stage)) return 'replied';
  if (isMeetingBookedStage(stage)) return 'meeting-booked';
  if (isMeetingCompletedStage(stage)) return 'meeting-completed';
  if (isTrialProposedStage(stage)) return 'trial-proposed';
  if (isTrialActiveStage(stage)) return 'trial-active';
  if (isPaymentPendingStage(stage)) return 'payment-pending';
  if (isConvertedStage(stage)) return 'converted';
  if (isClosedStage(stage)) return 'closed';
  if (isInboundNewStage(stage)) return 'inbound-new';
  if (isInboundQualifiedStage(stage)) return 'inbound-qualified';
  if (isInboundAwaitingSdrStage(stage)) return 'inbound-awaiting-sdr';
  return 'unknown';
}

/**
 * Re-export of the existing canonical mapper from `types/crm` so the alias
 * layer is the single import surface. Maps a raw stage to its canonical
 * current-id form (e.g. `new-lead` → `sdr-new-lead`).
 */
export function normalizeStage(stage: Stage | string): Stage {
  return normalizeStageInternal(stage as Stage);
}
