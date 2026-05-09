/**
 * STYLIQUE CRM — Action Chain Engine
 * 
 * Every action produces a deterministic chain:
 *   1. Record what happened (activity + audit)
 *   2. Update the stage
 *   3. Generate the next required task
 *   4. Preview downstream consequences
 * 
 * No dead ends. No generic "done". Every outcome maps to a specific next step.
 */

import type { Lead, Stage, DealTask } from '@/types/crm';
import { getCanonicalState } from '@/engine/canonical-state';
import { CANONICAL_STAGE_LABELS } from '@/engine/lifecycle-engine';

// ═══════════════════════════════════════════════════════════
// CONSEQUENCE PREVIEW — shown BEFORE user commits
// ═══════════════════════════════════════════════════════════

export interface ConsequencePreview {
  /** What the CRM will record */
  record: string;
  /** What stage changes */
  stageChange: string | null;
  /** What task gets created next */
  nextTask: string | null;
  /** Who becomes the owner of the next step */
  nextOwner: string | null;
  /** What KPI gets updated */
  kpiImpact: string | null;
  /** What disappears from the current view */
  removes: string | null;
}

/**
 * For a given outcome type and lead, preview what will happen.
 * Used in popups to show "The CRM will..." before the user clicks Save.
 */
export function previewConsequences(
  lead: Lead,
  outcomeType: 'meeting' | 'call' | 'payment' | 'trial' | 'outreach',
  specificOutcome: string,
): ConsequencePreview {
  const cs = getCanonicalState(lead);
  
  switch (outcomeType) {
    case 'meeting':
      return previewMeetingConsequences(lead, specificOutcome, cs);
    case 'call':
      return previewCallConsequences(lead, specificOutcome);
    case 'payment':
      return previewPaymentConsequences(lead, specificOutcome);
    case 'trial':
      return previewTrialConsequences(lead, specificOutcome);
    case 'outreach':
      return previewOutreachConsequences(lead, specificOutcome);
    default:
      return { record: 'Action recorded', stageChange: null, nextTask: null, nextOwner: null, kpiImpact: null, removes: null };
  }
}

function previewMeetingConsequences(lead: Lead, outcome: string, cs: ReturnType<typeof getCanonicalState>): ConsequencePreview {
  switch (outcome) {
    case 'propose_trial':
      return {
        record: `Meeting outcome: moved to Client Review for ${lead.companyName}`,
        stageChange: 'Client Review',
        nextTask: `Client Review — ${lead.companyName}`,
        nextOwner: 'CEO/COO approval',
        kpiImpact: 'Counts as Client Review',
        removes: 'Meeting tasks will be archived',
      };
    case 'interested':
      return {
        record: `Meeting outcome: ${lead.contactName} is interested`,
        stageChange: 'Conversion Pending',
        nextTask: `Send pricing / proposal — ${lead.companyName}`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: 'Meeting counted toward weekly KPI',
        removes: 'Meeting prep task archived',
      };
    case 'followup_later':
      return {
        record: `Meeting outcome: Follow-up needed`,
        stageChange: 'Conversion Pending',
        nextTask: `Follow up with ${lead.contactName} — reconnect on agreed date`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: null,
        removes: null,
      };
    case 'not_fit':
    case 'lost':
      return {
        record: `Meeting outcome: ${outcome === 'not_fit' ? 'Not a fit' : 'Lost'}`,
        stageChange: 'Closed Lost',
        nextTask: null,
        nextOwner: null,
        kpiImpact: null,
        removes: 'All open tasks will be archived. Deal moves to Closed.',
      };
    case 'no_show':
      return {
        record: `${lead.contactName} did not attend the meeting`,
        stageChange: null,
        nextTask: `Follow up now — ${lead.contactName} was a no-show`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: null,
        removes: null,
      };
    case 'pending_internal':
      return {
        record: `They need time to decide internally`,
        stageChange: 'Internal Decision',
        nextTask: `Follow up on internal decision — ${lead.companyName}`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: null,
        removes: null,
      };
    case 'pricing_discussion':
      return {
        record: `They requested pricing information`,
        stageChange: 'Pricing',
        nextTask: `Send pricing / proposal — ${lead.companyName}`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: null,
        removes: null,
      };
    case 'reschedule':
      return {
        record: `Meeting rescheduled`,
        stageChange: null,
        nextTask: `Confirm rescheduled meeting — ${lead.companyName}`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: null,
        removes: null,
      };
    default:
      return { record: 'Meeting outcome recorded', stageChange: null, nextTask: null, nextOwner: null, kpiImpact: null, removes: null };
  }
}

function previewCallConsequences(lead: Lead, outcome: string): ConsequencePreview {
  switch (outcome) {
    case 'interested':
      return {
        record: `Called ${lead.contactName} — interested`,
        stageChange: ['new-lead', 'contacted', 'sdr-contacted'].includes(lead.stage) ? 'Replied' : null,
        nextTask: `Book meeting with ${lead.contactName}`,
        nextOwner: lead.assignedTo ? `${lead.assignedTo} (SDR)` : 'Current SDR',
        kpiImpact: 'Call counted + may open meeting booking',
        removes: null,
      };
    case 'no-answer':
      return {
        record: `Called ${lead.contactName} — no answer`,
        stageChange: null,
        nextTask: `Follow up ${lead.companyName} — try different channel`,
        nextOwner: null,
        kpiImpact: 'Call counted toward weekly KPI',
        removes: null,
      };
    case 'not-interested':
      return {
        record: `Called ${lead.contactName} — not interested`,
        stageChange: 'Closed Lost',
        nextTask: null,
        nextOwner: null,
        kpiImpact: null,
        removes: 'Deal will be closed. All tasks archived.',
      };
    default:
      return { record: `Call recorded for ${lead.contactName}`, stageChange: null, nextTask: 'Follow up scheduled', nextOwner: null, kpiImpact: 'Call counted', removes: null };
  }
}

