/**
 * PaymentOutcomeDialog — payment state capture.
 */
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle, Clock, AlertTriangle, X } from 'lucide-react';
import { getDealContext } from '@/engine/action-chain';
import { PLAN_LABELS, type Currency, type Lead, type SubscriptionPlan } from '@/types/crm';
import { cn } from '@/lib/utils';

export type PaymentOutcome = 'paid' | 'reminder-sent' | 'requested-time' | 'lost';

export interface PaymentConfirmationDetails {
  paymentDate: string;
  amount: number;
  currency: Currency;
  package: SubscriptionPlan;
  note?: string;
}

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
  onSubmit: (outcome: PaymentOutcome, notes: string, details?: PaymentConfirmationDetails) => void;
}

export function PaymentOutcomeDialog({ open, onOpenChange, companyName, amount, lead, onSubmit }: PaymentOutcomeDialogProps) {
  const [selected, setSelected] = useState<PaymentOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dealCtx = useMemo(() => lead ? getDealContext(lead) : null, [lead]);
  const initialAmount = lead?.active_value ?? lead?.proposed_value ?? amount ?? 0;
  const initialCurrency = (lead?.active_currency ?? lead?.proposed_currency ?? 'USD') as Currency;
  const initialPackage = (lead?.active_package ?? lead?.proposed_package ?? lead?.subscriptionPlan ?? 'starter') as SubscriptionPlan;
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentAmount, setPaymentAmount] = useState(() => String(initialAmount || ''));
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [plan, setPlan] = useState<SubscriptionPlan>(initialPackage);
  const [paymentNote, setPaymentNote] = useState('');

  const handleSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    const details = selected === 'paid'
      ? {
        paymentDate,
        amount: Number(paymentAmount) || 0,
        currency,
        package: plan,
        note: paymentNote.trim() || undefined,
      }
      : undefined;
    onSubmit(selected, notes, details);
    setSelected(null);
    setNotes('');
    setPaymentNote('');
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

          {selected === 'paid' && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Payment date</Label>
                <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input inputMode="decimal" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Currency</Label>
                <Select value={currency} onValueChange={value => setCurrency(value as Currency)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['PKR', 'USD', 'GBP', 'AED'] as Currency[]).map(value => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Package</Label>
                <Select value={plan} onValueChange={value => setPlan(value as SubscriptionPlan)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PLAN_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Payment note</Label>
                <Input value={paymentNote} onChange={e => setPaymentNote(e.target.value)} placeholder="Optional" className="h-8 text-xs" />
              </div>
            </div>
          )}

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
