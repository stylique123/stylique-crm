/**
 * STYLIQUE CRM — KPI Integration Hook
 * 
 * Provides helpers for components to record KPI actions.
 * Wraps recordKPIAction with bridge-aware context.
 * Also marks contacts as reached on the brand record.
 */

import { useCallback } from 'react';
import { recordKPIAction } from '@/engine/kpi-engine';
import type { ActionKPIMetric, KPIActionEntry } from '@/types/kpi';
import type { Lead, BrandContact } from '@/types/crm';
import { getLeadContacts } from '@/types/crm';

/**
 * Build a deterministic KPI dedupe key.
 *
 * Default bucketing per metric:
 *   - emails_sent / linkedin_actions / whatsapp_actions / followups_completed → daily
 *     (one Day-1 email counts once per day even if mirrored handlers fire)
 *   - calls_made / replies_received                                          → 5-minute window
 *     (rapid double-click protection without blocking legitimate retries)
 *   - meetings_booked / trials_proposed / payments_confirmed                 → lifecycle one-shot
 *     (per-lead, regardless of timing — these are state transitions)
 *
 * Callers may override `bucket` to force a specific window (e.g. include
 * outcome name when the same metric can fire twice for different outcomes).
 */
export function buildKPIDedupeKey(
  leadId: string,
  metric: ActionKPIMetric,
  bucket?: string,
): string {
  if (bucket) return `${leadId}:${metric}:${bucket}`;

  const now = new Date();
  const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  switch (metric) {
    // Lifecycle one-shots — one per lead, ever.
    case 'meetings_booked':
    case 'trials_proposed':
    case 'payments_confirmed':
      return `${leadId}:${metric}:lifecycle`;

    // Rapid-click guard (5 min window).
    case 'calls_made':
    case 'replies_received': {
      const fiveMinBucket = Math.floor(now.getTime() / (5 * 60 * 1000));
      return `${leadId}:${metric}:${fiveMinBucket}`;
    }

    // Daily outreach metrics.
    case 'emails_sent':
    case 'linkedin_actions':
    case 'whatsapp_actions':
    case 'followups_completed':
    default:
      return `${leadId}:${metric}:${dayKey}`;
  }
}

/**
 * Record a KPI-relevant action for the given lead.
 * Should be called from any outcome handler that counts toward KPI.
 * Also updates the lead's contacts[] reached state for brand counting.
 *
 * If `dedupeBucket` is provided it is appended to the auto-generated key
 * (e.g. 'day1_email' so manual outreach and Day-1 email don't collide).
 * If `dedupeKey` is provided, it overrides the auto-generated key entirely.
 */
export function emitKPI(
  sdrId: string,
  lead: Lead,
  contactName: string,
  metric: ActionKPIMetric,
  channel: KPIActionEntry['channel'],
  outcome?: string,
  opts?: { dedupeBucket?: string; dedupeKey?: string },
) {
  const dedupeKey = opts?.dedupeKey
    ?? buildKPIDedupeKey(lead.id, metric, opts?.dedupeBucket);
  recordKPIAction(
    sdrId,
    lead.id,
    lead.companyName,
    contactName,
    metric,
    channel,
    outcome,
    undefined,
    dedupeKey,
  );
}

/**
 * Mark a contact as reached on a lead's contacts[] array.
 * Returns updated contacts array (caller must persist).
 */
export function markContactReached(lead: Lead, contactName: string): BrandContact[] {
  const contacts = getLeadContacts(lead);
  const now = new Date().toISOString();
  return contacts.map(c => {
    if (c.name === contactName && !c.reached) {
      return { ...c, reached: true, firstReachedAt: now };
    }
    return c;
  });
}

/**
 * Get brand progress for KPI display.
 * Returns: { contactsTotal, contactsReached, brandCounted }
 */
export function getBrandProgress(lead: Lead): { contactsTotal: number; contactsReached: number; brandCounted: boolean } {
  const contacts = getLeadContacts(lead);
  const reached = contacts.filter(c => c.reached).length;
  return {
    contactsTotal: contacts.length,
    contactsReached: reached,
    brandCounted: reached >= 2,
  };
}

/** Hook for components */
export function useKPIEmitter() {
  return useCallback((
    sdrId: string,
    lead: Lead,
    contactName: string,
    metric: ActionKPIMetric,
    channel: KPIActionEntry['channel'],
    outcome?: string,
  ) => {
    emitKPI(sdrId, lead, contactName, metric, channel, outcome);
  }, []);
}
