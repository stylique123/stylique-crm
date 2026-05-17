import { beforeEach, describe, expect, it } from 'vitest';
import type { Activity, Lead } from '@/types/crm';
import { getCommercialState } from '@/engine/commercial-state';
import { executeAtomicTrialSetup, executeMeetingBooked, executeTrialActivation, type StoreBridge } from '@/engine/action-executor';
import { processMeetingOutcome, processPaymentOutcome, processTaskOutcome } from '@/engine/outcome-engine';
import { getCurrentBillingEntry, getLedger } from '@/engine/payment-ledger';
import { runReconciliation } from '@/engine/hardening';

const SDRS = ['sdr-us', 'sdr-uk', 'sdr-pk', 'sdr-uae'];

function isoPlus(days: number) {
  const d = new Date('2026-05-17T09:00:00.000Z');
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function makeLead(i: number, flow: 'sdr_manual' | 'inbound' = 'sdr_manual'): Lead {
  const owner = SDRS[i % SDRS.length];
  return {
    id: `stress-${flow}-${i}`,
    companyName: `Stress Brand ${i}`,
    contactName: `Buyer ${i}`,
    contactEmail: `buyer${i}@brand${i}.com`,
    pipeline: flow === 'inbound' ? 'inbound' : 'outbound-sdr',
    entry_flow: flow,
    inbound_type: flow === 'inbound' ? 'direct_book_demo' : null,
    source_detail: flow === 'inbound' ? 'website_demo' : 'linkedin_evaboot',
    stage: flow === 'inbound' ? 'inbound-new' : 'sdr-new-lead',
    assignedTo: owner,
    assigned_sdr: owner,
    record_owner: owner,
    notes: '',
    createdAt: isoPlus(-5),
    updatedAt: isoPlus(-5),
    tasks: [],
    contacts: [
      { id: `c-${i}-1`, name: `Buyer ${i}`, email: `buyer${i}@brand${i}.com` },
      { id: `c-${i}-2`, name: `Ops ${i}`, email: `ops${i}@brand${i}.com` },
    ],
  };
}

function makeBridge(store: Map<string, Lead>, activities: Activity[]): StoreBridge {
  return {
    saveCompany: (lead) => store.set(lead.id, lead),
    addActivity: (activity) => activities.push(activity),
  };
}

function current(store: Map<string, Lead>, lead: Lead) {
  return store.get(lead.id) || lead;
}

describe('Stylique CRM high-volume flow hardening', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('runs 1200 records through SDR, CEO, onboarding, pilot, contract/lost scenarios without state overlap', () => {
    const store = new Map<string, Lead>();
    const activities: Activity[] = [];
    const bridge = makeBridge(store, activities);
    const all: Lead[] = Array.from({ length: 1200 }, (_, i) => makeLead(i, i % 6 === 0 ? 'inbound' : 'sdr_manual'));
    all.forEach(l => store.set(l.id, l));

    const t0 = performance.now();

    for (const seed of all) {
      let lead = current(store, seed);

      // SDR books and logs a real written meeting outcome.
      executeMeetingBooked(lead, lead.assignedTo, bridge, isoPlus(1), 'teams', `https://meet.example/${lead.id}`);
      lead = current(store, lead);

      const scenario = Number(lead.id.split('-').at(-1)) % 6;
      if (scenario === 3) {
        processMeetingOutcome(lead, 'followup_later', 'Needs a second stakeholder next week.', 'Follow up after internal discussion', lead.assignedTo, bridge, isoPlus(7));
        continue;
      }
      if (scenario === 4) {
        processMeetingOutcome(lead, 'not_fit', 'Not a fit for the current offer.', '', lead.assignedTo, bridge);
        continue;
      }

      processMeetingOutcome(lead, scenario === 2 ? 'interested' : 'propose_trial', 'Wants proposal and owner approved commercial review.', 'Client review', lead.assignedTo, bridge);
      lead = current(store, lead);

      if (scenario === 2) {
        expect(lead.stage).toBe('internal-decision');
        continue;
      }

      expect(lead.stage).toBe('trial-proposed');
      expect(getCommercialState(lead)).toBe('client_review');

      if (scenario === 5) {
        processPaymentOutcome(lead, 'lost', 'Client decided not to proceed.', 'ceo', bridge);
        continue;
      }

      // CEO verifies payment and credentials in the same atomic handoff.
      const setup = executeAtomicTrialSetup(lead, 'ceo', bridge, {
        approved: true,
        credentials: {
          username: `admin-${lead.id}`,
          password: `pass-${lead.id}`,
          loginUrl: `https://${lead.id}.example/admin`,
          installationNotes: 'Install during business hours.',
        },
      });
      expect(setup.success).toBe(true);
      lead = current(store, lead);
      expect(getCommercialState(lead)).toBe('onboarding_pending');
      expect(lead.paymentStatus).toBe('paid');
      expect(lead.credentials?.username).toBeTruthy();
      expect(getLedger(lead).filter(e => e.status === 'paid')).toHaveLength(1);

      // Onboarding verifies. This starts paid Pilot, not Contract.
      const pilot = executeTrialActivation(lead, 'muneeb', bridge, 30);
      expect(pilot.success).toBe(true);
      lead = current(store, lead);
      expect(lead.stage).toBe('trial-active');
      expect(getCommercialState(lead)).toBe('pilot');
      expect(lead.onboardingDoneAt).toBeTruthy();
      expect(lead.pilotEndDate).toBeTruthy();
      expect(getCurrentBillingEntry(lead)).toBeTruthy();

      // After pilot, decision is Contract or Lost. It must not go back to payment.
      const decisionTask = lead.tasks.find(t => t.type === 'conversion-push' && !t.completed);
      if (scenario === 1) {
        processTaskOutcome(lead, 'lost', 'Pilot ended; client did not sign contract.', decisionTask?.id, 'conversion-push', lead.assignedTo, bridge);
        lead = current(store, lead);
        expect(lead.stage).toBe('closed-lost');
        expect(lead.pilotDecision).toBe('lost');
      } else {
        processTaskOutcome(lead, 'interested', 'Pilot completed and 3-month contract signed.', decisionTask?.id, 'conversion-push', lead.assignedTo, bridge);
        lead = current(store, lead);
        expect(lead.stage).toBe('converted');
        expect(getCommercialState(lead)).toBe('contract');
        expect(lead.contractSignedAt).toBeTruthy();
      }
    }

    const elapsed = performance.now() - t0;
    const final = [...store.values()];

    expect(final).toHaveLength(1200);
    expect(elapsed).toBeLessThan(5000);

    const overlaps = final.filter(lead => {
      const state = getCommercialState(lead);
      if (state === 'overdue' && lead.stage !== 'converted') return true;
      if (state === 'pilot' && (!lead.paymentReceivedAt || !lead.onboardingDoneAt)) return true;
      if (state === 'contract' && !lead.contractSignedAt) return true;
      if (state === 'onboarding_pending' && (!lead.credentials?.username || lead.stage !== 'trial-proposed')) return true;
      return false;
    });
    expect(overlaps).toHaveLength(0);

    const reconciliation = runReconciliation(final, lead => store.set(lead.id, lead));
    expect(reconciliation.totalLeads).toBe(1200);
    expect(reconciliation.orphanedTasks).toBe(0);
    expect(activities.length).toBeGreaterThan(2500);
  });
});
