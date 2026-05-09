/**
 * Call Logging Dialog - small call result capture.
 */
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone } from 'lucide-react';
import { getDealContext } from '@/engine/action-chain';
import type { Lead } from '@/types/crm';
import { cn } from '@/lib/utils';

export type CallOutcome = 'answered' | 'no-answer' | 'interested' | 'not-interested' | 'call-back-later';

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  'answered': 'Answered — general conversation',
  'no-answer': 'No answer',
  'interested': 'Interested — wants to move forward',
  'not-interested': 'Not interested',
  'call-back-later': 'Call back later',
};

export interface CallLog {
  outcome: CallOutcome;
  notes: string;
  callbackDate?: string;
}

interface CallLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  contactName: string;
  contactPhone?: string;
  lead?: Lead | null;
  onSave: (log: CallLog) => void;
}

export function CallLogDialog({ open, onOpenChange, companyName, contactName, contactPhone, lead, onSave }: CallLogDialogProps) {
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dealCtx = useMemo(() => lead ? getDealContext(lead) : null, [lead]);

  const handleSave = () => {
    if (!outcome || submitting) return;
    setSubmitting(true);
    onSave({
      outcome: outcome as CallOutcome,
      notes,
      callbackDate: outcome === 'call-back-later' ? callbackDate : undefined,
    });
    setOutcome('');
    setNotes('');
    setCallbackDate('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            {dealCtx
              ? `You called ${dealCtx.contactName}. What happened?`
              : `You called ${contactName}. What happened?`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/70">
            {dealCtx ? (
              <span>
                <span className="font-medium text-foreground/80">{dealCtx.companyName}</span>
                {' · '}
                <span>{dealCtx.currentStageLabel}</span>
              </span>
            ) : companyName}
          </DialogDescription>
        </DialogHeader>

        {contactPhone && (
          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Call this number</p>
            <a href={`tel:${contactPhone}`} className="text-lg font-semibold text-primary hover:underline">
              {contactPhone}
            </a>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">What happened? *</Label>
            <Select value={outcome} onValueChange={v => setOutcome(v as CallOutcome)}>
              <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>
                {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {outcome === 'call-back-later' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Callback Date</Label>
              <Input type="datetime-local" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Key points from the call..."
            />
          </div>

          <Button onClick={handleSave} disabled={!outcome || submitting} className="w-full">
            {submitting ? 'Saving...' : 'Save call result'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
