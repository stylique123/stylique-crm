/**
 * STYLIQUE CRM — Lead Key Util
 *
 * Deterministic dedupe key for any lead (email > website host > slug).
 */
import type { Lead } from '@/types/crm';

export function generateLeadKey(lead: Pick<Lead, 'contactEmail' | 'website' | 'companyName'>): string {
  if (lead.contactEmail) return lead.contactEmail.trim().toLowerCase();
  if (lead.website) {
    try {
      const url = new URL(lead.website.startsWith('http') ? lead.website : `https://${lead.website}`);
      return url.hostname.replace(/^www\./, '').toLowerCase();
    } catch { /* fall through */ }
  }
  return lead.companyName.trim().toLowerCase().replace(/\s+/g, '-');
}

export function findDuplicateLead(allLeads: Lead[], leadKey: string, excludeId?: string): Lead | undefined {
  return allLeads.find(l => l.id !== excludeId && l.leadKey === leadKey);
}

export function ensureLeadKey(lead: Lead): Lead {
  if (lead.leadKey) return lead;
  return { ...lead, leadKey: generateLeadKey(lead) };
}