/**
 * ClientReviewApprovalDialog — CEO/COO commercial approval surface
 * for records that SDR moved to Client Review (stage = trial-proposed).
 *
 * Outcomes:
 *   • approve   → set proposed_* deal fields; stays in Client Review for payment/credentials
 *   • reject    → stage='closed-lost'
 *   • send_back → stage='meeting-completed' with reason note
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Lead, SubscriptionPlan, Currency, PLAN_LABELS,
  getProposedDeal,
} from '@/types/crm';
import { getPackagePrice } from '@/lib/package-pricing';
import { useCompanyStore } from '@/lib/company-store';
import { addActivity, uid } from '@/lib/store';
import { useUser } from '@/lib/user-context';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Undo2 } from 'lucide-react';

type Mode = 'approve' | 'reject' | 'send_back';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead | null;
  onDone?: (lead: Lead, mode: Mode) => void;
}

const PLANS: SubscriptionPlan[] = ['lite', 'starter', 'growth', 'enterprise', 'custom'];
const CURRENCIES: Currency[] = ['PKR', 'USD', 'GBP', 'AED'];

export function ClientReviewApprovalDialog({ open, onOpenChange, lead, onDone }: Props) {
  const { saveCompany } = useCompanyStore();
  const { currentUser, userName } = useUser();

  const proposed = lead ? getProposedDeal(lead) : { package: 'starter' as SubscriptionPlan, currency: 'USD' as Currency, value: 99 };
  const [mode, setMode] = useState<Mode>('approve');
  const [pkg, setPkg] = useState<SubscriptionPlan>(proposed.package);
  const [currency, setCurrency] = useState<Currency>(proposed.currency);
  const [value, setValue] = useState<number>(proposed.value);
  const [notes, setNotes] = useState('');

  if (!lead) return null;

  const reset = () => { setMode('approve'); setNotes(''); };

  const submit = () => {
    const now = new Date().toISOString();
    let next: Partial<Lead> = {};
    let activity = '';

    if (mode === 'approve') {
      if (!value || value <= 0) { toast.error('Set a deal value above 0'); return; }
      next = {
        stage: 'trial-proposed',
        proposed_package: pkg,
        proposed_currency: currency,
        proposed_value: value,
        approvedBy: currentUser,
        clientReviewApprovedAt: now,
        clientReviewApprovedBy: currentUser,
        paymentStatus: 'pending',
        updatedAt: now,
      };
      activity = `✅ Client review approved by ${userName} — ${PLAN_LABELS[pkg]} ${currency} ${value}/mo${notes ? ` · ${notes}` : ''}`;
      toast.success(`${lead.companyName} approved — verify payment next`);
    } else if (mode === 'reject') {
      next = {
        stage: 'closed-lost',
        lossReason: notes.trim(),
        lossReasonAt: now,
        lossReasonBy: currentUser,
        updatedAt: now,
      };
      activity = `❌ Client review rejected by ${userName}${notes ? ` — ${notes}` : ''}`;
      toast.success(`${lead.companyName} marked Closed Lost`);
    } else {
      // send back to SDR
      next = {
        stage: 'meeting-completed',
        updatedAt: now,
      };
      activity = `↩︎ Sent back to SDR by ${userName}${notes ? ` — ${notes}` : ' — needs more discovery'}`;
      toast.success(`${lead.companyName} sent back to SDR`);
    }

    saveCompany({ ...lead, ...next });
    addActivity({
      id: uid(),
      leadId: lead.id,
      type: 'action-completed',
      description: activity,
      createdAt: now,
      createdBy: currentUser,
    });
    reset();
    onOpenChange(false);
    onDone?.({ ...lead, ...next } as Lead, mode);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Review Client Terms</DialogTitle>
          <DialogDescription>
            {lead.companyName} · {lead.contactName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-1.5">
          <ModeBtn icon={CheckCircle2} label="Approve" active={mode === 'approve'} tone="success" onClick={() => setMode('approve')} />
          <ModeBtn icon={Undo2} label="Send back" active={mode === 'send_back'} tone="warning" onClick={() => setMode('send_back')} />
          <ModeBtn icon={XCircle} label="Reject" active={mode === 'reject'} tone="danger" onClick={() => setMode('reject')} />
        </div>

        {mode === 'approve' && (
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Package</Label>
                <Select value={pkg} onValueChange={(v) => {
                  const p = v as SubscriptionPlan;
                  setPkg(p);
                  if (p !== 'custom') setValue(getPackagePrice(p, currency));
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map(p => <SelectItem key={p} value={p}>{PLAN_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Currency</Label>
                <Select value={currency} onValueChange={(v) => {
                  const c = v as Currency;
                  setCurrency(c);
                  if (pkg !== 'custom') setValue(getPackagePrice(pkg, c));
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Monthly value</Label>
              <Input type="number" value={value} onChange={e => setValue(Number(e.target.value))} className="h-8 text-xs" />
            </div>
          </div>
        )}

        <div className="space-y-1.5 mt-1">
          <Label className="text-[11px]">
            {mode === 'approve' ? 'Notes (optional)' : mode === 'reject' ? 'Reason' : 'Reason / what to fix'}
          </Label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={mode === 'approve' ? 'Special terms, billing notes…' : 'Required for follow-up'}
            className="text-xs min-h-[64px]"
          />
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={mode !== 'approve' && !notes.trim()}
          >
            {mode === 'approve' ? 'Approve Review' :
             mode === 'reject' ? 'Mark Closed Lost' : 'Send back to SDR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeBtn({
  icon: Icon, label, active, tone, onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  active: boolean;
  tone: 'success' | 'warning' | 'danger';
  onClick: () => void;
}) {
  const toneClass = tone === 'success'
    ? 'border-success/40 text-success bg-success/5'
    : tone === 'warning'
      ? 'border-warning/40 text-warning bg-warning/5'
      : 'border-destructive/40 text-destructive bg-destructive/5';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-2 rounded-md border text-[11px] font-medium transition-colors ${active ? toneClass : 'border-border/40 text-muted-foreground hover:bg-secondary/30'}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
