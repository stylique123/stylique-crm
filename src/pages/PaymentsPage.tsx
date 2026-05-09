/**
 * STYLIQUE CRM — Approvals Page
 *
 * STRICT scope per the unified commercial flow: only records that are
 * actively in the *billing* lifecycle.
 *
 * Tabs:
 *   • Awaiting Payment — billable, no payment confirmed yet
 *   • Due Soon         — paid client whose next renewal is within 7 days
 *   • Overdue          — past due date with no payment
 *
 * Paid + onboarded clients live on /clients — they MUST NOT appear here.
 */
import { useMemo, useState } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { useUser } from '@/lib/user-context';
import {
  Lead, TEAM_MEMBERS, PLAN_LABELS,
  getPaymentDaysUntilDue, isCeoOrCoo,
  getActiveDeal, formatMoney,
} from '@/types/crm';
import { getBillingState, BILLING_LABEL } from '@/engine/billing-state';
import { getCommercialState } from '@/engine/commercial-state';
import { getCurrentBillingEntry, paidThisMonth } from '@/engine/payment-ledger';
import { processPaymentOutcome } from '@/engine/outcome-engine';
import { PaymentOutcomeDialog, type PaymentOutcome } from '@/components/PaymentOutcomeDialog';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { CredentialsDialog } from '@/components/CredentialsDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreditCard, Clock, AlertTriangle, DollarSign } from 'lucide-react';
import { hasValidCredentials } from '@/types/crm';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

type Tab = 'awaiting' | 'due_soon' | 'overdue';

const TAB_TONE: Record<Tab, string> = {
  awaiting: 'border-l-muted-foreground/40',
  due_soon: 'border-l-warning/60',
  overdue: 'border-l-destructive/70',
};

const TAB_BADGE: Record<Tab, { color: string; icon: typeof Clock }> = {
  awaiting: { color: 'text-muted-foreground border-muted-foreground/30', icon: Clock },
  due_soon: { color: 'text-warning border-warning/30', icon: Clock },
  overdue: { color: 'text-destructive border-destructive/30', icon: AlertTriangle },
};

function nextActionFor(tab: Tab, lead: Lead): string {
  const days = getPaymentDaysUntilDue(lead);
  if (tab === 'due_soon') {
    if (days === null) return 'Renewal due soon';
    if (days === 0) return 'Renewal due today';
    return `Renewal due in ${days}d`;
  }
  if (tab === 'overdue') {
    const overdueDays = days !== null ? Math.abs(Math.min(days, 0)) : 0;
    return overdueDays > 0 ? `${overdueDays}d overdue` : 'Overdue';
  }
  if (days === null) return 'Waiting for client payment';
  if (days <= 0) return 'Due today';
  return `Due in ${days}d`;
}

