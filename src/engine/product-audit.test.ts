import { describe, expect, it, beforeEach } from 'vitest';
import { getCommercialState } from '@/engine/commercial-state';
import { saveWeeklyKPIConfig } from '@/engine/weekly-kpi-engine';
import { getKPITargets } from '@/engine/kpi-engine';
import { loadKPIDefinitions } from '@/lib/kpi-definitions-store';
import { setTeamMembersFromEmployees, TEAM_MEMBERS, SALES_MEMBERS } from '@/types/crm';
import type { Lead } from '@/types/crm';

function lead(overrides: Partial<Lead>): Lead {
  const now = new Date().toISOString();
  return {
    id: overrides.id || crypto.randomUUID(),
    companyName: 'Audit Brand',
    contactName: 'Buyer',
    contactEmail: 'buyer@example.com',
    pipeline: 'outbound-sdr',
    stage: 'sdr-new-lead',
    assignedTo: 'areeba',
    notes: '',
    createdAt: now,
    updatedAt: now,
    tasks: [],
    ...overrides,
  };
}

describe('Stylique product audit invariants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps Client Review as one CEO-owned bucket until credentials are ready for onboarding', () => {
    expect(getCommercialState(lead({ stage: 'trial-proposed', paymentStatus: 'pending' }))).toBe('client_review');
    expect(getCommercialState(lead({
      stage: 'trial-proposed',
      paymentStatus: 'paid',
      paymentReceivedAt: new Date().toISOString(),
    }))).toBe('client_review');
    expect(getCommercialState(lead({
      stage: 'trial-proposed',
      paymentStatus: 'paid',
      paymentReceivedAt: new Date().toISOString(),
      credentials: { username: 'admin', password: 'secret' },
    }))).toBe('onboarding_pending');
  });

  it('does not mark initial client review records overdue', () => {
    expect(getCommercialState(lead({
      stage: 'trial-proposed',
      paymentStatus: 'overdue',
      nextPaymentDate: new Date(Date.now() - 86400000).toISOString(),
    }))).toBe('client_review');
    expect(getCommercialState(lead({
      stage: 'converted',
      contractSignedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
      paymentStatus: 'overdue',
      nextPaymentDate: new Date(Date.now() - 86400000).toISOString(),
    }))).toBe('overdue');
  });

  it('propagates KPI policy changes into weekly brand targets and monthly KPI definitions', () => {
    saveWeeklyKPIConfig({ brandsPerWorkingDay: 30, leaveProrationMode: 'prorated', blockedBrandsMode: 'exclude' });
    expect(getKPITargets().brandsPerDay).toBe(30);
    const defs = loadKPIDefinitions();
    expect(defs.find(d => d.code === 'brands_reached_out')?.targetValue).toBe(150);
    expect(defs.find(d => d.code === 'brands_reached_out')?.period).toBe('weekly');
    expect(defs.find(d => d.code === 'meetings_booked')?.period).toBe('monthly');
    expect(defs.find(d => d.code === 'conversions')?.period).toBe('monthly');
  });

  it('removes inactive teammates from runtime role and sales lists', () => {
    setTeamMembersFromEmployees([
      { id: 'abdullah', fullName: 'Abdullah', role: 'ceo', active: true },
      { id: 'areeba', fullName: 'Areeba', role: 'sdr', active: true },
      { id: 'mashael', fullName: 'Mashael', role: 'sdr', active: false },
    ]);
    expect(TEAM_MEMBERS.map(m => m.id)).toEqual(['abdullah', 'areeba']);
    expect(SALES_MEMBERS.map(m => m.id)).toEqual(['areeba']);
  });
});
