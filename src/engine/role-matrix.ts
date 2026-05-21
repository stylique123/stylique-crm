/**
 * STYLIQUE CRM — Role Matrix
 * Central role-based visibility and action gating for every page/surface.
 * Single source of truth for what each role can see and do.
 */

import type { Lead } from '@/types/crm';
import { getCanonicalState } from '@/engine/canonical-state';

export type CRMRole = 'ceo' | 'coo' | 'sdr' | 'onboarding' | 'operations';

// ═══════════════════════════════════════════════════════════
// PAGE ACCESS MATRIX
// ═══════════════════════════════════════════════════════════

export type PageId =
  | 'dashboard' | 'tasks' | 'pipeline' | 'contacts'
  | 'trials' | 'payments' | 'team' | 'directives'
  | 'calendar' | 'settings';

interface PageAccess {
  canView: boolean;
  canAct: boolean;
  label: string;
  description: string;
}

const PAGE_ACCESS: Record<PageId, Record<CRMRole, PageAccess>> = {
  dashboard: {
    ceo: { canView: true, canAct: true, label: 'Command Center', description: 'Revenue, decisions, and business risk' },
    coo: { canView: true, canAct: true, label: 'Command Center', description: 'Revenue, decisions, and business risk' },
    operations: { canView: true, canAct: false, label: 'Command Center', description: 'Revenue, decisions, and business risk' },
    sdr: { canView: false, canAct: false, label: '', description: '' },
    onboarding: { canView: false, canAct: false, label: '', description: '' },
  },
  tasks: {
    ceo: { canView: true, canAct: true, label: 'Decisions', description: 'Approvals, payments, and items that need you' },
    coo: { canView: true, canAct: true, label: 'Decisions', description: 'Approvals, payments, and items that need you' },
    operations: { canView: true, canAct: false, label: 'Decisions', description: 'Approvals, payments, and items that need attention' },
    sdr: { canView: true, canAct: true, label: 'My Tasks', description: 'Your work for today' },
    onboarding: { canView: true, canAct: true, label: 'My Tasks', description: 'Setup, check-ins, and client support' },
  },
  pipeline: {
    ceo: { canView: true, canAct: false, label: 'Pipeline', description: 'All deals — view only' },
    coo: { canView: true, canAct: false, label: 'Pipeline', description: 'All deals — view only' },
    operations: { canView: true, canAct: false, label: 'Pipeline', description: 'All deals — view only' },
    sdr: { canView: true, canAct: true, label: 'My Pipeline', description: 'Your active deals' },
    onboarding: { canView: true, canAct: false, label: 'Pipeline', description: 'Trial and client records' },
  },
  trials: {
    ceo: { canView: true, canAct: true, label: 'Trials', description: 'Approvals and trial oversight' },
    coo: { canView: true, canAct: true, label: 'Trials', description: 'Approvals and trial oversight' },
    operations: { canView: true, canAct: false, label: 'Pilots', description: 'Pilot oversight — view only' },
    sdr: { canView: true, canAct: false, label: 'Trials', description: 'Your trial progress — view only' },
    onboarding: { canView: true, canAct: true, label: 'Trials', description: 'Setup, credentials, and activation' },
  },
  payments: {
    ceo: { canView: true, canAct: true, label: 'Approvals', description: 'Review, payment verification, and client health' },
    coo: { canView: true, canAct: true, label: 'Approvals', description: 'Review, payment verification, and client health' },
    operations: { canView: true, canAct: false, label: 'Payments', description: 'Payment and client health — view only' },
    sdr: { canView: true, canAct: false, label: 'Clients', description: 'Your conversions — view only' },
    onboarding: { canView: true, canAct: false, label: 'Clients', description: 'Client status — view only' },
  },
  team: {
    ceo: { canView: true, canAct: true, label: 'Team Performance', description: 'Attendance, KPI, leave, compensation, and team management' },
    coo: { canView: true, canAct: true, label: 'Team Performance', description: 'Attendance, KPI, leave, compensation, and team management' },
    operations: { canView: true, canAct: false, label: 'Team Performance', description: 'Attendance, KPI, and leave — view only' },
    sdr: { canView: true, canAct: false, label: 'My Performance', description: 'Your attendance, KPI, and leave' },
    onboarding: { canView: true, canAct: false, label: 'My Performance', description: 'Your attendance, KPI, and leave' },
  },
  directives: {
    ceo: { canView: true, canAct: true, label: 'Directives', description: 'Track priorities sent to your team' },
    coo: { canView: true, canAct: true, label: 'Directives', description: 'Track priorities sent to your team' },
    operations: { canView: true, canAct: false, label: 'Directives', description: 'Priorities — view only' },
    sdr: { canView: true, canAct: true, label: 'Directives', description: 'Priorities from leadership' },
    onboarding: { canView: true, canAct: true, label: 'Directives', description: 'Priorities from leadership' },
  },
  contacts: {
    ceo: { canView: true, canAct: false, label: 'Contacts', description: 'All contacts' },
    coo: { canView: true, canAct: false, label: 'Contacts', description: 'All contacts' },
    operations: { canView: true, canAct: false, label: 'Contacts', description: 'All contacts' },
    sdr: { canView: true, canAct: true, label: 'My Contacts', description: 'Your contacts' },
    onboarding: { canView: true, canAct: false, label: 'Contacts', description: 'Contact directory' },
  },
  calendar: {
    ceo: { canView: true, canAct: false, label: 'Calendar', description: 'All meetings' },
    coo: { canView: true, canAct: false, label: 'Calendar', description: 'All meetings' },
    operations: { canView: true, canAct: false, label: 'Calendar', description: 'All meetings' },
    sdr: { canView: true, canAct: true, label: 'My Calendar', description: 'Your meetings' },
    onboarding: { canView: true, canAct: true, label: 'My Calendar', description: 'Your check-ins' },
  },
  settings: {
    ceo: { canView: true, canAct: true, label: 'Settings', description: 'System configuration' },
    coo: { canView: true, canAct: true, label: 'Settings', description: 'System configuration' },
    operations: { canView: true, canAct: false, label: 'Settings', description: 'System configuration — view only' },
    sdr: { canView: false, canAct: false, label: '', description: '' },
    onboarding: { canView: false, canAct: false, label: '', description: '' },
  },
};

