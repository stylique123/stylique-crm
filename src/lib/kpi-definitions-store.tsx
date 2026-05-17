/**
 * STYLIQUE CRM — KPI Definitions Store
 * Admin-configurable KPI definitions with flexible metrics.
 * Weekly by default. Brands Reached Out is mandatory and cannot be disabled.
 * Visible weekly scorecard stays intentionally small: brands, meetings, conversions.
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { safeRead, safeWrite } from '@/lib/safe-storage';

export type KPIMeasurePeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type KPIUnit =
  | 'brands' | 'contacts' | 'calls' | 'emails'
  | 'linkedin_actions' | 'whatsapp_actions' | 'meetings'
  | 'replies' | 'trials' | 'conversions' | 'payments'
  | 'percentage' | 'currency' | 'count';

export interface KPIDefinition {
  id: string;
  name: string;
  code: string;
  description: string;
  assignedRoles: string[];
  assignedUsers?: string[];
  /** Per-user target overrides: { userId: targetValue } */
  userTargetOverrides?: Record<string, number>;
  active: boolean;
  /** Mandatory KPIs cannot be toggled off */
  mandatory?: boolean;
  targetValue: number;
  period: KPIMeasurePeriod;
  unit: KPIUnit;
  sourceEvent?: string;
  warningThreshold: number;
  failThreshold: number;
  attendanceAffects: boolean;
  leaveAffects: boolean;
  weekendsCount: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The mandatory brands KPI code — cannot be deleted or disabled */
export const MANDATORY_KPI_CODE = 'brands_reached_out';
const ACTIVE_SCORECARD_CODES = new Set(['brands_reached_out', 'meetings_booked', 'conversions']);

const STORAGE_KEY = 'stylique-kpi-definitions';

const DEFAULT_DEFINITIONS: KPIDefinition[] = [
  {
    id: 'kpi-brands-week', name: 'Brands Reached Out', code: 'brands_reached_out',
    description: 'Brands with primary + secondary contact outreach completed this week',
    assignedRoles: ['sdr'], active: true, mandatory: true,
    targetValue: 125, period: 'weekly', unit: 'brands',
    sourceEvent: 'brand_coverage_complete', warningThreshold: 60, failThreshold: 40,
    attendanceAffects: true, leaveAffects: true, weekendsCount: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'kpi-meetings-month', name: 'Meetings Booked', code: 'meetings_booked',
    description: 'Meetings successfully booked this month', assignedRoles: ['sdr'],
    active: true, targetValue: 40, period: 'monthly', unit: 'meetings',
    warningThreshold: 60, failThreshold: 40, attendanceAffects: true,
    leaveAffects: true, weekendsCount: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'kpi-conversions-month', name: 'Conversions', code: 'conversions',
    description: 'Conversions confirmed this month', assignedRoles: ['sdr'],
    active: true, targetValue: 8, period: 'monthly', unit: 'conversions',
    warningThreshold: 60, failThreshold: 40, attendanceAffects: false,
    leaveAffects: false, weekendsCount: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

function normalizeDefs(defs: KPIDefinition[]): KPIDefinition[] {
  const byCode = new Map(defs.map(def => [def.code, def]));
  for (const def of DEFAULT_DEFINITIONS) {
    byCode.set(def.code, { ...def, ...(byCode.get(def.code) || {}) });
  }

  return Array.from(byCode.values())
    .map(def => {
      if (def.code === MANDATORY_KPI_CODE) return { ...def, mandatory: true, active: true };
      return def;
    });
}

function loadDefs(): KPIDefinition[] {
  const stored = safeRead<KPIDefinition[] | null>(STORAGE_KEY, null);
  if (stored) {
    const defs = normalizeDefs(stored);
    saveDefs(defs);
    return defs;
  }
  return DEFAULT_DEFINITIONS;
}
function saveDefs(defs: KPIDefinition[]) {
  safeWrite(STORAGE_KEY, defs);
}

/** Get the effective target for a user, considering per-user overrides */
export function getEffectiveTarget(def: KPIDefinition, userId?: string): number {
  if (userId && def.userTargetOverrides?.[userId] !== undefined) {
    return def.userTargetOverrides[userId];
  }
  return def.targetValue;
}

interface KPIDefContextValue {
  definitions: KPIDefinition[];
  getActive: (role?: string) => KPIDefinition[];
  getForUser: (userId: string, role: string) => KPIDefinition[];
  save: (def: KPIDefinition) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  refresh: () => void;
}

const KPIDefContext = createContext<KPIDefContextValue | null>(null);

export function KPIDefinitionsProvider({ children }: { children: ReactNode }) {
  const [definitions, setDefinitions] = useState<KPIDefinition[]>(loadDefs);

  const persist = useCallback((updated: KPIDefinition[]) => {
    setDefinitions(updated);
    saveDefs(updated);
  }, []);

  const getActive = useCallback((role?: string) => {
    return definitions.filter(d => d.active && (!role || d.assignedRoles.includes(role)));
  }, [definitions]);

  const getForUser = useCallback((userId: string, role: string) => {
    return definitions.filter(d => d.active && (
      d.assignedRoles.includes(role) || d.assignedUsers?.includes(userId)
    ));
  }, [definitions]);

  const save = useCallback((def: KPIDefinition) => {
    const current = loadDefs();
    const idx = current.findIndex(d => d.id === def.id);
    def.updatedAt = new Date().toISOString();
    if (idx >= 0) current[idx] = def;
    else current.push(def);
    persist(current);
  }, [persist]);

  const remove = useCallback((id: string) => {
    const current = loadDefs();
    const def = current.find(d => d.id === id);
    // Cannot delete mandatory KPIs
    if (def?.mandatory) return;
    persist(current.filter(d => d.id !== id));
  }, [persist]);

  const toggle = useCallback((id: string) => {
    const current = loadDefs();
    const idx = current.findIndex(d => d.id === id);
    if (idx >= 0) {
      // Cannot disable mandatory KPIs
      if (current[idx].mandatory) return;
      current[idx].active = !current[idx].active;
      persist(current);
    }
  }, [persist]);

  const refresh = useCallback(() => setDefinitions(loadDefs()), []);

  useEffect(() => {
    const refreshFromExternalUpdate = () => setDefinitions(loadDefs());
    window.addEventListener('stylique:kpi-policy-updated', refreshFromExternalUpdate);
    window.addEventListener('storage', refreshFromExternalUpdate);
    return () => {
      window.removeEventListener('stylique:kpi-policy-updated', refreshFromExternalUpdate);
      window.removeEventListener('storage', refreshFromExternalUpdate);
    };
  }, []);

  const value = useMemo(() => ({
    definitions, getActive, getForUser, save, remove, toggle, refresh,
  }), [definitions, getActive, getForUser, save, remove, toggle, refresh]);

  return <KPIDefContext.Provider value={value}>{children}</KPIDefContext.Provider>;
}

export function useKPIDefinitions() {
  const ctx = useContext(KPIDefContext);
  if (!ctx) throw new Error('useKPIDefinitions must be within KPIDefinitionsProvider');
  return ctx;
}

/** Get raw definitions without context (for non-React code) */
export function loadKPIDefinitions(): KPIDefinition[] {
  const stored = safeRead<KPIDefinition[] | null>(STORAGE_KEY, null);
  if (stored) {
    const defs = normalizeDefs(stored);
    saveDefs(defs);
    return defs;
  }
  return DEFAULT_DEFINITIONS;
}
