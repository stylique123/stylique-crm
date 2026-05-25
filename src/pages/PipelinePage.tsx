/**
 * STYLIQUE CRM — Pipeline Page (Canonical Lifecycle View)
 *
 * ONE Pipeline page with TWO views: SDR Flow and Inbound.
 * Each view has its own stage columns matching real business logic.
 * Drag-and-drop with outcome validation + tap-to-move mobile fallback.
 */

import { useState, useMemo, useCallback, DragEvent } from 'react';
import { useUser } from '@/lib/user-context';
import { useCompanyStore } from '@/lib/company-store';
import { Lead, TEAM_MEMBERS, InboundType, recalculateNextAction, hasValidCredentials, getLeadContacts } from '@/types/crm';
import {
  getCanonicalState, deriveScenarioContext,
  type CanonicalState, type LifecycleStage, type ViewerRole,
  canCurrentRoleAct, getReadOnlyStatusLabel, FLOW_LABELS, SOURCE_LABELS,
} from '@/engine/canonical-state';
import { processMeetingOutcome, processPaymentOutcome, processCallOutcome } from '@/engine/outcome-engine';
import { executeMeetingBooked, executeAtomicTrialSetup, executeCredentialsSave, commitLeadMutation } from '@/engine/action-executor';
import { archiveStaleTasksForStage } from '@/engine/task-engine';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { MeetingOutcomeDialog, type MeetingOutcome } from '@/components/MeetingOutcomeDialog';
import { MeetingBookingDialog, type MeetingBooking } from '@/components/MeetingBookingDialog';
import { StageTransitionDialog, type TransitionType, type TransitionResult } from '@/components/StageTransitionDialog';
import { SDROutreachEntryDialog } from '@/components/SDROutreachEntryDialog';
import { SDRSignalDialog } from '@/components/SDRSignalDialog';
import { StageMoveSheet } from '@/components/StageMoveSheet';
import { CallLogDialog, type CallLog } from '@/components/CallLogDialog';
import { CredentialsDialog } from '@/components/CredentialsDialog';
import { TrialSetupDialog, type TrialSetupResult } from '@/components/TrialSetupDialog';
import { PaymentOutcomeDialog, type PaymentOutcome } from '@/components/PaymentOutcomeDialog';
import {
  evaluateSDRTrigger,
  processOutreachEntry,
  processLinkedInAccepted,
  processCallOutcomeSDR,
  processInstagramDM,
  processLinkedInPending,
  processReplyReceived,
  generateSDRTask,
  getSDRSequenceState,
  type SDRTriggerType,
  type OutreachEntryResult,
  type CallOutcomeSDR,
  type InstagramDMOutcome,
  type LinkedInMessageOutcome,
  type LinkedInPendingOutcome,
  type ReplyClassificationSDR,
} from '@/engine/sdr-flow-engine';
import { emitKPI, getBrandProgress } from '@/engine/kpi-integration';
import { BrandProgressBadge } from '@/components/BrandProgressBadge';
import { resolveAction, type ResolvedAction } from '@/engine/action-router';
import {
  isNewLeadStage, isMeetingBookedStage, isMeetingCompletedStage,
  isTrialProposedStage,
} from '@/engine/stage-aliases';
import { AddLeadDialog } from '@/components/AddLeadDialog';
import { CSVImportDialog } from '@/components/CSVImportDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { createMicrosoftTeamsEvent } from '@/services/calendar-service';
import {
  User, ArrowRight, Clock, Inbox, Target, GitBranch, Plus,
  Globe, MapPin, GripVertical, ChevronRight, Upload,
} from 'lucide-react';

// ── View & filter types ───────────────────────────────────
type PipelineView = 'sdr_flow' | 'inbound';
type SdrSubFilter = 'all';
type InboundSubFilter = 'all' | 'website_demo' | 'manual_inbound';

const PIPELINE_VIEWS: { key: PipelineView; label: string; icon: typeof GitBranch }[] = [
  { key: 'sdr_flow', label: 'SDR Flow', icon: Target },
  { key: 'inbound', label: 'Inbound', icon: Inbox },
];

const SDR_SUB_FILTERS: { key: SdrSubFilter; label: string }[] = [
  { key: 'all', label: 'All SDR' },
];

const INBOUND_SUB_FILTERS: { key: InboundSubFilter; label: string }[] = [
  { key: 'all', label: 'All Inbound' },
  { key: 'website_demo', label: 'Website Demo' },
  { key: 'manual_inbound', label: 'Manual Inbound' },
];

// ── Column definitions per view ───────────────────────────
interface ColumnDef { key: string; label: string; description: string }

// SDR Pipeline = 6 commercial lanes (canonical post-cleanup).
//
// Removed lanes (folded into adjacent stages):
//   • Internal Decision  → folded into Meeting Booked (post-meeting follow-up)
//   • Pricing            → folded into Meeting Booked (post-meeting follow-up)
//   • Trial Active       → off-pipeline; lives on /trials
//   • Active Client      → off-pipeline; lives on /clients (onboarding) / /payments
//
// 'Trial Pending Decision' is the SINGLE post-meeting pre-trial lane,
// covering both "trial under consideration" and "trial proposed for approval"
// (canonical stage: trial-proposed).
const SDR_COLUMNS: ColumnDef[] = [
  { key: 'new_lead', label: 'New Lead', description: 'No outreach yet' },
  { key: 'contacted', label: 'Contacted', description: 'No response yet' },
  { key: 'replied', label: 'Replied', description: 'Conversation exists' },
  { key: 'meeting_booked', label: 'Meeting Scheduled', description: 'Meeting booked' },
  { key: 'meeting_completed', label: 'Meeting Done', description: 'Meeting result missing' },
  { key: 'decision_pending', label: 'Decision Pending', description: 'Awaiting decision' },
  { key: 'client_review', label: 'Moved to Client Review', description: 'Leadership owns this' },
  { key: 'pilot', label: 'Pilot', description: 'Paid pilot' },
  { key: 'cold', label: 'Cold', description: 'Recoverable' },
  { key: 'closed', label: 'Closed Lost', description: 'Final SDR loss' },
];

