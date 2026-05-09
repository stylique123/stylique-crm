/**
 * /clients — Durable Account View.
 *
 *  Buckets (in order):
 *   • Client Review  — Moved to Client Review (leadership-owned handoff)
 *   • Awaiting Payment
 *   • Onboarding Pending  — paid AND !onboardingDoneAt
 *   • Active Clients      — paid AND onboardingDoneAt set
 *   • Overdue
 *   • Closed              — historical
 *
 * Role visibility:
 *   • SDR        → only records they own/are associated with
 *   • CEO/COO    → all
 *   • Onboarding → all client-side records
 *
 * Single onboarding action: "Onboarding Done & Verified" — onboarding role only.
 */
import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCompanyStore } from '@/lib/company-store';
import { useUser } from '@/lib/user-context';
import { hasValidCredentials, PLAN_LABELS, TEAM_MEMBERS, getActiveDeal, formatMoney, type Lead } from '@/types/crm';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { ClientReviewApprovalDialog } from '@/components/ClientReviewApprovalDialog';
import { CredentialsDialog } from '@/components/CredentialsDialog';
import { PaymentOutcomeDialog, type PaymentOutcome } from '@/components/PaymentOutcomeDialog';
import { processPaymentOutcome } from '@/engine/outcome-engine';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, AlertCircle, Search, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { addActivity, uid } from '@/lib/store';
import { toast } from 'sonner';