export function getPageAccess(page: PageId, role: CRMRole): PageAccess {
  return PAGE_ACCESS[page]?.[role] || { canView: false, canAct: false, label: '', description: '' };
}

// ═══════════════════════════════════════════════════════════
// LEADERSHIP LANGUAGE — exception-focused copy for CEO/COO
// ═══════════════════════════════════════════════════════════

export function getLeadershipLabel(lead: Lead): { label: string; detail: string; urgencyColor: string } {
  const cs = getCanonicalState(lead);
  const ownerName = lead.assignedTo ? (lead.assignedTo.charAt(0).toUpperCase() + lead.assignedTo.slice(1)) : '—';

  // Payment overdue
  if (cs.commercial_stage === 'overdue') {
    return {
      label: `Payment overdue — ${lead.companyName}`,
      detail: `$${cs.mrr} · ${ownerName} owns · Revenue at risk`,
      urgencyColor: 'text-destructive',
    };
  }

  // Trial expired
  if (cs.trial_stage === 'expired') {
    return {
      label: `Trial expired — ${lead.companyName}`,
      detail: `${ownerName} owns · Conversion at risk`,
      urgencyColor: 'text-destructive',
    };
  }

  // Decision due soon
  if (cs.trial_stage === 'ending') {
    const dl = cs.days_since_contact; // approximate
    return {
      label: `Decision due — ${lead.companyName}`,
      detail: `${ownerName} owns · Decision needed`,
      urgencyColor: 'text-destructive',
    };
  }

  // Needs approval
  if (['needs_approval', 'needs_approval_and_credentials'].includes(cs.trial_stage)) {
    return {
      label: `Client Review — ${lead.companyName}`,
      detail: `${ownerName} requested · Waiting on your approval`,
      urgencyColor: 'text-warning',
    };
  }

  // Payment pending
  if (cs.commercial_stage === 'payment_pending') {
    return {
      label: `Confirm payment — ${lead.companyName}`,
      detail: `$${cs.mrr}/mo · ${ownerName} owns`,
      urgencyColor: 'text-warning',
    };
  }

  // Ready to activate
  if (cs.trial_stage === 'ready_to_activate') {
    return {
      label: `Ready to activate — ${lead.companyName}`,
      detail: `Approved + credentials ready · Onboarding will activate`,
      urgencyColor: 'text-primary',
    };
  }

  // Approved but credentials missing — canonical leadership label
  if (cs.trial_stage === 'needs_credentials') {
    return {
      label: `Ready to start — blocked by missing credentials — ${lead.companyName}`,
      detail: `Approved · activation waiting on credentials`,
      urgencyColor: 'text-warning',
    };
  }

  // Churn risk
  if (cs.lifecycle_stage === 'converted' && cs.days_since_contact >= 30) {
    return {
      label: `No contact in ${cs.days_since_contact}d — ${lead.companyName}`,
      detail: `${ownerName} owns · Churn risk`,
      urgencyColor: 'text-warning',
    };
  }

  return {
    label: lead.companyName,
    detail: `${cs.next_action_label} · ${ownerName}`,
    urgencyColor: 'text-muted-foreground',
  };
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING LANGUAGE — setup-focused copy
// ═══════════════════════════════════════════════════════════

export function getOnboardingLabel(lead: Lead): { label: string; detail: string } {
  const cs = getCanonicalState(lead);

  if (cs.trial_stage === 'needs_credentials' || cs.trial_stage === 'needs_approval_and_credentials') {
    // Muneeb cannot add credentials — display as waiting only.
    return { label: `Waiting for credentials — ${lead.companyName}`, detail: 'Activation blocked until credentials received' };
  }
  if (cs.trial_stage === 'ready_to_activate') {
    return { label: `Activate trial — ${lead.companyName}`, detail: 'Credentials ready, start the trial' };
  }
  if (cs.trial_stage === 'active') {
    return { label: `Onboarding active — ${lead.companyName}`, detail: 'Check activation progress' };
  }
  if (cs.trial_stage === 'ending') {
    return { label: `Decision due — ${lead.companyName}`, detail: 'Decision pending' };
  }
  if (cs.trial_stage === 'needs_approval') {
    return { label: `Awaiting approval — ${lead.companyName}`, detail: 'CEO/COO approval pending' };
  }

  return { label: lead.companyName, detail: cs.next_action_label || 'Monitoring' };
}

// ═══════════════════════════════════════════════════════════
// DIRECTIVE TYPE EXPANSION
// ═══════════════════════════════════════════════════════════

export const DIRECTIVE_TYPES_BY_ROLE: Record<CRMRole, string[]> = {
  ceo: ['call_now', 'book_meeting', 'push_conversion', 'confirm_payment', 'approve_trial', 'escalate_update', 'review_blocker', 'review_queue'],
  coo: ['call_now', 'book_meeting', 'push_conversion', 'confirm_payment', 'approve_trial', 'escalate_update', 'review_blocker', 'review_queue'],
  operations: [],
  sdr: [],
  onboarding: [],
};

// ═══════════════════════════════════════════════════════════
// TEAM PERFORMANCE SECTIONS BY ROLE
// ═══════════════════════════════════════════════════════════

export type TeamSection = 'my_attendance' | 'my_kpi' | 'my_leave' |
  'team_attendance' | 'team_kpi' | 'team_leave' | 'people' | 'audit';

export function getTeamSections(role: CRMRole): TeamSection[] {
  switch (role) {
    case 'ceo':
    case 'coo':
      return ['team_attendance', 'team_kpi', 'team_leave', 'people', 'audit'];
    case 'operations':
      return ['team_attendance', 'team_kpi', 'team_leave', 'people', 'audit'];
    case 'sdr':
    case 'onboarding':
      return ['my_attendance', 'my_kpi', 'my_leave'];
    default:
      return [];
  }
}