const INBOUND_COLUMNS: ColumnDef[] = [
  { key: 'new_inquiry', label: 'New Inquiry', description: 'Inbound lead received' },
  { key: 'contacted', label: 'Contacted', description: 'No response yet' },
  { key: 'replied', label: 'Replied', description: 'Conversation exists' },
  { key: 'meeting_booked', label: 'Meeting Scheduled', description: 'Meeting booked' },
  { key: 'meeting_completed', label: 'Meeting Done', description: 'Meeting result missing' },
  { key: 'decision_pending', label: 'Decision Pending', description: 'Awaiting decision' },
  { key: 'client_review', label: 'Moved to Client Review', description: 'Leadership owns this' },
  { key: 'pilot', label: 'Pilot', description: 'Paid pilot' },
  { key: 'cold', label: 'Cold', description: 'Recoverable' },
  { key: 'closed', label: 'Closed Lost', description: 'Final SDR loss' },
];

const FLOW_ICONS: Record<string, typeof Target> = {
  inbound: Inbox, sdr_manual: Target,
};

const INBOUND_TYPE_LABELS: Record<string, string> = {
  direct_book_demo: 'Website Demo',
  manual_inbound: 'Manual Inbound',
};

// ── Map leads to column keys per view ─────────────────────
function getColumnKey(cs: CanonicalState, lead: Lead, view: PipelineView): string {
  if (view === 'inbound') {
    if (cs.inbound_stage === 'new_inquiry') return 'new_inquiry';
    if (cs.inbound_stage === 'qualified' || cs.inbound_stage === 'awaiting_sdr') return 'contacted';
    if (cs.inbound_stage === 'meeting_booked') return 'meeting_booked';
    if (cs.inbound_stage === 'disqualified') return 'closed';
    if (cs.inbound_stage === 'handed_to_sales') {
      // Map to commercial stage
      if (cs.lifecycle_stage === 'replied') return 'replied';
      if (cs.lifecycle_stage === 'meeting_completed') return 'meeting_completed';
      if (cs.lifecycle_stage === 'internal_decision' || cs.lifecycle_stage === 'pricing_discussion') return 'decision_pending';
      if (cs.lifecycle_stage === 'trial_active') return 'pilot';
      if (cs.lifecycle_stage === 'trial_proposed' || cs.lifecycle_stage === 'trial_ready' || cs.lifecycle_stage === 'conversion_pending') return 'client_review';
      if (cs.lifecycle_stage === 'converted') return 'client_review';
      return 'meeting_completed';
    }
    return 'new_inquiry';
  }

  // SDR Flow — collapse to 8 canonical lanes.
  const stage = cs.lifecycle_stage;
  // Cold is its own visible lane.
  if (stage === 'cold_no_response') return 'cold';
  // Closed Lost (folds in unsubscribed / lost / disqualified).
  if (stage === 'unsubscribed' || stage === 'lost' || stage === 'closed') return 'closed';
  // Moved to Client Review — leadership-owned handoff stage.
  if (stage === 'trial_active') return 'pilot';
  if (stage === 'trial_proposed' || stage === 'trial_ready') return 'client_review';
  // Decision Pending — post-meeting follow-up still owned by SDR.
  if (stage === 'internal_decision' || stage === 'pricing_discussion') return 'decision_pending';
  if (stage === 'meeting_completed') return 'meeting_completed';
  if (stage === 'meeting_booked') return 'meeting_booked';
  // Converted / Awaiting Payment live on Clients/Payments — off pipeline.
  if (stage === 'converted' || stage === 'conversion_pending') return '__off_pipeline__';
  return stage;
}

function getCardReminder(lead: Lead, cs: CanonicalState, view: PipelineView): string {
  if (view === 'inbound') return SOURCE_LABELS[cs.source_channel] || FLOW_LABELS[cs.entry_flow] || 'Inbound';
  const col = getColumnKey(cs, lead, view);
  if (col === 'new_lead') return 'No outreach yet';
  if (col === 'contacted') return 'No response yet';
  if (col === 'replied') {
    const notes = lead.notes?.split('\n').filter(Boolean) || [];
    return notes[notes.length - 1]?.replace(/^\[[^\]]+\]\s*/, '') || 'Reply received';
  }
  if (col === 'meeting_booked') return getMeetingBookedSubState(lead) === 'result_needed' ? 'Meeting result missing' : 'Meeting scheduled';
  if (col === 'meeting_completed') return 'Meeting result missing';
  if (col === 'decision_pending') return 'Awaiting decision';
  if (col === 'client_review') return 'Leadership owns this';
  if (col === 'pilot') return lead.nextAction || 'Pilot active';
  if (col === 'cold') return 'Cold';
  if (col === 'closed') return 'Closed lost';
  return cs.next_action_label || '';
}

// ── Meeting Booked sub-state (per pipeline-kanban memory) ──
// "Scheduled" — meeting is on the calendar in the future.
// "Prep due"  — meeting is within next 24h and prep task isn't done.
// "Result needed" — meeting time has passed and outcome is not logged.
type MeetingSubState = 'scheduled' | 'prep_due' | 'result_needed' | null;
function getMeetingBookedSubState(lead: Lead): MeetingSubState {
  if (isMeetingCompletedStage(lead.stage)) return 'result_needed';
  const meetings = lead.meetings || [];
  const next = meetings
    .filter(m => m.status === 'scheduled' || m.status === 'rescheduled')
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
  if (!next) return isMeetingBookedStage(lead.stage) ? 'scheduled' : null;
  const t = new Date(next.scheduled_at).getTime();
  if (!Number.isFinite(t)) return 'scheduled';
  const now = Date.now();
  if (t < now) return 'result_needed';
  if (t - now <= 24 * 60 * 60 * 1000) return 'prep_due';
  return 'scheduled';
}

// ── View filter logic ─────────────────────────────────────
function matchesView(cs: CanonicalState, lead: Lead, view: PipelineView, sdrSub: SdrSubFilter, inboundSub: InboundSubFilter): boolean {
  if (view === 'inbound') {
    if (cs.entry_flow !== 'inbound') return false;
    if (inboundSub === 'all') return true;
    const type = lead.inbound_type;
    if (inboundSub === 'website_demo') return type === 'direct_book_demo';
    if (inboundSub === 'manual_inbound') return type === 'manual_inbound';
    return true;
  }
  if (view === 'sdr_flow') {
    if (cs.entry_flow !== 'sdr_manual') return false;
    // Hide post-handoff commercial records — they live on /clients and /payments.
    if (cs.lifecycle_stage === 'converted'
      || cs.lifecycle_stage === 'conversion_pending') return false;
    return true;
  }
  return true;
}

