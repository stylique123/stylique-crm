/**
 * STYLIQUE CRM — Unified Role Model
 *
 * ONE role enum. ONE mapping function. Every other role type
 * (ViewerRole, TrialRole) is now a re-export of CRMRole and only
 * exists for backwards compatibility while old call sites are migrated.
 *
 * Permissions live in canonical-view.ts (per-record) and role-matrix.ts
 * (per-page). They MUST NOT be redefined elsewhere.
 */

import { TEAM_MEMBERS } from '@/types/crm';

export type CRMRole = 'ceo' | 'coo' | 'sdr' | 'onboarding';

/** Map a userId to their canonical role. Defaults to 'sdr' if unknown. */
export function getRoleForUser(userId: string): CRMRole {
  if (userId === 'abdullah') return 'ceo';
  if (userId === 'hira') return 'coo';
  if (userId === 'muneeb') return 'onboarding';
  const member = TEAM_MEMBERS.find(m => m.id === userId);
  if (!member) return 'sdr';
  const r = (member.role || '').toLowerCase();
  if (r === 'ceo') return 'ceo';
  if (r === 'coo') return 'coo';
  if (r === 'onboarding') return 'onboarding';
  return 'sdr';
}

export function isLeadershipRole(role: CRMRole): boolean {
  return role === 'ceo' || role === 'coo';
}
