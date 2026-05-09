/**
 * StepExecutionPanel — Step-based execution with confirmation + outcome capture.
 * 
 * Flow: Action displayed → Direct action button → "What happened?" → Next step generated
 * NO generic labels. Every button tells you exactly what it does.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Lead } from '@/types/crm';
import { TEAM_MEMBERS } from '@/types/crm';
import { useUser } from '@/lib/user-context';
import { getOnboardingStage } from '@/engine/trial-engine';
import {
  type StepOutcome,
  type OutcomeMapping,
  getOutcomeOptions,
  getNextActionFromOutcome,
} from '@/engine/decision-engine';
import {
  type CanonicalLeadView,
  type CanonicalDisplayState,
  type CanonicalUrgency,
  type CanonicalActionType,
  getCanonicalDisplayState,
} from '@/engine/canonical-view';
import {
  CheckCircle, ArrowRight, Phone, Mail, Calendar,
  Clock, MessageCircle, ThumbsUp, ThumbsDown, AlertCircle, X,
  CreditCard, Settings, Search, ChevronRight,
} from 'lucide-react';

type ExecutionStep = 'action' | 'outcome';

interface StepExecutionPanelProps {
  lead: Lead;
  /** Canonical view — single source of visible truth */
  view: CanonicalLeadView;
  onAction?: (action: 'call' | 'email' | 'linkedin' | 'meeting' | 'credentials' | 'approve' | 'payment' | 'trial-setup') => void;
  onOutcomeSubmit?: (outcome: StepOutcome, notes: string) => void;
}

