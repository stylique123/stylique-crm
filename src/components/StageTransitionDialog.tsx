/**
 * StageTransitionDialog — small state update dialogs.
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mail, Linkedin, Phone, Calendar, X, Clock, FileText } from 'lucide-react';

// ── Transition type mapping ──────────────────────────────

export type TransitionType =
  | 'to_contacted'
  | 'to_replied'
  | 'to_trial_proposed'
  | 'to_internal_decision'
  | 'to_pricing_discussion'
  | 'to_closed';

export interface TransitionResult {
  transitionType: TransitionType;
  selectedOption: string;
  channel?: string;
  notes: string;
}

// ── Option definitions per transition ────────────────────

interface TransitionOption {
  value: string;
  label: string;
  description?: string;
  icon: typeof Mail;
  color: string;
}

const CONTACTED_OPTIONS: TransitionOption[] = [
  { value: 'email_sent', label: 'Email sent', icon: Mail, color: 'border-primary/30 hover:border-primary' },
  { value: 'linkedin_sent', label: 'LinkedIn sent', icon: Linkedin, color: 'border-blue-500/30 hover:border-blue-500' },
  { value: 'called', label: 'Called', icon: Phone, color: 'border-success/30 hover:border-success' },
];

const REPLIED_OPTIONS: TransitionOption[] = [
  { value: 'book_meeting', label: 'Schedule Meeting', icon: Calendar, color: 'border-primary/30 hover:border-primary' },
  { value: 'decision_pending', label: 'Decision Pending', icon: Clock, color: 'border-warning/30 hover:border-warning' },
  { value: 'cold', label: 'Cold', icon: X, color: 'border-muted hover:border-muted-foreground' },
];

const TRIAL_PROPOSED_OPTIONS: TransitionOption[] = [
  { value: 'client_review', label: 'Move to Client Review', icon: FileText, color: 'border-primary/30 hover:border-primary' },
];

const CLOSED_OPTIONS: TransitionOption[] = [
  { value: 'not_interested', label: 'Not interested', icon: X, color: 'border-destructive/20 hover:border-destructive/50' },
  { value: 'not_fit', label: 'Not a fit', icon: X, color: 'border-muted hover:border-muted-foreground' },
  { value: 'unresponsive', label: 'Unresponsive', icon: Clock, color: 'border-warning/30 hover:border-warning' },
];

const INTERNAL_DECISION_OPTIONS: TransitionOption[] = [
  { value: 'decision_pending', label: 'Decision Pending', icon: Clock, color: 'border-warning/30 hover:border-warning' },
];

const PRICING_DISCUSSION_OPTIONS: TransitionOption[] = [
  { value: 'pricing_note', label: 'Pricing note', icon: FileText, color: 'border-primary/30 hover:border-primary' },
];

const OPTIONS_MAP: Record<TransitionType, TransitionOption[]> = {
  to_contacted: CONTACTED_OPTIONS,
  to_replied: REPLIED_OPTIONS,
  to_trial_proposed: TRIAL_PROPOSED_OPTIONS,
  to_internal_decision: INTERNAL_DECISION_OPTIONS,
  to_pricing_discussion: PRICING_DISCUSSION_OPTIONS,
  to_closed: CLOSED_OPTIONS,
};

const TITLES: Record<TransitionType, string> = {
  to_contacted: 'Outreach',
  to_replied: 'Reply summary',
  to_trial_proposed: 'Client review',
  to_internal_decision: 'Decision pending',
  to_pricing_discussion: 'Pricing note',
  to_closed: 'Closed lost',
};

const DESCRIPTIONS: Record<TransitionType, string> = {
  to_contacted: 'What happened?',
  to_replied: 'Keep it short.',
  to_trial_proposed: 'Leadership will own the next step.',
  to_internal_decision: 'What are they waiting on?',
  to_pricing_discussion: 'What was discussed?',
  to_closed: 'Why did it close?',
};

// ── Component ────────────────────────────────────────────

interface StageTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transitionType: TransitionType;
  companyName: string;
  contactName: string;
  onSubmit: (result: TransitionResult) => void;
}

export function StageTransitionDialog({
  open, onOpenChange, transitionType, companyName, contactName, onSubmit,
}: StageTransitionDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const options = OPTIONS_MAP[transitionType] || [];

  const handleSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    const channelMap: Record<string, string> = {
      email_sent: 'email', linkedin_sent: 'linkedin', called: 'phone', instagram_dm: 'social',
    };
    onSubmit({
      transitionType,
      selectedOption: selected,
      channel: channelMap[selected],
      notes,
    });
    setSelected(null);
    setNotes('');
    setSubmitting(false);
  };

  const reset = () => {
    setSelected(null);
    setNotes('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{TITLES[transitionType]}</DialogTitle>
          <DialogDescription className="text-xs">
            {contactName} — {companyName}
            <br />
            <span className="text-muted-foreground/70">{DESCRIPTIONS[transitionType]}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            {options.map(opt => {
              const Icon = opt.icon;
              const isSelected = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelected(opt.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-center ${
                    isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : opt.color
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-[11px] font-medium leading-tight ${isSelected ? 'text-primary' : ''}`}>{opt.label}</span>
                  {opt.description && <span className="text-[9px] text-muted-foreground leading-tight">{opt.description}</span>}
                </button>
              );
            })}
          </div>

          {selected && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {transitionType === 'to_replied' ? 'Reply summary' :
                  transitionType === 'to_trial_proposed' ? 'Review notes' :
                  transitionType === 'to_closed' ? 'Reason' :
                  'Notes'}
              </Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={
                  transitionType === 'to_contacted' ? 'No outreach yet, email sent, called, or short context...' :
                  transitionType === 'to_replied' ? 'interested in demo, asked for pricing, wants integrations...' :
                  transitionType === 'to_trial_proposed' ? 'package, value, currency, or context for leadership...' :
                  'Short note...'
                }
                rows={2}
                className="text-sm"
              />
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!selected || submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
