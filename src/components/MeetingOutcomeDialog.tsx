/**
 * MeetingOutcomeDialog — small meeting result capture.
 */
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Clock, XCircle, ArrowRight } from 'lucide-react';
import { getDealContext } from '@/engine/action-chain';
import type { MeetingOutcomeType } from '@/types/crm';
import type { Lead } from '@/types/crm';
import { cn } from '@/lib/utils';

export type { MeetingOutcomeType };
export type MeetingOutcome = MeetingOutcomeType;

interface MeetingOutcomeOption {
  value: MeetingOutcomeType;
  label: string;
  description?: string;
  icon: typeof X;
  color: string;
}

const MEETING_OUTCOMES: MeetingOutcomeOption[] = [
  { value: 'interested', label: 'Decision Pending', icon: ArrowRight, color: 'border-primary/20 hover:border-primary/50' },
  { value: 'propose_trial', label: 'Move to Client Review', icon: ArrowRight, color: 'border-primary/20 hover:border-primary/50' },
  { value: 'followup_later', label: 'Reschedule / follow up', icon: Clock, color: 'border-amber-500/15 hover:border-amber-500/40' },
  { value: 'not_fit', label: 'Closed Lost', icon: XCircle, color: 'border-destructive/12 hover:border-destructive/30' },
  { value: 'no_show', label: 'No show', icon: X, color: 'border-destructive/12 hover:border-destructive/30' },
];

interface MeetingOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  meetingId?: string;
  /** Pass the full lead for compact deal context. */
  lead?: Lead | null;
  onSubmit: (data: {
    outcome: MeetingOutcomeType;
    summary: string;
    nextStep: string;
    nextStepDate?: string;
    meetingId?: string;
  }) => void;
}

export function MeetingOutcomeDialog({ open, onOpenChange, companyName, meetingId, lead, onSubmit }: MeetingOutcomeDialogProps) {
  const [selected, setSelected] = useState<MeetingOutcomeType | null>(null);
  const [summary, setSummary] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDate, setNextStepDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const needsDate = selected === 'followup_later' || selected === 'reschedule';

  // Deal context
  const dealCtx = useMemo(() => lead ? getDealContext(lead) : null, [lead]);

  const handleSubmit = () => {
    if (!selected || !summary.trim() || submitting) return;
    setSubmitting(true);
    onSubmit({
      outcome: selected, summary, nextStep,
      nextStepDate: needsDate ? nextStepDate : undefined,
      meetingId,
    });
    setSelected(null); setSummary(''); setNextStep(''); setNextStepDate('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {dealCtx
              ? `Meeting with ${dealCtx.contactName} is complete`
              : 'Meeting finished. What happened?'}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/70">
            {dealCtx ? (
              <span>
                <span className="font-medium text-foreground/80">{dealCtx.companyName}</span>
                {' · '}
                <span>{dealCtx.currentStageLabel}</span>
                {' · '}
                <span>{dealCtx.flowLabel}</span>
                {dealCtx.riskLabel && (
                  <span className="text-destructive/70"> · {dealCtx.riskLabel}</span>
                )}
              </span>
            ) : (
              <span>{companyName}</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground/50 mb-1.5 block">Meeting notes / outcome</Label>
            <Textarea
              value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="wants proposal, pricing discussion needed, follow up next week..."
              rows={3} className="text-sm"
              autoFocus
            />
          </div>
          <Label className="text-xs text-muted-foreground/50 block">Next state</Label>
          <div className="grid grid-cols-2 gap-2">
            {MEETING_OUTCOMES.map(opt => {
              const Icon = opt.icon;
              const isSelected = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelected(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2.5 rounded-lg border transition-all text-center',
                    isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : opt.color,
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', isSelected ? 'text-primary' : 'text-muted-foreground/45')} />
                  <span className={cn('text-[11px] font-medium leading-tight', isSelected ? 'text-primary' : 'text-foreground/75')}>{opt.label}</span>
                  {opt.description && <span className="text-[9px] text-muted-foreground/40 leading-tight">{opt.description}</span>}
                </button>
              );
            })}
          </div>

          {selected && (
            <>
              {needsDate && (
                <div>
                  <Label className="text-xs text-muted-foreground/50 mb-1.5 block">Next meeting / follow-up date</Label>
                  <Input
                    type="datetime-local" value={nextStepDate}
                    onChange={e => setNextStepDate(e.target.value)} className="text-sm"
                  />
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!selected || !summary.trim() || submitting}>
              {submitting ? 'Saving...' : 'Save result'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
