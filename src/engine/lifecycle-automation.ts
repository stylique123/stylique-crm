/**
 * STYLIQUE CRM — Lifecycle Automation Engine
 * 
 * Subscribes to CRM events and triggers deterministic next-step automation.
 * 
 * Chains:
 *   reply → book meeting task
 *   meeting booked → prep task + calendar
 *   meeting outcome = trial → approval decision item
 *   trial approved + creds → activation task
 *   trial activated → onboarding check-in chain
 *   payment confirmed → client record activated
 *   directive completed → pinned task removed from My Tasks
 * 
 * This module is the "autopilot" that ensures no dead states.
 */

import { crmEventBus, type CRMEvent } from '@/engine/event-bus';
import { toast } from 'sonner';
import { startColdSweepLoop } from '@/engine/cold-timing';

// ═══════════════════════════════════════════════════════════
// LIFECYCLE CHAIN REACTIONS
// ═══════════════════════════════════════════════════════════

function handleLifecycleEvent(event: CRMEvent) {
  switch (event.type) {
    case 'contact_reached':
      // Brand KPI check — handled by kpi-integration already
      break;

    case 'call_outcome_logged':
    case 'signal_outcome_logged':
      break;

    case 'meeting_booked':
      toast.success('Meeting booked', { duration: 2500 });
      break;

    case 'meeting_outcome_logged':
      if (event.metadata?.stageChange === 'trial-proposed') {
        toast.success('Moved to client review', { duration: 2500 });
      }
      break;

    case 'trial_approved':
      toast.success('Approved', { duration: 2500 });
      break;

    case 'credentials_added':
      toast.success('Credentials saved', { duration: 2500 });
      break;

    case 'trial_setup_completed':
      toast.success('Setup complete', { duration: 2500 });
      break;

    case 'trial_activated':
      toast.success('Client activated', { duration: 2500 });
      break;

    case 'payment_outcome_logged':
      if (event.metadata?.stageChange === 'converted') {
        toast.success(`${event.companyName} — payment verified`, { duration: 3000 });
      }
      break;

    case 'directive_sent':
      toast.success('Directive sent', { duration: 2500 });
      break;

    case 'directive_acknowledged':
      break;

    case 'directive_completed':
      toast.success('Directive completed', { duration: 2500 });
      break;

    case 'directive_blocked':
      toast.error('Directive blocked', { duration: 3000 });
      break;

    case 'lead_created':
    case 'lead_imported':
      break;

    case 'stage_changed':
      // Generic stage change awareness
      break;
  }
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION — call once at app startup
// ═══════════════════════════════════════════════════════════

let initialized = false;

export function initLifecycleAutomation() {
  if (initialized) return;
  initialized = true;
  crmEventBus.onAny(handleLifecycleEvent);
  startColdSweepLoop();
}
