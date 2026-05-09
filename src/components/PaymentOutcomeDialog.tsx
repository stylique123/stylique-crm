/**
 * PaymentOutcomeDialog — payment state capture.
 */
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle, Clock, AlertTriangle, X } from 'lucide-react';
import { getDealContext } from '@/engine/action-chain';
import type { Lead } from '@/types/crm';
import { cn } from '@/lib/utils';

export type PaymentOutcome = 'paid' | 'reminder-sent' | 'requested-time' | 'lost';

const PAYMENT_OUTCOMES: { value: PaymentOutcome; label: string; icon: typeof CheckCircle; color: string }[] = [
  { value: 'paid', label: 'Confirm Payment', icon: CheckCircle, color: 'border-success/30 hover:border-success' },
  { value: 'reminder-sent', label: 'Followed up', icon: Clock, color: 'border-warning/30 hover:border-warning' },
  { value: 'requested-time', label: 'Needs time', icon: AlertTriangle, color: 'border-muted hover:border-muted-foreground' },
  { value: 'lost', label: 'Closed Lost', icon: X, color: 'border-destructive/20 hover:border-destructive/50' },
];

interface PaymentOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  amount?: number;
  lead?: Lead | null;
  onSubmit: (outcome: PaymentOutcome, notes: string) => void;
}

export function PaymentOutcomeDialog({ open, onOpenChange, companyName, amount, lead, onSubmit }: PaymentOutcomeDialogProps) {
  const [selected, setSelected] = useState<PaymentOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dealCtx = useMemo(() => lead ? getDealContext(lead) : null, [lead]);

  const handleSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    onSubmit(selected, notes);
    setSelected(null);
    setNotes('');
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {dealCtx
              ? `Payment follow-up for ${dealCtx.companyName}`
              : 'Payment follow-up. What happened?'}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/70">
            {dealCtx ? (
              <span>
                <span>{dealCtx.currentStageLabel}</span>
                {amount ? <span> · ${amount}</span> : ''}
                {dealCtx.riskLabel && <span className="text-destructive/70"> · {dealCtx.riskLabel}</span>}
              </span>
            ) : (
              <span>{companyName}{amount ? ` — $${amount}` : ''}</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_OUTCOMES.map(opt => {
              const Icon = opt.icon;
              const isSelected = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelected(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center',
                    isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : opt.color,
                  )}
                >
                  <Icon className={cn('h-4 w-4', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className={cn('text-xs font-medium', isSelected ? 'text-primary' : '')}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any details..." rows={2} className="text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!selected || submitting}>{submitting ? 'Saving...' : 'Confirm'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
