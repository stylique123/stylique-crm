/**
 * STYLIQUE CRM — Cold Timing Engine
 *
 * Automatic cold transitions:
 *   • Meeting Scheduled → Cold if meeting time passed by 48h with no outcome.
 *   • Decision Pending → Cold if no movement for 7 calendar days.
 *
 * Cold is NOT lost. Records remain in Contacts and history; can be revived
 * by any normal forward action.
 */

import type { Lead, Activity } from '@/types/crm';
import { getLeads, saveLead, addActivity, uid } from '@/lib/store';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function lastForwardActivityAt(lead: Lead): number {
  // Use whichever timestamp is most recent: lastContactedAt, updatedAt.
  const a = lead.lastContactedAt ? new Date(lead.lastContactedAt).getTime() : 0;
  const b = new Date(lead.updatedAt).getTime();
  return Math.max(a, b);
}

function moveToCold(lead: Lead, reason: string): Lead {
  const now = new Date().toISOString();
  const updated: Lead = {
    ...lead,
    stage: 'cold-no-response',
    updatedAt: now,
  };
  saveLead(updated);
  const activity: Activity = {
    id: uid(),
    leadId: lead.id,
    type: 'stage-change',
    description: `Auto-moved to Cold: ${reason}`,
    createdAt: now,
    createdBy: 'system',
  } as Activity;
  try { addActivity(activity); } catch { /* ignore */ }
  return updated;
}

/** Run a single sweep across all leads. Idempotent. */
export function runColdSweep(): { moved: number } {
  const leads = getLeads();
  const now = Date.now();
  let moved = 0;

  for (const lead of leads) {
    // Skip terminal & post-SDR commercial stages.
    if (['cold-no-response', 'closed-lost', 'unsubscribed', 'converted',
         'payment-pending', 'inbound-disqualified'].includes(lead.stage)) continue;

    // Rule A: Meeting Scheduled with no outcome 48h after meeting end.
    if (lead.stage === 'meeting-booked') {
      const meetings = lead.meetings || [];
      const last = meetings
        .filter(m => m.status === 'scheduled' || m.status === 'rescheduled')
        .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];
      if (last) {
        const t = new Date(last.scheduled_at).getTime();
        if (Number.isFinite(t) && now - t >= 48 * HOUR && !last.outcome) {
          moveToCold(lead, 'meeting time passed +48h with no outcome');
          moved++;
          continue;
        }
      }
    }

    // Rule B: Decision Pending with no movement 7 days.
    if (lead.stage === 'internal-decision' || lead.stage === 'pricing-discussion') {
      const idle = now - lastForwardActivityAt(lead);
      if (idle >= 7 * DAY) {
        moveToCold(lead, 'decision pending 7 days with no movement');
        moved++;
        continue;
      }
    }
  }

  return { moved };
}

let started = false;
/** Boot once. Runs immediately and then every 30 minutes. */
export function startColdSweepLoop() {
  if (started || typeof window === 'undefined') return;
  started = true;
  try { runColdSweep(); } catch { /* swallow */ }
  setInterval(() => { try { runColdSweep(); } catch { /* swallow */ } }, 30 * 60 * 1000);
}