export default function PaymentsPage() {
  const { companies: leads, saveCompany, addActivity, refresh } = useCompanyStore();
  const { currentUser } = useUser();
  const bridge = useMemo(() => ({ saveCompany, addActivity }), [saveCompany, addActivity]);
  const canConfirm = isCeoOrCoo(currentUser);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLead, setPaymentLead] = useState<Lead | null>(null);
  const [credLead, setCredLead] = useState<Lead | null>(null);

  const grouped = useMemo(() => {
    const g: Record<Tab, Lead[]> = { awaiting: [], due_soon: [], overdue: [] };
    for (const lead of leads) {
      const cs = getCommercialState(lead);
      const s = getBillingState(lead);
      if (cs === 'overdue' || s === 'overdue') {
        g.overdue.push(lead);
      } else if (cs === 'payment_due_soon') {
        g.due_soon.push(lead);
      } else if (s === 'awaiting_payment' || s === 'awaiting_confirmation') {
        g.awaiting.push(lead);
      }
      // Paid + on-track clients live on /clients — intentionally not duplicated here.
    }
    return g;
  }, [leads]);

  const counts = {
    awaiting: grouped.awaiting.length,
    due_soon: grouped.due_soon.length,
    overdue: grouped.overdue.length,
  };

  const totals = useMemo(() => {
    const sum = (arr: Lead[]) => arr.reduce((s, l) => s + getActiveDeal(l).value, 0);
    return {
      awaiting: sum(grouped.awaiting),
      dueSoon: sum(grouped.due_soon),
      overdue: sum(grouped.overdue),
      paidThisMonth: paidThisMonth(leads),
    };
  }, [grouped, leads]);

  const defaultTab: Tab =
    counts.overdue > 0 ? 'overdue' :
    counts.due_soon > 0 ? 'due_soon' : 'awaiting';

  const handleConfirm = (lead: Lead) => {
    if (!canConfirm) { toast.error('Only CEO/COO can confirm payments'); return; }
    setPaymentLead(lead); setPaymentOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          Client Review, payment, and renewal state.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MetricTile icon={DollarSign} value={`$${Math.round(totals.paidThisMonth).toLocaleString()}`} label="Paid This Month" tone="success" />
        <MetricTile
          icon={Clock}
          value={totals.dueSoon > 0 ? `$${totals.dueSoon.toLocaleString()}` : '$0'}
          label="Due Soon"
          tone={counts.due_soon > 0 ? 'warning' : 'neutral'}
        />
        <MetricTile
          icon={AlertTriangle}
          value={totals.overdue > 0 ? `$${totals.overdue.toLocaleString()}` : '$0'}
          label="Overdue"
          tone={counts.overdue > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-3">
        <TabsList className="h-8 flex-wrap">
          <TabsTrigger value="awaiting" className="text-xs h-7">Awaiting Payment ({counts.awaiting})</TabsTrigger>
          <TabsTrigger value="due_soon" className="text-xs h-7">Due Soon ({counts.due_soon})</TabsTrigger>
          <TabsTrigger value="overdue" className="text-xs h-7">Overdue ({counts.overdue})</TabsTrigger>
        </TabsList>

        {(['awaiting', 'due_soon', 'overdue'] as const).map(tab => (
          <TabsContent key={tab} value={tab} className="space-y-1.5 mt-0">
            {grouped[tab].length === 0 ? (
              <EmptyCard tab={tab} />
            ) : grouped[tab].map(lead => (
              <PaymentRow
                key={lead.id}
                lead={lead}
                tab={tab}
                onSelect={setSelectedLead}
                onConfirm={canConfirm && tab === 'awaiting' ? () => handleConfirm(lead) : undefined}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>

      {paymentLead && (
        <PaymentOutcomeDialog
          open={paymentOpen}
          onOpenChange={o => { if (!o) { setPaymentOpen(false); setPaymentLead(null); } }}
          companyName={paymentLead.companyName}
          onSubmit={(outcome: PaymentOutcome, notes: string) => {
            const fresh = leads.find(l => l.id === paymentLead.id) || paymentLead;
            processPaymentOutcome(fresh, outcome, notes, currentUser, bridge);
            setPaymentOpen(false);
            const wasPaid = outcome === 'paid';
            const target = paymentLead;
            setPaymentLead(null);
            refresh();
            toast.success(`Payment confirmed for ${target.companyName}`);
            // Gate onboarding: prompt credentials immediately if missing.
            if (wasPaid && !hasValidCredentials(target)) {
              setTimeout(() => setCredLead(target), 250);
            }
          }}
        />
      )}

      {credLead && (
        <CredentialsDialog
          open={!!credLead}
          onOpenChange={(o) => { if (!o) setCredLead(null); }}
          companyName={credLead.companyName}
          contactName={credLead.contactName}
          hasExisting={hasValidCredentials(credLead)}
          existingUsername={credLead.credentials?.username}
          onSave={(c) => {
            const fresh = leads.find(l => l.id === credLead.id) || credLead;
            const now = new Date().toISOString();
            saveCompany({
              ...fresh,
              credentials: { ...c, addedBy: currentUser, addedAt: now },
              credentialsAddedBy: currentUser,
              updatedAt: now,
            });
            addActivity({
              id: 'cred-' + Date.now(),
              leadId: fresh.id,
              type: 'action-completed',
              description: `Credentials saved — ready for onboarding`,
              createdAt: now,
              createdBy: currentUser,
            });
            setCredLead(null); refresh();
            toast.success(`${fresh.companyName} ready for onboarding`);
          }}
        />
      )}

      <CompanyDetailSheet
        open={!!selectedLead}
        onOpenChange={o => { if (!o) { setSelectedLead(null); refresh(); } }}
        lead={selectedLead}
        defaultTab="payment"
        onAction={() => {}}
        onLeadUpdate={() => { refresh(); }}
      />
    </div>
  );
}

function PaymentRow({ lead, tab, onSelect, onConfirm }: {
  lead: Lead; tab: Tab; onSelect: (l: Lead) => void; onConfirm?: () => void;
}) {
  const owner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);
  const deal = getActiveDeal(lead);
  const cur = getCurrentBillingEntry(lead);
  const days = cur
    ? Math.ceil((new Date(cur.dueDate).getTime() - Date.now()) / 86400000)
    : getPaymentDaysUntilDue(lead);
  const state = getBillingState(lead);
  const Badge_ = TAB_BADGE[tab];
  const tabLabel = tab === 'due_soon' ? 'Due Soon' : BILLING_LABEL[state];

  return (
    <Card
      className={cn('hover:border-primary/25 transition-colors cursor-pointer border-l-[3px]', TAB_TONE[tab])}
      onClick={() => onSelect(lead)}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-medium truncate">{lead.companyName}</h3>
              <Badge variant="outline" className={cn('text-[10px] shrink-0', Badge_.color)}>
                <Badge_.icon className="h-2.5 w-2.5 mr-1" />
                {tabLabel}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
              <span className="text-foreground/70">{lead.contactName}</span>
              <span className="text-muted-foreground/30">·</span>
              {owner && <><span>{owner.name?.split(' ')[0]}</span><span className="text-muted-foreground/30">·</span></>}
              <span className="font-medium">{PLAN_LABELS[deal.package]} {formatMoney(deal.value, deal.currency)}/mo</span>
              {(cur || lead.nextPaymentDate) && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span>
                    {tab === 'overdue' && days !== null
                      ? `${Math.abs(days)}d overdue`
                      : days !== null && days >= 0
                        ? `Due in ${days}d`
                        : `Due ${format(new Date(cur?.dueDate || lead.nextPaymentDate!), 'MMM d')}`}
                  </span>
                </>
              )}
            </div>
            <p className={cn(
              'text-[10px] mt-1 truncate',
              tab === 'overdue' ? 'text-destructive' :
              tab === 'due_soon' ? 'text-warning' : 'text-muted-foreground/70'
            )}>
              {nextActionFor(tab, lead)}
            </p>
            {tab === 'awaiting' && lead.paymentClaimNotes && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic truncate">
                "{lead.paymentClaimNotes}"
              </p>
            )}
          </div>
          {onConfirm && (
            <Button
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={e => { e.stopPropagation(); onConfirm(); }}
            >
              Verify &amp; confirm
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({ icon: Icon, value, label, tone }: {
  icon: typeof DollarSign; value: string; label: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
}) {
  const valueColor = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-foreground';
  const iconColor = tone === 'success' ? 'text-success/70' : tone === 'danger' ? 'text-destructive/70' : tone === 'warning' ? 'text-warning/70' : 'text-muted-foreground/60';
  return (
    <Card className="bg-card">
      <CardContent className="py-4 px-3 text-center">
        <Icon className={cn('h-4 w-4 mx-auto mb-1.5', iconColor)} />
        <p className={cn('text-xl font-semibold tabular-nums', valueColor)}>{value}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function EmptyCard({ tab }: { tab: Tab }) {
  const messages: Record<Tab, string> = {
    awaiting: 'No clients awaiting payment',
    due_soon: 'No renewals due in the next 7 days',
    overdue: 'No overdue payments',
  };
  return (
    <Card className="py-10 text-center">
      <CreditCard className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
      <p className="text-xs text-muted-foreground">{messages[tab]}</p>
    </Card>
  );
}