const URGENCY_STYLES: Record<CanonicalUrgency, { bg: string; border: string; text: string; dot: string }> = {
  'critical': { bg: 'bg-destructive/5', border: 'border-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
  'action-needed': { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning', dot: 'bg-warning' },
  'on-track': { bg: 'bg-secondary/50', border: 'border-muted', text: 'text-foreground', dot: 'bg-success' },
  'waiting': { bg: 'bg-secondary/30', border: 'border-muted/50', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

const ACTION_ICONS: Record<CanonicalActionType, typeof Phone> = {
  call: Phone,
  email: Mail,
  linkedin: MessageCircle,
  meeting: Calendar,
  setup: Settings,
  payment: CreditCard,
  confirm: CheckCircle,
  review: Search,
  none: Clock,
};

const OUTCOME_ICONS: Record<OutcomeMapping['icon'], typeof Clock> = {
  clock: Clock,
  message: MessageCircle,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  phone: Phone,
  calendar: Calendar,
  check: CheckCircle,
  alert: AlertCircle,
  x: X,
};

/** Context-specific button labels — never generic. Driven by canonical view. */
function getActionButtonLabel(actionType: CanonicalActionType, lead: Lead, view: CanonicalLeadView): string {
  // Pre-outreach (new lead) — never show generic "Confirm email step sent".
  const stage = lead.stage;
  const isNewLead = stage === 'sdr-new-lead' || stage === 'new-lead' || stage === 'lead-added' || stage === 'inbound-new' || stage === 'new-inquiry';
  if (isNewLead && (actionType === 'email' || actionType === 'call' || actionType === 'linkedin')) {
    return 'Contact';
  }
  switch (actionType) {
    case 'call': return `Call ${lead.contactName}`;
    case 'email': return 'Email sent';
    case 'linkedin': return `Message ${lead.contactName}`;
    case 'meeting': return `Book meeting`;
    case 'setup': return 'Start setup';
    case 'payment': return 'Confirm payment';
    case 'confirm':
      if (view.permissions.canActivateTrial) return 'Activate client';
      return 'Confirm';
    case 'review': return 'Review';
    default: return 'Action';
  }
}

function getOutcomeButtonLabel(actionType: CanonicalActionType, lead?: Lead): string {
  const stage = lead?.stage;
  const isNewLead = stage === 'sdr-new-lead' || stage === 'new-lead' || stage === 'lead-added' || stage === 'inbound-new' || stage === 'new-inquiry';
  if (isNewLead) return 'Add result';
  switch (actionType) {
    case 'call': return 'Add result';
    case 'email': return 'Add result';
    case 'meeting': return 'Add meeting result';
    case 'payment': return 'Update payment';
    case 'setup': return 'Add result';
    default: return 'Add result';
  }
}

export function StepExecutionPanel({ lead, view, onAction, onOutcomeSubmit }: StepExecutionPanelProps) {
  const [step, setStep] = useState<ExecutionStep>('action');
  const [selectedOutcome, setSelectedOutcome] = useState<StepOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [nextStepPreview, setNextStepPreview] = useState('');

  const display: CanonicalDisplayState = getCanonicalDisplayState(view);
  const styles = URGENCY_STYLES[display.urgency];
  const ActionIcon = ACTION_ICONS[display.actionType];
  // Outcome options: keep using outcome-mapping helper (utility, not visible truth).
  // Pass raw stage as a stage-keyed lookup hint only — not used for display meaning.
  const outcomeOptions = getOutcomeOptions(display.actionType, lead.stage);
  const isActionable = display.actionType !== 'none';

  const handleDirectAction = () => {
    const actionMap: Record<string, Parameters<NonNullable<typeof onAction>>[0]> = {
      call: 'call',
      email: 'email',
      linkedin: 'linkedin',
      meeting: 'meeting',
      setup: 'trial-setup',
      payment: 'payment',
      confirm: 'approve',
    };
    const mapped = actionMap[display.actionType];
    if (mapped) onAction?.(mapped);
  };

  const handleOutcomeSelect = (outcome: StepOutcome) => {
    setSelectedOutcome(outcome);
    const next = getNextActionFromOutcome(lead, outcome);
    setNextStepPreview(next.nextAction);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmitOutcome = () => {
    if (!selectedOutcome || submitting) return;
    setSubmitting(true);
    onOutcomeSubmit?.(selectedOutcome, notes);
    setStep('action');
    setSelectedOutcome(null);
    setNotes('');
    setNextStepPreview('');
    setSubmitting(false);
  };

  const { isOnboarding } = useUser();
  const onb = isOnboarding ? getOnboardingStage(lead) : null;
  const sdrOwner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);

  return (
    <div className={cn("rounded-lg border p-3 space-y-2.5", styles.bg, styles.border)}>
      {/* Owner / Step Owner / Stage — onboarding role only */}
      {isOnboarding && onb && (
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground border-b border-muted/40 pb-2">
          <span><span className="text-muted-foreground/60">SDR Owner:</span> {sdrOwner?.name?.split(' ')[0] || '—'}</span>
          <span className="text-muted-foreground/40">·</span>
          <span><span className="text-muted-foreground/60">Step Owner:</span> {onb.blocked ? (onb.blockedBy === 'leadership' ? 'Leadership' : 'SDR') : 'Onboarding (You)'}</span>
          <span className="text-muted-foreground/40">·</span>
          <span><span className="text-muted-foreground/60">Stage:</span> {onb.label}</span>
        </div>
      )}

      {/* When blocker is outside onboarding ownership: show WAITING, hide CTA */}
      {isOnboarding && onb?.blocked ? (
        <div className="flex items-start gap-2 pt-1">
          <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Waiting — {onb.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {onb.blockedBy === 'leadership'
                ? 'Leadership must act before onboarding can proceed. No action available here.'
                : 'SDR must act before onboarding can proceed.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", styles.dot)} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-muted-foreground">{display.summary}</p>
          </div>
        </div>
      )}

      {/* ─── STEP 1: Show Action ─────────────────── */}
      {step === 'action' && (
        <>
          <div className="flex items-start gap-2.5 pt-1">
            <ActionIcon className={cn("h-4 w-4 mt-0.5 shrink-0", styles.text)} />
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm font-semibold leading-tight", styles.text)}>
                {display.nextAction}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{display.reason}</p>
            </div>
          </div>

          {isActionable && (
            <div className="flex gap-2 pt-1">
              {display.actionType !== 'confirm' && display.actionType !== 'review' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                  onClick={handleDirectAction}
                >
                  <ActionIcon className="h-3 w-3 mr-1" />
                  {getActionButtonLabel(display.actionType, lead, view)}
                </Button>
              )}
              <Button
                size="sm"
                className={cn("h-7 text-xs", display.actionType === 'confirm' || display.actionType === 'review' ? 'flex-1' : '')}
                onClick={() => setStep('outcome')}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                {getOutcomeButtonLabel(display.actionType, lead)}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ─── STEP 2: Capture Outcome ─────────────── */}
      {step === 'outcome' && (
        <div className="space-y-3 pt-1">
          <p className="text-sm font-medium text-foreground">What happened?</p>
          <div className="grid grid-cols-2 gap-1.5">
            {outcomeOptions.map(opt => {
              const Icon = OUTCOME_ICONS[opt.icon];
              const isSelected = selectedOutcome === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleOutcomeSelect(opt.value)}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border text-left transition-all text-xs",
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-muted hover:border-muted-foreground/30'
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="min-w-0">
                    <span className={cn("font-medium block", isSelected && 'text-primary')}>{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground block leading-tight">{opt.description}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedOutcome && (
            <>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes (optional)..."
                rows={2}
                className="text-xs"
              />

              {nextStepPreview && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-secondary/50 border border-muted">
                  <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Next step:</span>
                    <span className="text-xs font-medium">{nextStepPreview}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setStep('action'); setSelectedOutcome(null); }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSubmitOutcome} disabled={submitting}>
                  <ArrowRight className="h-3 w-3 mr-1" />
                  {submitting ? 'Saving...' : 'Save outcome'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
