/**
 * STYLIQUE CRM — Canonical Company Store
 * 
 * ONE source of truth for all company data across all pages.
 * Every page reads from this context. Updates here propagate everywhere.
 * 
 * The Lead type IS the canonical company object — it contains all workflow fields.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Lead, Activity } from '@/types/crm';
import { getLeads, saveLead as persistLead, deleteLead as removeLead, getActivities, addActivity as persistActivity, replaceLeads, replaceActivities, uid } from '@/lib/store';
import { getApiToken, getStateBucket, saveStateBucket } from '@/lib/backend-api';
import { generateLeadKey } from '@/lib/lead-key';
import { deduplicateActiveTasks, appendAuditEntry, createAuditEntry } from '@/engine/hardening';
import { crmEventBus } from '@/engine/event-bus';

interface CompanyStore {
  /** All companies (canonical records) */
  companies: Lead[];
  /** All activities */
  activities: Activity[];
  /** Get single company by ID */
  getCompany: (id: string) => Lead | undefined;
  /** Save/update a company — persists and updates all consumers */
  saveCompany: (company: Lead) => void;
  /** Delete a company */
  deleteCompany: (id: string) => void;
  /** Add activity log entry */
  addActivity: (activity: Activity) => void;
  /** Force refresh from localStorage (after external mutations) */
  refresh: () => void;
}

const CompanyStoreContext = createContext<CompanyStore | null>(null);

export function CompanyStoreProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Lead[]>(() => getLeads());
  const [activities, setActivities] = useState<Activity[]>(() => getActivities());

  const refresh = useCallback(() => {
    setCompanies(getLeads());
    setActivities(getActivities());
  }, []);

  useEffect(() => {
    if (!getApiToken()) return;
    let cancelled = false;
    Promise.all([
      getStateBucket<Lead>('leads').catch(() => null),
      getStateBucket<Activity>('activities').catch(() => null),
    ]).then(([remoteLeads, remoteActivities]) => {
      if (cancelled) return;
      if (Array.isArray(remoteLeads) && remoteLeads.length > 0) {
        replaceLeads(remoteLeads);
        setCompanies(remoteLeads);
      } else if (Array.isArray(remoteLeads) && remoteLeads.length === 0) {
        const localLeads = getLeads();
        if (localLeads.length > 0) saveStateBucket('leads', localLeads).catch(() => {});
      }
      if (Array.isArray(remoteActivities) && remoteActivities.length > 0) {
        replaceActivities(remoteActivities);
        setActivities(remoteActivities);
      } else if (Array.isArray(remoteActivities) && remoteActivities.length === 0) {
        const localActivities = getActivities();
        if (localActivities.length > 0) saveStateBucket('activities', localActivities).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh on event bus emissions — ensures stale cards disappear immediately
  // Uses a debounce to batch rapid events (e.g., multiple KPI emissions)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = crmEventBus.onAny(() => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        setCompanies(getLeads());
        setActivities(getActivities());
      }, 50);
    });
    return () => {
      unsub();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const getCompany = useCallback((id: string) => {
    return companies.find(c => c.id === id);
  }, [companies]);

  const saveCompany = useCallback((company: Lead) => {
    // Ensure leadKey for dedupe
    const withKey: Lead = company.leadKey
      ? company
      : { ...company, leadKey: generateLeadKey(company) };

    // Deduplicate active tasks before persisting
    const deduped = deduplicateActiveTasks(withKey);

    // Audit trail: log stage/owner changes
    const existing = getLeads().find(l => l.id === deduped.id);
    if (existing && (existing.stage !== deduped.stage || existing.assignedTo !== deduped.assignedTo)) {
      appendAuditEntry(createAuditEntry(
        existing,
        deduped,
        deduped.assignedTo || 'system',
        existing.stage !== deduped.stage ? `Stage: ${existing.stage} → ${deduped.stage}` : `Owner: ${existing.assignedTo} → ${deduped.assignedTo}`,
        'human',
      ));
    }

    persistLead(deduped);
    setCompanies(prev => {
      const idx = prev.findIndex(c => c.id === deduped.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = deduped;
        return next;
      }
      // Dedupe guard: check for existing record with same leadKey
      if (deduped.leadKey) {
        const dupeIdx = prev.findIndex(c => c.id !== deduped.id && c.leadKey === deduped.leadKey);
        if (dupeIdx >= 0) {
          // Merge into existing — update existing record, don't create duplicate
          console.warn(`[Dedupe] Merging ${deduped.companyName} into existing record ${prev[dupeIdx].companyName}`);
          const next = [...prev];
          next[dupeIdx] = { ...prev[dupeIdx], ...deduped, id: prev[dupeIdx].id };
          return next;
        }
      }
      return [...prev, deduped];
    });
  }, []);

  const deleteCompany = useCallback((id: string) => {
    removeLead(id);
    setCompanies(prev => prev.filter(c => c.id !== id));
  }, []);

  const addActivityFn = useCallback((activity: Activity) => {
    persistActivity(activity);
    setActivities(prev => [activity, ...prev].slice(0, 500));
  }, []);

  const store = useMemo<CompanyStore>(() => ({
    companies,
    activities,
    getCompany,
    saveCompany,
    deleteCompany,
    addActivity: addActivityFn,
    refresh,
  }), [companies, activities, getCompany, saveCompany, deleteCompany, addActivityFn, refresh]);

  return (
    <CompanyStoreContext.Provider value={store}>
      {children}
    </CompanyStoreContext.Provider>
  );
}

/**
 * Hook to access the canonical company store.
 * Every page MUST use this instead of calling getLeads() directly.
 */
export function useCompanyStore(): CompanyStore {
  const store = useContext(CompanyStoreContext);
  if (!store) throw new Error('useCompanyStore must be used within CompanyStoreProvider');
  return store;
}
