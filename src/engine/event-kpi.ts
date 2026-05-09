/**
 * STYLIQUE CRM — Event-Based KPI Helpers
 *
 * Counts business events (meetings booked, conversions) within a time window
 * using the canonical event sources (lead.meetings[] + activities[]).
 *
 * IMPORTANT: These KPIs are EVENT-BASED, not state-based. A meeting booked
 * this week stays counted even if the lead later advances to trial/converted.
 * Likewise a conversion stays counted in the week it happened even if the
 * client later moves to retained/churned.
 */

import type { Lead, Activity } from '@/types/crm';

/** Monday 00:00 of the current week in local time (ISO). */
export function getCurrentWeekStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

/** Exclusive end (next Monday 00:00). */
export function getCurrentWeekEnd(now: Date = new Date()): Date {
  const start = getCurrentWeekStart(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function inWindow(iso: string | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/**
 * Count meetings booked in the week window for the given owner,
 * across the supplied leads. Source of truth: lead.meetings[].created_at.
 */
export function countMeetingsBookedThisWeek(
  leads: Lead[],
  ownerId: string,
  now: Date = new Date(),
): number {
  const start = getCurrentWeekStart(now);
  const end = getCurrentWeekEnd(now);
  let count = 0;
  for (const lead of leads) {
    const isOwner = lead.assignedTo === ownerId || lead.assigned_sdr === ownerId;
    if (!isOwner) continue;
    for (const m of lead.meetings || []) {
      if (m.owner && m.owner !== ownerId) continue;
      if (inWindow(m.created_at, start, end)) count++;
    }
  }
  return count;
}

/**
 * Count conversion events in the week window for the given owner.
 * Source of truth: activities of type 'conversion' or 'payment_confirmed'
 * whose lead is owned by ownerId.
 */
export function countConversionsThisWeek(
  leads: Lead[],
  activities: Activity[],
  ownerId: string,
  now: Date = new Date(),
): number {
  const start = getCurrentWeekStart(now);
  const end = getCurrentWeekEnd(now);
  const ownedLeadIds = new Set(
    leads
      .filter(l => l.assignedTo === ownerId || l.assigned_sdr === ownerId)
      .map(l => l.id),
  );
  let count = 0;
  const seen = new Set<string>(); // dedupe by leadId — one conversion per lead per week
  for (const a of activities) {
    if (!ownedLeadIds.has(a.leadId)) continue;
    if (a.type !== 'conversion' && a.type !== 'payment_confirmed') continue;
    if (!inWindow(a.createdAt, start, end)) continue;
    const key = a.leadId;
    if (seen.has(key)) continue;
    seen.add(key);
    count++;
  }
  return count;
}