// ── Deal Card ─────────────────────────────────────────────
function DealCard({
  lead, cs, viewerRole, currentUser, onSelect, view,
}: {
  lead: Lead; cs: CanonicalState; viewerRole: ViewerRole; currentUser: string;
  onSelect: (l: Lead) => void; view: PipelineView;
}) {
  const owner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);
  const isActionable = canCurrentRoleAct(lead, viewerRole, currentUser);
  const readOnlyLabel = !isActionable ? getReadOnlyStatusLabel(lead, viewerRole) : null;
  const reminder = readOnlyLabel || getCardReminder(lead, cs, view);
  // Show Meeting Booked sub-state badge so cards in that lane carry their
  // exclusive sub-state (Scheduled / Prep due / Result needed).
  // Use alias helpers, not raw stage equality, so legacy aliases also resolve.
  const inMeetingLane = isMeetingBookedStage(lead.stage) || isMeetingCompletedStage(lead.stage);
  const meetingSubState = inMeetingLane ? getMeetingBookedSubState(lead) : null;

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'p-3 transition-all w-full min-w-0 cursor-pointer border bg-card/70 hover:bg-card hover:border-primary/30 hover:shadow-sm',
        !isActionable && 'opacity-55',
        cs.urgency === 'critical' && isActionable && 'border-l-[3px] border-l-destructive/60',
      )}
      onClick={() => onSelect(lead)}
    >
      <div className="space-y-1.5 min-w-0">
        {/* Company name */}
        <div className="flex items-center gap-1.5 min-w-0">
          <GripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0 hidden sm:block" />
          <p className="text-[13px] font-semibold truncate min-w-0 flex-1 text-foreground">{lead.companyName}</p>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/35 shrink-0" />
        </div>

        {/* Owner, contact, source */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-0.5">
            <User className="h-2.5 w-2.5 shrink-0" /> {owner?.name?.split(' ')[0] || '—'}
          </span>
          <span className="truncate max-w-[120px]">{lead.contactName}</span>
          {view === 'inbound' && lead.inbound_type && (
            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-dashed">
              {INBOUND_TYPE_LABELS[lead.inbound_type] || lead.inbound_type}
            </Badge>
          )}
          {meetingSubState && (
            <Badge
              variant="outline"
              className={cn(
                'text-[8px] h-3.5 px-1 border-dashed',
                meetingSubState === 'result_needed'
                  ? 'border-destructive/40 text-destructive bg-destructive/5'
                  : meetingSubState === 'prep_due'
                  ? 'border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))] bg-[hsl(var(--warning))]/5'
                  : 'border-primary/30 text-primary/80 bg-primary/5'
              )}
            >
              {meetingSubState === 'result_needed' ? 'Result needed'
                : meetingSubState === 'prep_due' ? 'Prep due'
                : 'Scheduled'}
            </Badge>
          )}
        </div>

        {/* Quiet state line */}
        {reminder && (
          <p className={cn(
            "text-[11px] flex items-center gap-1 leading-snug",
            readOnlyLabel
              ? "text-muted-foreground/70 italic"
              : "text-foreground/80"
          )}>
            {readOnlyLabel ? (
              <Clock className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
            ) : (
              <ArrowRight className="h-2.5 w-2.5 shrink-0 text-primary/70" />
            )}
            <span className="truncate">{reminder.length > 45 ? reminder.slice(0, 43) + '...' : reminder}</span>
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────
export default function PipelinePage() {
  const { companies, refresh, saveCompany, addActivity } = useCompanyStore();
  const { currentUser, role, isSdr } = useUser();
  const viewerRole: ViewerRole = role === 'ceo' || role === 'coo' || role === 'operations' ? role : role === 'onboarding' ? 'onboarding' : 'sdr';
  const bridge = useMemo(() => ({ saveCompany, addActivity }), [saveCompany, addActivity]);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activeView, setActiveView] = useState<PipelineView>('sdr_flow');
  const [sdrSubFilter, setSdrSubFilter] = useState<SdrSubFilter>('all');
  const [inboundSubFilter, setInboundSubFilter] = useState<InboundSubFilter>('all');
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Meeting outcome dialog
  const [meetingOutcomeOpen, setMeetingOutcomeOpen] = useState(false);
  const [meetingOutcomeLead, setMeetingOutcomeLead] = useState<Lead | null>(null);

  // Meeting booking dialog
  const [meetingBookingOpen, setMeetingBookingOpen] = useState(false);
  const [meetingBookingLead, setMeetingBookingLead] = useState<Lead | null>(null);

  // Stage transition dialog (for contacted, replied, trial_proposed, closed)
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionType, setTransitionType] = useState<TransitionType>('to_contacted');
  const [transitionLead, setTransitionLead] = useState<Lead | null>(null);
  const [transitionTargetStage, setTransitionTargetStage] = useState<string>('');

  // SDR Day 1 Entry dialog
  const [outreachEntryOpen, setOutreachEntryOpen] = useState(false);
  const [outreachEntryLead, setOutreachEntryLead] = useState<Lead | null>(null);

  // SDR Signal dialog
  const [signalDialogOpen, setSignalDialogOpen] = useState(false);
  const [signalDialogLead, setSignalDialogLead] = useState<Lead | null>(null);
  const [signalTriggerType, setSignalTriggerType] = useState<SDRTriggerType>('no_trigger');
  const [signalTitle, setSignalTitle] = useState('');
  const [signalReason, setSignalReason] = useState('');

  // Call dialog
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callLead, setCallLead] = useState<Lead | null>(null);

  // Credentials dialog
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentialsLead, setCredentialsLead] = useState<Lead | null>(null);

  // Trial setup dialog
  const [trialSetupOpen, setTrialSetupOpen] = useState(false);
  const [trialSetupLead, setTrialSetupLead] = useState<Lead | null>(null);

  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLead, setPaymentLead] = useState<Lead | null>(null);

  // Drag state
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Stage move sheet (mobile tap-to-move)
  const [stageMoveOpen, setStageMoveOpen] = useState(false);
  const [stageMoveLead, setStageMoveLead] = useState<Lead | null>(null);
  const [stageMoveColumnKey, setStageMoveColumnKey] = useState('');

  // CTA button on pipeline card → route to correct modal based on canonical action router
  const handleCTAClick = useCallback((lead: Lead, action: ResolvedAction) => {
    switch (action.intent) {
      case 'outreach_start':
        // HARD GATE: 2-contact precondition for active outreach.
        {
          const bp = getBrandProgress(lead);
          if (bp.contactsTotal < 2) {
            toast.error(`Add a 2nd contact to ${lead.companyName} before starting outreach`);
            setSelectedLead(lead);
            break;
          }
        }
        setOutreachEntryLead(lead);
        setOutreachEntryOpen(true);
        break;
      case 'sdr_signal':
        if (action.triggerType && action.triggerType !== 'no_trigger') {
          setSignalDialogLead(lead);
          setSignalTriggerType(action.triggerType);
          setSignalTitle(action.triggerTitle || '');
          setSignalReason(action.triggerReason || '');
          setSignalDialogOpen(true);
        }
        break;
      case 'book_meeting':
        setMeetingBookingLead(lead);
        setMeetingBookingOpen(true);
        break;
      case 'log_meeting_outcome':
        setMeetingOutcomeLead(lead);
        setMeetingOutcomeOpen(true);
        break;
      case 'approve_trial':
      case 'trial_setup':
        setTrialSetupLead(lead);
        setTrialSetupOpen(true);
        break;
      case 'add_credentials':
        setCredentialsLead(lead);
        setCredentialsOpen(true);
        break;
      case 'confirm_payment':
        setPaymentLead(lead);
        setPaymentOpen(true);
        break;
      case 'call':
      case 'conversion_push':
        setCallLead(lead);
        setCallDialogOpen(true);
        break;
      default:
        setSelectedLead(lead);
    }
  }, []);

  // Route a stage move to the correct modal
  const handleMoveToStage = useCallback((lead: Lead, targetColumnKey: string) => {
    // Reuse the same logic as handleDrop, but triggered from StageMoveSheet
    const COLUMN_TO_STAGE: Record<string, string> = {
      new_lead: 'sdr-new-lead', contacted: 'sdr-contacted', replied: 'sdr-replied',
      meeting_booked: 'meeting-booked', meeting_completed: 'meeting-completed',
      decision_pending: 'internal-decision', internal_decision: 'internal-decision', pricing_discussion: 'pricing-discussion',
      trial_proposed: 'trial-proposed', client_review: 'trial-proposed', trial_active: 'trial-active', pilot: 'trial-active',
      converted: 'converted', closed: 'closed-lost', cold: 'cold-no-response',
      new_inquiry: 'inbound-new', qualified: 'inbound-qualified', awaiting_sdr: 'inbound-awaiting-sdr',
    };
    const newStage = COLUMN_TO_STAGE[targetColumnKey];
    if (!newStage) { toast.error('Move not allowed'); return; }

    // Meeting Completed → outcome dialog
    if (targetColumnKey === 'meeting_completed') {
      setMeetingOutcomeLead(lead);
      setMeetingOutcomeOpen(true);
      return;
    }

    // Meeting Booked → booking dialog
    if (targetColumnKey === 'meeting_booked') {
      setMeetingBookingLead(lead);
      setMeetingBookingOpen(true);
      return;
    }

    // Contacted (SDR new lead) → Day 1 Entry
    if (targetColumnKey === 'contacted' && activeView === 'sdr_flow') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_contacted');
      setTransitionOpen(true);
      return;
    }

    // Qualified / Awaiting SDR (inbound)
    if (targetColumnKey === 'qualified' || targetColumnKey === 'awaiting_sdr') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_contacted');
      setTransitionOpen(true);
      return;
    }

    // Replied → classification
    if (targetColumnKey === 'replied') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_replied');
      setTransitionOpen(true);
      return;
    }

    // Trial Proposed → trial details
    if (targetColumnKey === 'trial_proposed' || targetColumnKey === 'client_review') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_trial_proposed');
      setTransitionOpen(true);
      return;
    }

    // Decision Pending → one note, SDR still owns it.
    if (targetColumnKey === 'decision_pending') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_internal_decision');
      setTransitionOpen(true);
      return;
    }

    // Closed/Lost → reason
    if (targetColumnKey === 'closed') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_closed');
      setTransitionOpen(true);
      return;
    }

    if (targetColumnKey === 'pilot') {
      toast.info('Pilot starts after onboarding verifies');
      setSelectedLead(lead);
      return;
    }

    // Converted → guard
    if (targetColumnKey === 'converted') {
      toast.error('Requires payment confirmation');
      setSelectedLead(lead);
      return;
    }

    // Fallback — canonical mutation path
    const _now = new Date().toISOString();
    const updated = { ...lead, stage: newStage as Lead['stage'], updatedAt: _now };
    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(), leadId: lead.id, type: 'stage-change',
          description: `Stage moved to ${targetColumnKey.replace(/_/g, ' ')}`,
          createdAt: _now, createdBy: currentUser,
        },
        refresh,
      },
    );
    toast.success(`Moved to ${targetColumnKey.replace(/_/g, ' ')}`);
  }, [activeView, saveCompany, addActivity, refresh, currentUser]);

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
  };

  // Day 1 Entry handler
  const handleOutreachEntrySubmit = useCallback((result: OutreachEntryResult) => {
    if (!outreachEntryLead) return;
    const now = new Date().toISOString();
    
    // Process Day 1 entry
    processOutreachEntry(outreachEntryLead.id, result);
    
    // Move lead to contacted if email started
    const newStage = result.email1_started ? 'sdr-contacted' : outreachEntryLead.stage;
    
    // Create next task
    const trigger = evaluateSDRTrigger(outreachEntryLead);
    const nextTask = generateSDRTask(outreachEntryLead, trigger, outreachEntryLead.assignedTo);
    
    // Archive stale tasks before adding new ones
    const archivedTasks = archiveStaleTasksForStage(outreachEntryLead.tasks || [], newStage);
    let updated: Lead = {
      ...outreachEntryLead,
      stage: newStage as Lead['stage'],
      updatedAt: now,
      lastContactedAt: result.email1_started ? now : outreachEntryLead.lastContactedAt,
      lastEmailAt: result.email1_started ? now : outreachEntryLead.lastEmailAt,
      lastLinkedinAt: result.linkedin_sent ? now : outreachEntryLead.lastLinkedinAt,
      tasks: nextTask ? [...archivedTasks, nextTask] : archivedTasks,
    };

    const intel = recalculateNextAction(updated);
    updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

    // KPI emits preserved at original position (pre-refresh)
    if (result.email1_started) {
      emitKPI(currentUser, outreachEntryLead, outreachEntryLead.contactName, 'emails_sent', 'email', 'day1_email', { dedupeBucket: 'day1' });
    }
    if (result.linkedin_sent) {
      emitKPI(currentUser, outreachEntryLead, outreachEntryLead.contactName, 'linkedin_actions', 'linkedin', 'day1_linkedin', { dedupeBucket: 'day1' });
    }

    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(), leadId: outreachEntryLead.id, type: 'action-completed',
          description: `Outreach started — ${result.email1_started ? 'email sent' : 'email blocked'} · ${result.linkedin_sent ? 'LinkedIn sent' : 'LinkedIn blocked'}`,
          createdAt: now, createdBy: currentUser,
          metadata: { channel: 'system' },
        },
        refresh,
      },
    );
    setOutreachEntryOpen(false);
    setOutreachEntryLead(null);
    
    toast.success(`${outreachEntryLead.companyName} — outreach started`);
  }, [outreachEntryLead, saveCompany, addActivity, refresh, currentUser]);

  // SDR Signal outcome handler
  const handleSignalOutcome = useCallback((outcome: string, notes: string) => {
    if (!signalDialogLead) return;
    const now = new Date().toISOString();

    // Process based on trigger type
    switch (signalTriggerType) {
      case 'linkedin_accepted':
        processLinkedInAccepted(signalDialogLead.id, outcome as LinkedInMessageOutcome);
        break;
      case 'warm_open_signal':
      case 'day5_no_response':
        processCallOutcomeSDR(signalDialogLead.id, outcome as CallOutcomeSDR);
        break;
      case 'post_call_no_response':
        processInstagramDM(signalDialogLead.id, outcome as InstagramDMOutcome);
        break;
      case 'linkedin_pending':
        processLinkedInPending(signalDialogLead.id, outcome as LinkedInPendingOutcome);
        break;
      case 'reply_received':
        processReplyReceived(signalDialogLead.id, outcome as ReplyClassificationSDR);
        break;
    }

    // Re-evaluate trigger to generate next task
    const newTrigger = evaluateSDRTrigger(signalDialogLead);
    const nextTask = generateSDRTask(signalDialogLead, newTrigger, signalDialogLead.assignedTo);

    // Stage updates based on outcomes
    let stageUpdate: Partial<Lead> = {};
    if (outcome === 'interested' && (signalTriggerType === 'warm_open_signal' || signalTriggerType === 'day5_no_response' || signalTriggerType === 'reply_received')) {
      stageUpdate = { stage: 'sdr-replied' as Lead['stage'] };
    }

    // Archive stale tasks before adding new ones
    const archivedTasks = archiveStaleTasksForStage(signalDialogLead.tasks || [], stageUpdate.stage || signalDialogLead.stage);
    let updated: Lead = {
      ...signalDialogLead,
      ...stageUpdate,
      updatedAt: now,
      tasks: nextTask ? [...archivedTasks, nextTask] : archivedTasks,
    };

    const intel = recalculateNextAction(updated);
    updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(), leadId: signalDialogLead.id,
          type: signalTriggerType === 'warm_open_signal' || signalTriggerType === 'day5_no_response' ? 'twilio_call_outcome_logged'
            : signalTriggerType === 'linkedin_accepted' ? 'linkedin_outreach_logged'
            : signalTriggerType === 'post_call_no_response' ? 'instagram_outreach_logged'
            : 'action-completed',
          description: `${signalTitle}: ${outcome.replace(/_/g, ' ')}${notes ? ` — ${notes}` : ''}`,
          createdAt: now, createdBy: currentUser,
        },
        refresh,
      },
    );
    setSignalDialogOpen(false);
    setSignalDialogLead(null);
    toast.success(`${signalDialogLead.companyName}: ${outcome.replace(/_/g, ' ')}`, {
      description: nextTask?.reason || 'Outcome added',
    });

    // If interested on call, open meeting booking
    if (outcome === 'interested' && (signalTriggerType === 'warm_open_signal' || signalTriggerType === 'day5_no_response')) {
      setMeetingBookingLead(updated);
      setMeetingBookingOpen(true);
    }
  }, [signalDialogLead, signalTriggerType, signalTitle, saveCompany, addActivity, refresh, currentUser]);

  const handleMeetingOutcomeSubmit = (data: { outcome: MeetingOutcome; summary: string; nextStep: string; nextStepDate?: string }) => {
    if (!meetingOutcomeLead) return;
    // CRITICAL: Use fresh lead from store
    const freshLead = companies.find(c => c.id === meetingOutcomeLead.id) || meetingOutcomeLead;
    const result = processMeetingOutcome(freshLead, data.outcome, data.summary, data.nextStep, currentUser, bridge, data.nextStepDate);
    refresh();
    setMeetingOutcomeOpen(false);
    setMeetingOutcomeLead(null);
    toast.success(`Meeting result added: ${freshLead.companyName}`, { description: result.nextStepDescription });
  };

  const handleMeetingBookingConfirm = async (booking: MeetingBooking) => {
    if (!meetingBookingLead) return;
    // CRITICAL: Use fresh lead from store
    const freshLead = companies.find(c => c.id === meetingBookingLead.id) || meetingBookingLead;
    let meetingLink = booking.link;
    let calendarEventId = '';
    if (booking.type === 'teams' && !meetingLink) {
      try {
        const event = await createMicrosoftTeamsEvent({
          subject: `Stylique meeting: ${freshLead.companyName}`,
          startTime: booking.dateTime,
          attendees: freshLead.contactEmail ? [{ email: freshLead.contactEmail, name: freshLead.contactName }] : [],
          notes: booking.notes || `Meeting with ${freshLead.companyName}`,
        });
        meetingLink = event.joinUrl || event.webLink || '';
        calendarEventId = event.eventId;
      } catch (error) {
        toast.warning(error instanceof Error ? error.message : 'Microsoft calendar not configured. Save a manual link.');
      }
    }
    const result = executeMeetingBooked(freshLead, currentUser, bridge, booking.dateTime, booking.type, meetingLink);
    if (calendarEventId && result.lead?.meetings?.length) {
      const updatedMeetings = result.lead.meetings.map((meeting, idx, arr) => idx === arr.length - 1
        ? { ...meeting, external_calendar_id: calendarEventId, sync_status: 'synced' as const, meeting_link: meetingLink }
        : meeting
      );
      saveCompany({ ...result.lead, meetings: updatedMeetings, updatedAt: new Date().toISOString() });
    }
    refresh();
    setMeetingBookingOpen(false);
    setMeetingBookingLead(null);
    toast.success(result.message);
  };

  const handleCallSave = useCallback((log: CallLog) => {
    if (!callLead) return;
    // CRITICAL: Use fresh lead from store
    const freshLead = companies.find(c => c.id === callLead.id) || callLead;
    const result = processCallOutcome(freshLead, log.outcome, log.notes, currentUser, bridge, log.callbackDate);
    setCallDialogOpen(false); setCallLead(null); refresh();
    toast.success(`Call result added: ${freshLead.companyName}`, { description: result.nextStepDescription });
    if (log.outcome === 'interested') {
      setTimeout(() => {
        const latestLead = companies.find(l => l.id === freshLead.id);
        if (latestLead) { setMeetingBookingLead(latestLead); setMeetingBookingOpen(true); }
      }, 100);
    }
  }, [callLead, companies, currentUser, bridge, refresh]);

  const handleTransitionSubmit = useCallback((result: TransitionResult) => {
    if (!transitionLead) return;
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();

    // CRITICAL: Fetch fresh lead from store to avoid stale-read overwrites
    const freshLead = companies.find(c => c.id === transitionLead.id) || transitionLead;

    // Archive stale tasks from previous stage family BEFORE setting new stage
    const archivedTasks = archiveStaleTasksForStage(freshLead.tasks || [], transitionTargetStage);

    // Apply the stage change with proper data
    let updated: Lead = {
      ...freshLead,
      stage: transitionTargetStage as Lead['stage'],
      updatedAt: now,
      lastContactedAt: result.transitionType === 'to_contacted' ? now : freshLead.lastContactedAt,
      tasks: archivedTasks,
    };

    // Channel-specific timing updates
    if (result.channel === 'email') updated.lastEmailAt = now;
    if (result.channel === 'linkedin') updated.lastLinkedinAt = now;
    if (result.channel === 'phone') updated.lastCallAt = now;

    // Log reply if transitioning to replied
    if (result.transitionType === 'to_replied') {
      updated.lastReplyAt = now;
    }

    if (result.notes.trim()) {
      const noteLabel =
        result.transitionType === 'to_replied' ? 'Reply' :
        result.transitionType === 'to_trial_proposed' ? 'Client review' :
        result.transitionType === 'to_closed' ? 'Closed lost' :
        'Note';
      updated.notes = freshLead.notes
        ? `${freshLead.notes}\n\n[${new Date(now).toLocaleString()}] ${noteLabel}: ${result.notes.trim()}`
        : `[${new Date(now).toLocaleString()}] ${noteLabel}: ${result.notes.trim()}`;
    }

    if (result.transitionType === 'to_replied') {
      if (result.selectedOption === 'decision_pending') {
        updated.stage = 'internal-decision' as Lead['stage'];
        updated.tasks = archiveStaleTasksForStage(updated.tasks || [], 'internal-decision');
      } else if (result.selectedOption === 'cold') {
        updated.stage = 'cold-no-response' as Lead['stage'];
        updated.tasks = archiveStaleTasksForStage(updated.tasks || [], 'cold-no-response');
      }
    }

    // Preserve state without creating workflow pressure.
    updated = { ...updated, nextAction: undefined, nextActionReason: undefined, nextActionUrgency: undefined, nextFollowUp: undefined };

    // Log action completion
    updated.actionCompletions = [
      ...(updated.actionCompletions || []),
      { id: crypto.randomUUID(), action: `Stage: ${String(updated.stage).replace(/-/g, ' ')}`, completedAt: now, completedBy: currentUser, channel: result.channel || 'system', notes: result.notes },
    ];

    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(),
          leadId: freshLead.id,
          type: result.channel === 'phone' ? 'call' : result.channel === 'email' ? 'email' : 'stage-change',
          description: `${String(updated.stage).replace(/-/g, ' ')} — ${result.selectedOption.replace(/_/g, ' ')}${result.notes ? ` · ${result.notes}` : ''}`,
          createdAt: now,
          createdBy: currentUser,
        },
        refresh,
      },
    );
    setTransitionOpen(false);
    setTransitionLead(null);
    toast.success(`${freshLead.companyName} updated`);

    // If reply → book_meeting, open booking dialog
    if (result.transitionType === 'to_replied' && result.selectedOption === 'book_meeting') {
      setMeetingBookingLead(updated);
      setMeetingBookingOpen(true);
    }
  }, [transitionLead, transitionTargetStage, companies, saveCompany, addActivity, refresh, currentUser]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent, targetColumnKey: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId) return;

    const lead = companies.find(c => c.id === leadId);
    if (!lead) return;
    const cs = getCanonicalState(lead);
    const currentCol = getColumnKey(cs, lead, activeView);
    if (currentCol === targetColumnKey) return;

    // Column → stage mapping
    const COLUMN_TO_STAGE: Record<string, string> = {
      new_lead: 'sdr-new-lead', contacted: 'sdr-contacted', replied: 'sdr-replied',
      meeting_booked: 'meeting-booked', meeting_completed: 'meeting-completed',
      decision_pending: 'internal-decision', internal_decision: 'internal-decision', pricing_discussion: 'pricing-discussion',
      trial_proposed: 'trial-proposed', client_review: 'trial-proposed', trial_active: 'trial-active', pilot: 'trial-active',
      converted: 'converted', closed: 'closed-lost', cold: 'cold-no-response',
      new_inquiry: 'inbound-new', qualified: 'inbound-qualified', awaiting_sdr: 'inbound-awaiting-sdr',
    };

    const newStage = COLUMN_TO_STAGE[targetColumnKey];
    if (!newStage) { toast.error('Move not allowed'); return; }

    // ═══ STAGE-SPECIFIC MODAL ENFORCEMENT ═══

    // → Meeting Completed: Force meeting outcome dialog
    if (targetColumnKey === 'meeting_completed') {
      setMeetingOutcomeLead(lead);
      setMeetingOutcomeOpen(true);
      return;
    }

    // → Meeting Booked: Force meeting booking dialog
    if (targetColumnKey === 'meeting_booked') {
      setMeetingBookingLead(lead);
      setMeetingBookingOpen(true);
      return;
    }

    // → Contacted (SDR Manual): one small channel note
    if (targetColumnKey === 'contacted' && activeView === 'sdr_flow') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_contacted');
      setTransitionOpen(true);
      return;
    }

    // → Contacted (Inbound): standard transition
    if (targetColumnKey === 'qualified' || targetColumnKey === 'awaiting_sdr') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_contacted');
      setTransitionOpen(true);
      return;
    }

    // → Replied: Force reply classification
    if (targetColumnKey === 'replied') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_replied');
      setTransitionOpen(true);
      return;
    }

    // → Trial Proposed: Force trial details
    if (targetColumnKey === 'trial_proposed' || targetColumnKey === 'client_review') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_trial_proposed');
      setTransitionOpen(true);
      return;
    }

    // → Decision Pending: small outcome note
    if (targetColumnKey === 'decision_pending') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_internal_decision');
      setTransitionOpen(true);
      return;
    }

    // → Closed / Lost: Force close reason
    if (targetColumnKey === 'closed') {
      setTransitionLead(lead);
      setTransitionTargetStage(newStage);
      setTransitionType('to_closed');
      setTransitionOpen(true);
      return;
    }

    if (targetColumnKey === 'pilot') {
      toast.info('Pilot starts after onboarding verifies');
      setSelectedLead(lead);
      return;
    }

    // → Converted: Prevent direct drag — must go through payment
    if (targetColumnKey === 'converted') {
      toast.info('Conversion requires payment confirmation', { description: 'Open the record to process payment.' });
      setSelectedLead(lead);
      return;
    }

    // Fallback — archive stale tasks, then move
    const now = new Date().toISOString();
    const archivedTasks = archiveStaleTasksForStage(lead.tasks || [], newStage);
    const intel = recalculateNextAction({ ...lead, stage: newStage as Lead['stage'], tasks: archivedTasks });
    const updated = {
      ...lead, stage: newStage as Lead['stage'], updatedAt: now,
      tasks: archivedTasks,
      nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate,
    };
    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(), leadId: lead.id, type: 'stage-change',
          description: `Stage moved to ${targetColumnKey.replace(/_/g, ' ')}`,
          createdAt: now, createdBy: currentUser,
        },
        refresh,
      },
    );
    toast.success(`${lead.companyName} moved to ${targetColumnKey.replace(/_/g, ' ')}`);
  }, [companies, activeView, saveCompany, addActivity, refresh, currentUser]);

  // Derive canonical state for all leads
  const enriched = useMemo(() => {
    let list = companies;
    if (isSdr) list = list.filter(l => l.assignedTo === currentUser || l.assigned_sdr === currentUser);
    return list.map(l => ({ lead: l, cs: getCanonicalState(l) }));
  }, [companies, isSdr, currentUser]);

  // Count per view
  const viewCounts = useMemo(() => ({
    sdr_flow: enriched.filter(({ cs, lead }) => matchesView(cs, lead, 'sdr_flow', 'all', 'all')).length,
    inbound: enriched.filter(({ cs, lead }) => matchesView(cs, lead, 'inbound', 'all', 'all')).length,
  }), [enriched]);

  // Apply view filter
  const filtered = useMemo(() =>
    enriched.filter(({ cs, lead }) => matchesView(cs, lead, activeView, sdrSubFilter, inboundSubFilter)),
    [enriched, activeView, sdrSubFilter, inboundSubFilter]
  );

  // Get columns for current view
  const columnDefs = activeView === 'inbound' ? INBOUND_COLUMNS
    : SDR_COLUMNS;

  // Group by column
  const columns = useMemo(() => {
    const map = new Map<string, { lead: Lead; cs: CanonicalState }[]>();
    for (const col of columnDefs) map.set(col.key, []);
    for (const item of filtered) {
      const key = getColumnKey(item.cs, item.lead, activeView);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else {
        // Fallback: put in first column
        const first = columnDefs[0]?.key;
        if (first) map.get(first)?.push(item);
      }
    }
    return map;
  }, [filtered, columnDefs, activeView]);

  const totalShowing = filtered.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" /> Pipeline
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalShowing} leads · {activeView === 'sdr_flow' ? 'SDR Flow' : 'Inbound'}
          </p>
        </div>
        <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setCsvImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </Button>
            <Button size="sm" onClick={() => setAddLeadOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Lead
            </Button>
          </div>
      </div>

      {/* Three pipeline views */}
      <div className="space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {PIPELINE_VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => {
                setActiveView(v.key);
                setSdrSubFilter('all');
                setInboundSubFilter('all');
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                activeView === v.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary/50 text-muted-foreground border-transparent hover:bg-secondary'
              )}
            >
              <v.icon className="h-3 w-3" />
              {v.label}
              <span className="tabular-nums">({viewCounts[v.key]})</span>
            </button>
          ))}
        </div>

        {/* SDR sub-filters */}
        {activeView === 'sdr_flow' && (
          <div className="flex gap-1 pl-2">
            {SDR_SUB_FILTERS.map(sf => (
              <button
                key={sf.key}
                onClick={() => setSdrSubFilter(sf.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                  sdrSubFilter === sf.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60'
                )}
              >
                {sf.label}
              </button>
            ))}
          </div>
        )}

        {/* Inbound sub-filters */}
        {activeView === 'inbound' && (
          <div className="flex gap-1 pl-2">
            {INBOUND_SUB_FILTERS.map(sf => (
              <button
                key={sf.key}
                onClick={() => setInboundSubFilter(sf.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                  inboundSubFilter === sf.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60'
                )}
              >
                {sf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Kanban board (SDR Flow / Inbound) */}
      <div className="overflow-x-auto scrollbar-thin pb-4 -mx-4 px-4 snap-x snap-mandatory scroll-smooth">
        <div className="flex gap-3 min-w-max">
          {columnDefs.map(col => {
            const items = columns.get(col.key) || [];
            const isDropTarget = dragOverColumn === col.key;
            return (
              <div
                key={col.key}
                className={cn(
                  'w-[72vw] sm:w-56 shrink-0 rounded-lg snap-center transition-colors',
                  isDropTarget && 'bg-primary/5 ring-2 ring-primary/20 rounded-lg',
                )}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                <div className="flex items-center justify-between mb-2 px-1 sticky top-0 bg-background/95 backdrop-blur-sm z-[1] py-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-help truncate max-w-[180px] sm:max-w-[140px]">
                        {col.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      <p className="text-xs">{col.description}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Badge variant="secondary" className="text-[10px] tabular-nums h-4 px-1.5 rounded-full">
                    {items.length}
                  </Badge>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {items.map(({ lead, cs }) => (
                    <DealCard
                      key={lead.id}
                      lead={lead}
                      cs={cs}
                      viewerRole={viewerRole}
                      currentUser={currentUser}
                      onSelect={handleSelectLead}
                      view={activeView}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="w-full py-6 text-xs text-muted-foreground/20 text-center rounded-lg border border-dashed border-muted/20">
                      —
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Meeting outcome dialog */}
      {meetingOutcomeLead && (
        <MeetingOutcomeDialog
          open={meetingOutcomeOpen}
          onOpenChange={(open) => { if (!open) { setMeetingOutcomeOpen(false); setMeetingOutcomeLead(null); } }}
          companyName={meetingOutcomeLead.companyName}
          lead={meetingOutcomeLead}
          onSubmit={handleMeetingOutcomeSubmit}
        />
      )}

      {/* Meeting booking dialog */}
      {meetingBookingLead && (
        <MeetingBookingDialog
          open={meetingBookingOpen}
          onOpenChange={(open) => { if (!open) { setMeetingBookingOpen(false); setMeetingBookingLead(null); } }}
          companyName={meetingBookingLead.companyName}
          onConfirm={handleMeetingBookingConfirm}
          brandProgress={getBrandProgress(meetingBookingLead)}
        />
      )}

      {/* Stage transition dialog — enforces data capture per transition */}
      {transitionLead && (
        <StageTransitionDialog
          open={transitionOpen}
          onOpenChange={(open) => { if (!open) { setTransitionOpen(false); setTransitionLead(null); } }}
          transitionType={transitionType}
          companyName={transitionLead.companyName}
          contactName={transitionLead.contactName}
          onSubmit={handleTransitionSubmit}
        />
      )}

      {/* SDR Day 1 Entry dialog */}
      {outreachEntryLead && (
        <SDROutreachEntryDialog
          open={outreachEntryOpen}
          onOpenChange={(open) => { if (!open) { setOutreachEntryOpen(false); setOutreachEntryLead(null); } }}
          companyName={outreachEntryLead.companyName}
          contactName={outreachEntryLead.contactName}
          contactEmail={outreachEntryLead.contactEmail}
          contactLinkedIn={outreachEntryLead.linkedin}
          onSubmit={handleOutreachEntrySubmit}
        />
      )}

      {/* SDR Signal dialog */}
      {signalDialogLead && (
        <SDRSignalDialog
          open={signalDialogOpen}
          onOpenChange={(open) => { if (!open) { setSignalDialogOpen(false); setSignalDialogLead(null); } }}
          triggerType={signalTriggerType}
          triggerTitle={signalTitle}
          triggerReason={signalReason}
          lead={signalDialogLead}
          onSubmit={handleSignalOutcome}
        />
      )}

      {/* Stage Move Sheet — mobile tap-to-move fallback */}
      <StageMoveSheet
        open={stageMoveOpen}
        onOpenChange={(open) => { if (!open) { setStageMoveOpen(false); setStageMoveLead(null); } }}
        lead={stageMoveLead}
        currentColumnKey={stageMoveColumnKey}
        view={activeView}
        onMoveToStage={handleMoveToStage}
        onViewDetails={handleSelectLead}
      />

      <AddLeadDialog
        open={addLeadOpen}
        onOpenChange={setAddLeadOpen}
        defaultFlow={activeView === 'inbound' ? 'inbound' : 'sdr_manual'}
      />

      {/* CSV Import dialog */}
      <CSVImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        defaultFlow={activeView === 'inbound' ? 'inbound' : 'sdr_manual'}
      />

      {/* Call dialog */}
      {callLead && (
        <CallLogDialog open={callDialogOpen}
          onOpenChange={o => { if (!o) { setCallDialogOpen(false); setCallLead(null); } }}
          companyName={callLead.companyName} contactName={callLead.contactName}
          contactPhone={callLead.contactPhone} lead={callLead} onSave={handleCallSave} />
      )}

      {/* Credentials dialog */}
      {credentialsLead && (
        <CredentialsDialog open={credentialsOpen}
          onOpenChange={o => { if (!o) { setCredentialsOpen(false); setCredentialsLead(null); } }}
          companyName={credentialsLead.companyName} contactName={credentialsLead.contactName}
          hasExisting={hasValidCredentials(credentialsLead)}
          existingUsername={credentialsLead.credentials?.username}
          onSave={(creds) => {
            const fresh = companies.find(l => l.id === credentialsLead.id) || credentialsLead;
            executeCredentialsSave(fresh, currentUser, bridge, creds);
            setCredentialsOpen(false); setCredentialsLead(null); refresh();
            toast.success('Credentials saved');
          }} />
      )}

      {/* Trial setup dialog */}
      {trialSetupLead && (
        <TrialSetupDialog open={trialSetupOpen}
          onOpenChange={o => { if (!o) { setTrialSetupOpen(false); setTrialSetupLead(null); } }}
          companyName={trialSetupLead.companyName} contactName={trialSetupLead.contactName}
          needsApproval={!trialSetupLead.approvedBy}
          needsCredentials={!hasValidCredentials(trialSetupLead)}
          existingUsername={trialSetupLead.credentials?.username}
          onComplete={(result: TrialSetupResult) => {
            const fresh = companies.find(l => l.id === trialSetupLead.id) || trialSetupLead;
            const execResult = executeAtomicTrialSetup(fresh, currentUser, bridge, result);
            setTrialSetupOpen(false); setTrialSetupLead(null); refresh();
            toast.success(execResult.message);
          }} />
      )}

      {/* Payment dialog */}
      {paymentLead && (
        <PaymentOutcomeDialog open={paymentOpen}
          onOpenChange={o => { if (!o) { setPaymentOpen(false); setPaymentLead(null); } }}
          companyName={paymentLead.companyName} lead={paymentLead}
          onSubmit={(outcome: PaymentOutcome, notes: string) => {
            const result = processPaymentOutcome(paymentLead, outcome, notes, currentUser, bridge);
            setPaymentOpen(false); setPaymentLead(null); refresh();
            toast.success(`Payment updated: ${paymentLead.companyName}`, { description: result.nextStepDescription });
          }} />
      )}

      {/* Company detail sheet */}
      <CompanyDetailSheet
        open={!!selectedLead}
        onOpenChange={open => { if (!open) { setSelectedLead(null); refresh(); } }}
        lead={selectedLead}
        defaultTab="overview"
        onAction={() => {}}
        onLeadUpdate={(updated) => { refresh(); setSelectedLead(updated); }}
      />
    </div>
  );
}
