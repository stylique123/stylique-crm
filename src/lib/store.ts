import { Lead, Activity } from '@/types/crm';
import { safeId, safeRead, safeWrite } from '@/lib/safe-storage';

const KEYS = {
  leads: 'stylique-crm-leads',
  activities: 'stylique-crm-activities',
};

/**
 * COMPATIBILITY-ONLY — legacy AI-Outbound stage → manual SDR stage migration.
 *
 * AI Outbound has been fully removed. Any record still carrying an AI-only
 * stage/pipeline/flow is rewritten to the nearest valid SDR equivalent the
 * first time it is read, then persisted back so the rest of the app never
 * sees the dead values again.
 *
 * Safe to remove this map (and the migration call below) after the legacy
 * localStorage migration window closes.
 */
const AI_STAGE_MIGRATION: Record<string, string> = {
  // Pre-outreach AI states → fresh SDR lead
  'ai-new-lead': 'sdr-new-lead',
  'pending-enrichment': 'sdr-new-lead',
  'pending-apollo': 'sdr-new-lead',
  'ready-for-outreach': 'sdr-new-lead',
  'lead-added': 'sdr-new-lead',
  // Mid-sequence AI states → SDR has already contacted
  'email-sent-d0': 'sdr-contacted',
  'followup-1-d3': 'sdr-contacted',
  'followup-2-d7': 'sdr-contacted',
  'followup-3-d14': 'sdr-contacted',
  'round4-d17': 'sdr-contacted',
  'sequence-completed': 'sdr-contacted',
  'outreach-1': 'sdr-contacted',
  'outreach-2': 'sdr-contacted',
  'outreach-3': 'sdr-contacted',
  'awaiting-sdr': 'sdr-contacted',
  // Preserve current commercial states. These used to collapse into old
  // payment logic, which caused Pilot/Client Review records to appear in the
  // wrong bucket after reload.
  'internal-decision': 'internal-decision',
  'pricing-discussion': 'pricing-discussion',
  'trial-proposed': 'trial-proposed',
  'trial-active': 'trial-active',
};

type PersistedLeadRecord = Omit<Partial<Lead>, 'pipeline' | 'entry_flow' | 'action_owner' | 'stage'> & {
  pipeline?: string;
  entry_flow?: string;
  action_owner?: string;
  stage?: string;
} & Record<string, unknown>;

function migrateLeadShape(item: unknown): { item: unknown; changed: boolean } {
  if (!item || typeof item !== 'object') return { item, changed: false };
  const before = JSON.stringify(item);
  const record = item as PersistedLeadRecord;
  const next: PersistedLeadRecord = { ...record, tasks: record.tasks || [] };
  // Pipeline: ai-outbound → outbound-sdr
  if (next.pipeline === 'ai-outbound') next.pipeline = 'outbound-sdr';
  // Entry flow: ai_outbound → sdr_manual
  if (next.entry_flow === 'ai_outbound') next.entry_flow = 'sdr_manual';
  // Entry source: ai-outbound → sdr-manual
  if (next.entrySource === 'ai-outbound') next.entrySource = 'sdr-manual';
  // Action owner: ai → sdr
  if (next.action_owner === 'ai') next.action_owner = 'sdr';
  // Stage: AI-only stages → nearest SDR equivalent
  if (typeof next.stage === 'string' && AI_STAGE_MIGRATION[next.stage]) {
    next.stage = AI_STAGE_MIGRATION[next.stage] as Lead['stage'];
  }
  // Drop dead AI/handoff fields if present in legacy records
  delete next.handoff_status;
  delete next.handoff_reason;
  delete next.ai_sequence_step;
  delete next.ai_sequence_status;
  delete next.ai_sequence_history;
  delete next.handoffLog;
  delete next.reply_ai_action_taken;
  delete next.email_open_count;
  return { item: next, changed: JSON.stringify(next) !== before };
}

function read<T>(key: string): T[] {
  try {
    const parsed = safeRead<T[]>(key, []);
    if (key === KEYS.leads) {
      let anyChanged = false;
      const migrated = parsed.map((raw: unknown) => {
        const { item, changed } = migrateLeadShape(raw);
        if (changed) anyChanged = true;
        return item;
      });
      // Persist the normalization so legacy AI values disappear physically.
      if (anyChanged) {
        safeWrite(key, migrated);
      }
      return migrated as T[];
    }
    return parsed;
  } catch {
    return [];
  }
}

function write<T>(key: string, data: T[]) {
  safeWrite(key, data);
}

export function uid(): string {
  return safeId('crm');
}

// Leads
export function getLeads(): Lead[] { return read<Lead>(KEYS.leads); }
export function saveLead(lead: Lead) {
  const leads = getLeads();
  const idx = leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) leads[idx] = lead; else leads.push(lead);
  write(KEYS.leads, leads);
}
export function deleteLead(id: string) {
  write(KEYS.leads, getLeads().filter(l => l.id !== id));
}

// Activities
export function getActivities(): Activity[] { return read<Activity>(KEYS.activities); }
export function addActivity(activity: Activity) {
  const activities = getActivities();
  activities.unshift(activity);
  write(KEYS.activities, activities.slice(0, 200));
}