export default function OnboardingClientsPage() {
  const { companies, saveCompany, refresh } = useCompanyStore();
  const bridge = useMemo(() => ({ saveCompany, addActivity }), [saveCompany]);
  const { isOnboarding, role, currentUser, userName, isSdr, isLeadership } = useUser();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'review' | 'onboarding' | 'overdue' | 'history'>('active');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [reviewLead, setReviewLead] = useState<Lead | null>(null);
  const [credLead, setCredLead] = useState<Lead | null>(null);
  const [paymentLead, setPaymentLead] = useState<Lead | null>(null);
  const location = useLocation();

  // Scroll to hash anchor (#credentials, #active) when nav links change it.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    if (id === 'review' || id === 'payment' || id === 'credentials') setView('review');
    if (id === 'queue') setView('onboarding');
    if (id === 'active') setView('active');
    if (id === 'overdue') setView('overdue');
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, companies.length]);

  useEffect(() => {
    if (isOnboarding) setView('onboarding');
  }, [isOnboarding]);

  const matches = (c: Lead) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return c.companyName.toLowerCase().includes(q) || c.contactName.toLowerCase().includes(q);
  };

  // Role scoping
  const scoped = useMemo(() => {
    if (isLeadership || isOnboarding) return companies;
    if (isSdr) return companies.filter(c => c.assignedTo === currentUser || c.assigned_sdr === currentUser);
    return companies;
  }, [companies, isLeadership, isOnboarding, isSdr, currentUser]);

  const isClientReview = (c: Lead) =>
    c.stage === 'trial-proposed' || c.stage === 'trial-active';
  const isAwaitingPayment = (c: Lead) =>
    c.stage === 'payment-pending' && c.paymentStatus !== 'paid';
  const isOnboardingPending = (c: Lead) => c.paymentStatus === 'paid' && !c.onboardingDoneAt;
  const isActive = (c: Lead) => c.paymentStatus === 'paid' && !!c.onboardingDoneAt;
  const isOverdue = (c: Lead) => c.paymentStatus === 'overdue';
  const isClosed = (c: Lead) => c.stage === 'closed-lost' || c.stage === 'unsubscribed';

  // SDR Clients are STRICT (Part 7): only fully-paid + onboarded records they own.
  // Half-finished commercial records (Client Review, Awaiting Payment, Onboarding Pending,
  // Overdue, Closed) are leadership/onboarding concerns — hidden from SDRs here.
  const sdrStrict = isSdr && !isLeadership && !isOnboarding;
  const review = useMemo(() => (sdrStrict || isOnboarding) ? [] : scoped.filter(isClientReview).filter(matches), [scoped, query, sdrStrict, isOnboarding]);
  const awaiting = useMemo(() => (sdrStrict || isOnboarding) ? [] : scoped.filter(isAwaitingPayment).filter(matches), [scoped, query, sdrStrict, isOnboarding]);
  const allPending = useMemo(() => sdrStrict ? [] : scoped
    .filter(isOnboardingPending).filter(matches)
    .sort((a, b) => (a.paymentReceivedAt || '').localeCompare(b.paymentReceivedAt || ''))
  , [scoped, query, sdrStrict]);
  // Records paid but missing credentials — leadership/onboarding gating bucket.
  const awaitingCreds = useMemo(() => allPending.filter(c => !hasValidCredentials(c)), [allPending]);
  // True onboarding queue — paid AND credentials saved.
  const queue = useMemo(() => allPending.filter(c => hasValidCredentials(c)), [allPending]);
  const active = useMemo(() => scoped
    .filter(isActive).filter(matches)
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
  , [scoped, query]);
  const overdue = useMemo(() => (sdrStrict || isOnboarding) ? [] : scoped.filter(isOverdue).filter(matches), [scoped, query, sdrStrict, isOnboarding]);
  const closed = useMemo(() => (sdrStrict || isOnboarding) ? [] : scoped.filter(isClosed).filter(matches), [scoped, query, sdrStrict, isOnboarding]);

  const canMarkDone = isOnboarding;
  const canApprove = role === 'ceo' || role === 'coo';
  const canConfirmPayment = role === 'ceo' || role === 'coo';
  const canEditCreds = role === 'ceo' || role === 'coo' || isOnboarding;

  const saveCredentials = (lead: Lead, creds: { username: string; password: string; loginUrl?: string; installationNotes?: string }) => {
    const now = new Date().toISOString();
    saveCompany({
      ...lead,
      credentials: { ...creds, addedBy: currentUser, addedAt: now },
      credentialsAddedBy: currentUser,
      updatedAt: now,
    });
    addActivity({
      id: uid(),
      leadId: lead.id,
      type: 'action-completed',
      description: `Credentials added by ${userName} — ready for onboarding`,
      createdAt: now,
      createdBy: currentUser,
    });
    toast.success(`${lead.companyName} ready for onboarding`);
    setCredLead(null);
    refresh();
  };

  const markDone = (c: Lead) => {
    const now = new Date().toISOString();
    saveCompany({ ...c, onboardingDoneAt: now, onboardingDoneBy: currentUser, updatedAt: now });
    addActivity({
      id: uid(),
      leadId: c.id,
      type: 'action-completed',
      description: `Onboarding complete · ${userName}`,
      createdAt: now,
      createdBy: currentUser,
    });
    toast.success(`${c.companyName} onboarded`);
  };

  const confirmPayment = (outcome: PaymentOutcome, notes: string) => {
    if (!paymentLead) return;
    const fresh = companies.find(l => l.id === paymentLead.id) || paymentLead;
    processPaymentOutcome(fresh, outcome, notes, currentUser, bridge);
    const wasPaid = outcome === 'paid';
    const target = fresh;
    setPaymentLead(null);
    refresh();
    if (wasPaid && !hasValidCredentials(target)) {
      setTimeout(() => setCredLead(target), 250);
    }
    toast.success(wasPaid ? `${target.companyName} paid` : `${target.companyName} payment updated`);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Clients</h1>
      </header>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="pl-8 h-9 text-sm"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <ViewButton label={`Current clients · ${active.length}`} active={view === 'active'} onClick={() => setView('active')} />
        {!isOnboarding && <ViewButton label={`Review / payment · ${review.length + awaiting.length + awaitingCreds.length}`} active={view === 'review'} onClick={() => setView('review')} />}
        <ViewButton label={`Stuck in onboarding · ${awaitingCreds.length + queue.length}`} active={view === 'onboarding'} onClick={() => setView('onboarding')} />
        {!isOnboarding && <ViewButton label={`Overdue · ${overdue.length}`} active={view === 'overdue'} onClick={() => setView('overdue')} />}
        {!isOnboarding && <ViewButton label={`History · ${closed.length}`} active={view === 'history'} onClick={() => setView('history')} />}
      </div>

      {view === 'active' && (
        <section id="active" className="space-y-2 scroll-mt-16">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Current Clients · {active.length}
          </h2>
          {active.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Building2 className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground/70">No active clients yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {active.map(c => (
                <Card
                  key={c.id}
                  className="cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => setSelected(c)}
                >
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {c.companyName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{c.companyName}</span>
                        {c.subscriptionPlan && (
                          <Badge variant="outline" className="text-[10px]">{PLAN_LABELS[c.subscriptionPlan]}</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] text-success border-success/30">Active</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {c.contactName}
                        {c.onboardingDoneAt && <> · Live since {format(new Date(c.onboardingDoneAt), 'MMM d')}</>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {view === 'review' && review.length > 0 && (
        <section id="review" className="space-y-2 scroll-mt-16">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Review / Payment · Client Review · {review.length}
          </h2>
          <div className="space-y-1.5">
            {review.map(c => (
              <Card key={c.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <button onClick={() => setSelected(c)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                    {c.companyName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{c.companyName}</span>
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Moved to Client Review</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{c.contactName} · Leadership owns next step</div>
                  </div>
                  </button>
                  {canApprove && (
                    <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setReviewLead(c)}>
                      Review terms
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {view === 'review' && awaiting.length > 0 && (
        <section id="payment" className="space-y-2 scroll-mt-16">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Review / Payment · Awaiting Payment · {awaiting.length}
          </h2>
          <div className="space-y-1.5">
            {awaiting.map(c => (
              <Card key={c.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <button onClick={() => setSelected(c)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <div className="h-8 w-8 rounded-md bg-warning/10 flex items-center justify-center text-xs font-semibold text-warning shrink-0">
                      {c.companyName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{c.companyName}</span>
                      <Badge variant="outline" className="text-[10px] text-warning border-warning/30">Awaiting Payment</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.contactName} · {PLAN_LABELS[getActiveDeal(c).package]} {formatMoney(getActiveDeal(c).value, getActiveDeal(c).currency)}
                      {TEAM_MEMBERS.find(m => m.id === c.assignedTo)?.name && <> · SDR {TEAM_MEMBERS.find(m => m.id === c.assignedTo)?.name.split(' ')[0]}</>}
                    </div>
                    </div>
                  </button>
                  {canConfirmPayment && (
                    <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setPaymentLead(c)}>
                      Confirm Payment
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {(view === 'review' || view === 'onboarding') && awaitingCreds.length > 0 && (
        <section id="credentials" className="space-y-2 scroll-mt-16">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            {view === 'review' ? 'Review / Payment · Credentials' : 'Stuck in Onboarding · Credentials'} · {awaitingCreds.length}
          </h2>
          <div className="space-y-1.5">
            {awaitingCreds.map(c => (
              <Card key={c.id} className="hover:border-warning/30 transition-colors">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <button onClick={() => setSelected(c)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <div className="h-8 w-8 rounded-md bg-warning/10 flex items-center justify-center text-xs font-semibold text-warning shrink-0">
                      {c.companyName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{c.companyName}</span>
                        <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                          <AlertCircle className="h-2.5 w-2.5 mr-1" />Needs credentials
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {c.contactName}{c.paymentReceivedAt && <> · Paid {format(new Date(c.paymentReceivedAt), 'MMM d')}</>}
                      </div>
                    </div>
                  </button>
                  {canEditCreds && (
                    <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setCredLead(c)}>
                      Add credentials
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {view === 'onboarding' && <section id="queue" className="space-y-2 scroll-mt-16">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
          Onboarding Queue · {queue.length}
        </h2>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 px-1">Nothing pending.</p>
        ) : (
          <div className="space-y-1.5">
            {queue.map(c => {
              const hasCreds = hasValidCredentials(c);
              return (
                <Card key={c.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <button onClick={() => setSelected(c)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                        {c.companyName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{c.companyName}</span>
                          {c.subscriptionPlan && (
                            <Badge variant="outline" className="text-[10px]">{PLAN_LABELS[c.subscriptionPlan]}</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            Onboarding Pending
                          </Badge>
                          {!hasCreds && (
                            <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                              <AlertCircle className="h-2.5 w-2.5 mr-1" />No credentials
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {c.contactName}
                          {c.paymentReceivedAt && <> · Paid {format(new Date(c.paymentReceivedAt), 'MMM d')}</>}
                        </div>
                      </div>
                    </button>
                    {canMarkDone && (
                      <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => markDone(c)} disabled={!hasCreds}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        Done & Verified
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>}

      {view === 'overdue' && overdue.length > 0 && (
        <section id="overdue" className="space-y-2 scroll-mt-16">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Overdue · {overdue.length}
          </h2>
          <div className="space-y-1.5">
            {overdue.map(c => (
              <Card key={c.id} className="cursor-pointer hover:border-destructive/30 transition-colors" onClick={() => setSelected(c)}>
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center text-xs font-semibold text-destructive shrink-0">
                    {c.companyName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{c.companyName}</span>
                      <Badge variant="destructive" className="text-[10px]">Overdue</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{c.contactName}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {view === 'history' && closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
            Closed · {closed.length}
          </h2>
          <div className="space-y-1.5">
            {closed.map(c => (
              <Card key={c.id} className="cursor-pointer hover:border-muted/30 transition-colors opacity-70" onClick={() => setSelected(c)}>
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted/30 flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0">
                    {c.companyName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{c.companyName}</span>
                      <Badge variant="secondary" className="text-[10px]">Closed</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{c.contactName}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <CompanyDetailSheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          lead={selected}
          defaultTab="overview"
        />
      )}

      <ClientReviewApprovalDialog
        open={!!reviewLead}
        onOpenChange={(o) => { if (!o) setReviewLead(null); }}
        lead={reviewLead}
        onDone={refresh}
      />

      {credLead && (
        <CredentialsDialog
          open={!!credLead}
          onOpenChange={(o) => { if (!o) setCredLead(null); }}
          companyName={credLead.companyName}
          contactName={credLead.contactName}
          hasExisting={hasValidCredentials(credLead)}
          existingUsername={credLead.credentials?.username}
          onSave={(c) => saveCredentials(credLead, c)}
        />
      )}

      {paymentLead && (
        <PaymentOutcomeDialog
          open={!!paymentLead}
          onOpenChange={(o) => { if (!o) setPaymentLead(null); }}
          companyName={paymentLead.companyName}
          onSubmit={confirmPayment}
        />
      )}
    </div>
  );
}

function ViewButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 rounded-md border px-3 text-xs transition-colors ${
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border/50 bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