function previewPaymentConsequences(lead: Lead, outcome: string): ConsequencePreview {
  switch (outcome) {
    case 'paid':
      return {
        record: `Payment confirmed — ${lead.companyName} is now a paying client`,
        stageChange: 'Active Client',
        nextTask: null,
        nextOwner: 'SDR retains ownership for retention follow-up',
        kpiImpact: 'Conversion counted. Revenue updated.',
        removes: 'Overdue/pending status cleared. Client appears in Active Clients.',
      };
    case 'reminder-sent':
      return {
        record: `Payment reminder sent to ${lead.contactName}`,
        stageChange: null,
        nextTask: `Follow up payment — ${lead.companyName} in 3 days`,
        nextOwner: null,
        kpiImpact: null,
        removes: null,
      };
    case 'lost':
      return {
        record: `${lead.companyName} will not pay — deal closed`,
        stageChange: 'Closed Lost',
        nextTask: null,
        nextOwner: null,
        kpiImpact: null,
        removes: 'All payment tasks archived. Deal moves to Closed.',
      };
    default:
      return { record: 'Payment status updated', stageChange: null, nextTask: null, nextOwner: null, kpiImpact: null, removes: null };
  }
}

function previewTrialConsequences(lead: Lead, outcome: string): ConsequencePreview {
  switch (outcome) {
    case 'approved':
      return {
        record: `Trial approved for ${lead.companyName}`,
        stageChange: null,
        nextTask: 'Onboarding can now proceed with activation',
        nextOwner: 'Muneeb (Onboarding)',
        kpiImpact: null,
        removes: 'Approval blocker cleared',
      };
    case 'activated':
      return {
        record: `Trial activated — ${lead.companyName} is now on trial`,
        stageChange: 'Trial Active',
        nextTask: `Day 2 check-in — ${lead.companyName}`,
        nextOwner: 'Muneeb (Onboarding)',
        kpiImpact: 'Trial started. 14-day countdown begins.',
        removes: 'Setup tasks archived. Trial monitoring begins.',
      };
    default:
      return { record: 'Trial update recorded', stageChange: null, nextTask: null, nextOwner: null, kpiImpact: null, removes: null };
  }
}

function previewOutreachConsequences(lead: Lead, outcome: string): ConsequencePreview {
  switch (outcome) {
    case 'interested':
      return {
        record: `${lead.contactName} expressed interest`,
        stageChange: 'Replied',
        nextTask: `Book meeting with ${lead.contactName}`,
        nextOwner: null,
        kpiImpact: 'Reply counted. Brand progress updated.',
        removes: null,
      };
    case 'replied':
      return {
        record: `${lead.contactName} replied`,
        stageChange: 'Replied',
        nextTask: `Respond to ${lead.contactName}'s reply — same day`,
        nextOwner: null,
        kpiImpact: 'Reply counted',
        removes: null,
      };
    default:
      return { record: 'Outreach recorded', stageChange: null, nextTask: 'Continue outreach sequence', nextOwner: null, kpiImpact: 'Outreach counted', removes: null };
  }
}

// ═══════════════════════════════════════════════════════════
// DEAL CONTEXT — compact summary for popups
// ═══════════════════════════════════════════════════════════

export interface DealContext {
  companyName: string;
  contactName: string;
  currentStage: string;
  currentStageLabel: string;
  owner: string;
  daysSinceContact: number;
  flowLabel: string;
  latestNote: string | null;
  riskLevel: 'none' | 'warning' | 'critical';
  riskLabel: string | null;
}

export function getDealContext(lead: Lead): DealContext {
  const cs = getCanonicalState(lead);
  const stageLabel = CANONICAL_STAGE_LABELS[lead.stage] || lead.stage;
  
  // Get latest note from action completions
  const latestAction = (lead.actionCompletions || []).sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  )[0];
  
  const flowLabels: Record<string, string> = {
    inbound: 'Inbound',
    sdr_manual: 'SDR Manual',
  };

  let riskLevel: 'none' | 'warning' | 'critical' = 'none';
  let riskLabel: string | null = null;
  if (cs.urgency === 'critical') { riskLevel = 'critical'; riskLabel = cs.status_label; }
  else if (cs.urgency === 'high') { riskLevel = 'warning'; riskLabel = cs.status_label; }

  return {
    companyName: lead.companyName,
    contactName: lead.contactName,
    currentStage: lead.stage,
    currentStageLabel: stageLabel,
    owner: lead.assignedTo || 'Unassigned',
    daysSinceContact: cs.days_since_contact,
    flowLabel: flowLabels[cs.entry_flow] || 'Unknown',
    latestNote: latestAction?.notes || latestAction?.action || null,
    riskLevel,
    riskLabel,
  };
}
