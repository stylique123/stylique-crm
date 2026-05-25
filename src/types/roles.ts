/**
 * STYLIQUE CRM — Role & Permission System
 */

export type Role = 'sdr' | 'onboarding' | 'ceo' | 'coo' | 'operations';

export type Permission =
  | 'lead:create' | 'lead:edit' | 'lead:delete'
  | 'deal:move-stage' | 'deal:assign'
  | 'task:create' | 'task:complete'
  | 'trial:approve' | 'trial:override-dates'
  | 'conversion:approve' | 'conversion:edit-plan'
  | 'payment:record'
  | 'settings:manage-team'
  | 'reports:view-all' | 'reports:view-own'
  | 'credentials:add';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  sdr: [
    'lead:create', 'lead:edit', 'deal:move-stage',
    'task:create', 'task:complete', 'reports:view-own',
  ],
  onboarding: [
    'lead:edit', 'task:create', 'task:complete', 'reports:view-own',
  ],
  ceo: [
    'lead:create', 'lead:edit', 'lead:delete',
    'deal:move-stage', 'deal:assign',
    'task:create', 'task:complete',
    'trial:approve', 'trial:override-dates',
    'conversion:approve', 'conversion:edit-plan',
    'payment:record', 'settings:manage-team',
    'reports:view-all', 'credentials:add',
  ],
  coo: [
    'lead:create', 'lead:edit', 'lead:delete',
    'deal:move-stage', 'deal:assign',
    'task:create', 'task:complete',
    'trial:approve', 'trial:override-dates',
    'conversion:approve', 'conversion:edit-plan',
    'payment:record', 'settings:manage-team',
    'reports:view-all', 'credentials:add',
  ],
  operations: [
    'reports:view-all',
  ],
};

export function canPerform(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  region?: string;
}

const SEED_TEAM: TeamMember[] = [
  { id: 'abdullah', name: 'Abdullah - CEO', role: 'ceo' },
  { id: 'hira', name: 'Hira - COO', role: 'coo' },
  { id: 'namra', name: 'Namra - Operations', role: 'operations' },
  { id: 'muneeb', name: 'Muneeb', role: 'onboarding' },
  { id: 'areeba', name: 'Areeba', role: 'sdr', region: 'USA' },
  { id: 'taiba', name: 'Taiba', role: 'sdr', region: 'UK' },
  { id: 'khadija', name: 'Khadija', role: 'sdr', region: 'Pakistan' },
  { id: 'asjad', name: 'Asjad', role: 'sdr', region: 'Pakistan' },
];

/** Live roster — rebuilt in-place from the employee store so legacy callers
 *  importing this array as a static value still see new/edited teammates. */
export const TEAM: TeamMember[] = [...SEED_TEAM];

let teamVersion = 0;
const teamListeners = new Set<() => void>();
export function getTeamVersion(): number { return teamVersion; }
export function subscribeTeam(fn: () => void): () => void {
  teamListeners.add(fn);
  return () => { teamListeners.delete(fn); };
}
function emitTeamChange(): void {
  teamVersion++;
  teamListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stylique:team-updated', { detail: { version: teamVersion } }));
    }
  } catch { /* ignore */ }
}

function normalizeRoleLower(r: string): Role {
  const lc = (r || '').toLowerCase();
  if (lc === 'ceo' || lc === 'coo' || lc === 'onboarding' || lc === 'operations') return lc as Role;
  return 'sdr';
}

export function setTeamFromEmployees(
  employees: Array<{ id: string; fullName?: string; name?: string; role: string; region?: string; active?: boolean }>
): void {
  const next: TeamMember[] = employees
    .filter(e => e.active !== false)
    .map(e => ({
      id: e.id,
      name: e.fullName || e.name || e.id,
      role: normalizeRoleLower(e.role),
      region: e.region,
    }));
  if (next.length === 0) return;
  TEAM.length = 0; TEAM.push(...next);
  emitTeamChange();
}

// Hydrate from localStorage on module init.
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem('stylique-employees');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) setTeamFromEmployees(parsed);
    }
  }
} catch { /* ignore */ }

export function getTeamMember(id: string): TeamMember | undefined {
  return TEAM.find(m => m.id === id);
}

export function getRole(memberId: string): Role | undefined {
  return getTeamMember(memberId)?.role;
}

export const REGION_COLORS: Record<string, string> = {
  'USA': 'bg-blue-500/15 text-blue-400',
  'UK': 'bg-emerald-500/15 text-emerald-400',
  'Pakistan': 'bg-amber-500/15 text-amber-400',
  'UAE': 'bg-rose-500/15 text-rose-400',
};
