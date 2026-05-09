/**
 * Twilio Call Outcome Dialog — Forced outcome capture after every call.
 * Requires outcome selection + optional notes.
 * Updates unified contact record and creates next action.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone } from 'lucide-react';
import type { CallLogEntry } from '@/types/crm';

type CallOutcome = CallLogEntry['outcome'];

const OUTCOME_OPTIONS: { value: CallOutcome; label: string; nextAction: string }[] = [
  { value: 'connected_interested', label: 'Connected — Interested', nextAction: 'Book meeting' },
  { value: 'connected_followup', label: 'Connected — Follow Up Later', nextAction: 'Schedule follow-up' },
  { value: 'no_answer', label: 'No Answer', nextAction: 'Try again tomorrow' },
  { value: 'wrong_person', label: 'Wrong Person', nextAction: 'Research correct contact' },
  { value: 'not_interested', label: 'Not Interested', nextAction: 'Add reason, consider closing' },
  { value: 'call_again', label: 'Call Again', nextAction: 'Schedule callback' },
  { value: 'booked_meeting', label: 'Booked Meeting', nextAction: 'Prepare for meeting' },
];

interface TwilioCallOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  contactName: string;
  contactPhone?: string;
  twilioNumber?: string;
  onSave: (entry: Omit<CallLogEntry, 'id' | 'timestamp' | 'sdrOwner' | 'twilioNumber' | 'contactPhone'>) => void;
}

export function TwilioCallOutcomeDialog({ open, onOpenChange, companyName, contactName, contactPhone, twilioNumber, onSave }: TwilioCallOutcomeDialogProps) {
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = () => {
    if (!outcome || submitting) return;
    setSubmitting(true);
    const selectedOption = OUTCOME_OPTIONS.find(o => o.value === outcome);
    onSave({
      outcome: outcome as CallOutcome,
      notes,
      nextAction: selectedOption?.nextAction,
    });
    setOutcome('');
    setNotes('');
    setSubmitting(false);
    onOpenChange(false);
  };

  const selectedOption = OUTCOME_OPTIONS.find(o => o.value === outcome);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" /> Call with {contactName}
          </DialogTitle>
          <DialogDescription>{companyName}</DialogDescription>
        </DialogHeader>

        {contactPhone && (
          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Called</p>
            <p className="text-sm font-semibold">{contactPhone}</p>
            {twilioNumber && (
              <p className="text-[10px] text-muted-foreground mt-1">From: {twilioNumber}</p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">What happened? *</Label>
            <Select value={outcome} onValueChange={v => setOutcome(v as CallOutcome)}>
              <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>
                {OUTCOME_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Key points from the call..."
            />
          </div>

          {selectedOption && (
            <div className="bg-secondary/50 rounded-lg p-2.5 text-xs">
              <span className="text-muted-foreground">Next step: </span>
              <span className="font-medium">{selectedOption.nextAction}</span>
              <span className="text-muted-foreground"> (auto-assigned)</span>
            </div>
          )}

          <Button onClick={handleSave} disabled={!outcome || submitting} className="w-full">
            {submitting ? 'Saving...' : 'Save call result'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
