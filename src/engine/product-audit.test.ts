import { describe, expect, it, beforeEach } from 'vitest';
import { getCommercialState } from '@/engine/commercial-state';
import { saveWeeklyKPIConfig } from '@/engine/weekly-kpi-engine';
import { getKPITargets } from '@/engine/kpi-engine';
import { loadKPIDefinitions } from '@/lib/kpi-definitions-store';
import { setTeamMembersFromEmployees, TEAM_MEMBERS, SALES_MEMBERS } from '@/types/crm';
import { executeAtomicTrialSetup, executeTrialActivation, type StoreBridge } from '@/engine/action-executor';
import { parseCSV, parseXLSX, autoMapHeaders } from '@/components/CSVImportDialog';
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

  it('keeps custom SDR KPI definitions instead of dropping them during normalization', () => {
    localStorage.setItem('stylique-kpi-definitions', JSON.stringify([
      {
        id: 'kpi-custom-replies',
        name: 'Replies This Month',
        code: 'replies_received',
        description: 'Custom SDR reply KPI',
        assignedRoles: ['sdr'],
        active: true,
        targetValue: 20,
        period: 'monthly',
        unit: 'replies',
        warningThreshold: 60,
        failThreshold: 40,
        attendanceAffects: true,
        leaveAffects: true,
        weekendsCount: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]));
    const defs = loadKPIDefinitions();
    expect(defs.find(d => d.code === 'replies_received')?.targetValue).toBe(20);
    expect(defs.find(d => d.code === 'replies_received')?.active).toBe(true);
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

  it('imports brand-first CSV with only brand/contact columns mapped automatically', () => {
    const csv = 'Brand Name,Person,Sales Navigator URL\nRadiance Co,Aisha,https://linkedin.com/company/radiance\nSolo Brand,,https://example.com\n';
    const parsed = parseCSV(csv);
    expect(parsed.rows).toHaveLength(2);
    const mapping = autoMapHeaders(parsed.headers);
    expect(mapping['Brand Name']).toBe('companyName');
    expect(mapping.Person).toBe('contactName');
    expect(mapping['Sales Navigator URL']).toBe('linkedin');
  });

  it('imports Excel sheets instead of reading XLSX bytes as CSV text', () => {
    const fixture = 'UEsDBBQAAAAIACiMtVzrWA6JjAAAALYAAAAPAAAAeGwvd29ya2Jvb2sueG1sNU5JDoMwDPxK5AfU0EMPKIRLL0j9RAqmiSAxstPl+Y2qcppNMxo7fNJmXiQaOffQnhoYnH2zrHfm1dQwayc9hFL2DlGnQMnriXfKNVtYki9VygN5WeJEV56eiXLBc9NcUGjzpQ5riLuCsxqIiv7RZJ+ohxv5WcH8rHGuF8BIFyuRcW4BncWjhcct9wVQSwMEFAAAAAgAKIy1XPE9z0JQAAAAbAAAABoAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc7Oxr8jNUShLLSrOzM+zVTLUM1Cyt7MJSs1JLAEKFGdkFhSjchU8U2yVijxTDJUUQhKL0lNLbJXK84uyizNSU0uK9cGUoR7QTCV9Oxt9VHMAUEsDBBQAAAAIACiMtVzSExb25gAAAK0CAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1shZLLakMhEEB/RfyA2GRZjGnaXLIrlNJNd8ZMyVAfqc7tbf6+5kEe4JCFKOI54GH07C948Qu5YIpTOR49yJnRQ8rfZQNARh+2hSVrdE6DyPWNNNrtD/OxFDSVGD1GeKdc77EYTeYlRbKORLQBtKoStb9X7sQ981zY2rgTr21ucY8bYFWQQPTZN/COw7tgsQUsOeCttx6/duL0z1tU1UznVpNzqwnj+rQYxYcX8xWuAWIrF4d2P72llFulOGRDtC2PSsERLXVBGbkUWr04iesrFyA/XVsYyZKTHBsirFv11NXUqcsw/gNQSwECFAAUAAAACAAojLVc61gOiYwAAAC2AAAADwAAAAAAAAAAAAAAAAAAAAAAeGwvd29ya2Jvb2sueG1sUEsBAhQAFAAAAAgAKIy1XPE9z0JQAAAAbAAAABoAAAAAAAAAAAAAAAAAuQAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQAFAAAAAgAKIy1XNITFvbmAAAArQIAABgAAAAAAAAAAAAAAAAAQQEAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAAAwADAMsAAABdAgAAAAA=';
    const bytes = Uint8Array.from(atob(fixture), c => c.charCodeAt(0));
    const parsed = parseXLSX(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]['Company Name']).toBe('Equator');
    const mapping = autoMapHeaders(parsed.headers);
    expect(mapping['Company Name']).toBe('companyName');
    expect(mapping['Contact name']).toBe('contactName');
    expect(mapping['Company website url']).toBe('website');
    expect(mapping.Email).toBe('contactEmail');
    expect(mapping['Qualify Contact']).toBe('notes');
  });

  it('creates onboarding task after CEO review and clears it when pilot starts', () => {
    const store = new Map<string, Lead>();
    const activities: Array<{ id: string }> = [];
    const bridge: StoreBridge = {
      saveCompany: (updated) => store.set(updated.id, updated),
      addActivity: (activity) => activities.push(activity),
    };
    const base = lead({
      id: 'audit-flow',
      stage: 'trial-proposed',
      paymentStatus: 'pending',
      tasks: [{
        id: 'old-meeting-task',
        title: 'Meeting result missing',
        dueDate: new Date().toISOString(),
        completed: false,
        assignedTo: 'areeba',
        type: 'meeting-summary',
        autoGenerated: true,
        createdAt: new Date().toISOString(),
        stageFamily: 'meeting',
      }],
    });
    store.set(base.id, base);

    const setup = executeAtomicTrialSetup(base, 'abdullah', bridge, {
      approved: true,
      credentials: { username: 'admin', password: 'secret', loginUrl: 'https://brand.example' },
    });
    expect(setup.success).toBe(true);
    const ready = store.get(base.id)!;
    expect(ready.tasks.some(t => !t.completed && t.type === 'onboarding')).toBe(true);
    expect(ready.tasks.find(t => t.id === 'old-meeting-task')?.completed).toBe(true);

    const pilot = executeTrialActivation(ready, 'muneeb', bridge, 30);
    expect(pilot.success).toBe(true);
    const activePilot = store.get(base.id)!;
    expect(activePilot.tasks.filter(t => !t.completed && t.type === 'onboarding')).toHaveLength(0);
    expect(activePilot.tasks.filter(t => !t.completed && t.type === 'conversion-push')).toHaveLength(1);
  });
});
