/**
 * STYLIQUE CRM — Ended / Lost Page (SDR + Leadership)
 *
 * Trials that ended without converting.
 *
 * Sections:
 *   • Awaiting Final Response — past trial-end, decision window still open (≤7d)
 *   • Ended — No Response     — past grace, no decision, unpaid
 *   • Ended — Declined        — explicit decline OR closed-lost from trial
 *   • Closed                  — final archive
 *
 * NOT for cold outreach closed-lost (those have no trial). Those stay in Pipeline.
 */
import { useState, useMemo } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { Lead, TEAM_MEMBERS, recalculateNextAction } from '@/types/crm';
import { useUser } from '@/lib/user-context';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { XCircle, ArrowDownCircle, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  getLifecycleBucket, getGraceDaysLeft, isInEndedPageScope,
} from '@/engine/post-trial';
import { commitLeadMutation } from '@/engine/action-executor';

export default function EndedPage() {
  const { companies: leads, saveCompany, addActivity, refresh } = useCompanyStore();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { currentUser, isSdr } = useUser();

  const visible = useMemo(() => {
    const all = leads.filter(l => {
      // Awaiting / no-response / declined trials
      if (isInEndedPageScope(l)) return true;
      // Also include trial_ended_awaiting (still in window) so SDR can act
      if (getLifecycleBucket(l) === 'trial_ended_awaiting') return true;
      return false;
    });
    if (isSdr) return all.filter(l => l.assignedTo === currentUser || l.assigned_sdr === currentUser);
    return all;
  }, [leads, isSdr, currentUser]);

  const awaiting = visible.filter(l => getLifecycleBucket(l) === 'trial_ended_awaiting');
  const noResponse = visible.filter(l => getLifecycleBucket(l) === 'ended_no_response');
  const declined = visible.filter(l => getLifecycleBucket(l) === 'ended_declined');
  const closed = visible.filter(l => getLifecycleBucket(l) === 'closed');

  const recordDecision = (lead: Lead, decision: 'continuing' | 'declined') => {
    const now = new Date().toISOString();
    let updated: Lead = {
      ...lead,
      postTrialDecision: decision,
      postTrialDecisionAt: now,
      postTrialDecisionBy: currentUser,
      updatedAt: now,
    };
    if (decision === 'declined') {
      updated = { ...updated, stage: 'closed-lost', close_reason: 'no-response' };
    } else {
      // Continuing → keep in payment-pending so it shows in Conversions / payment window
      if (updated.stage !== 'payment-pending' && updated.stage !== 'converted') {
        updated = { ...updated, stage: 'payment-pending' };
      }
    }
    const intel = recalculateNextAction(updated);
    updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };
    commitLeadMutation(
      { saveCompany, addActivity },
      {
        lead: updated,
        activity: {
          id: crypto.randomUUID(), leadId: lead.id, type: 'stage-change',
          description: decision === 'continuing'
            ? `✓ Client confirmed continuation — ${lead.companyName} → Awaiting payment`
            : `✗ Client declined — ${lead.companyName} → Ended`,
          createdAt: now, createdBy: currentUser,
        },
        refresh,
      },
    );
    toast.success(decision === 'continuing'
      ? 'Moved to Conversions → Awaiting Payment'
      : 'Moved to Ended');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Ended / Lost</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Counter value={awaiting.length} label="Awaiting decision" tone="text-warning" />
        <Counter value={noResponse.length} label="No response" tone="text-muted-foreground" />
        <Counter value={declined.length} label="Declined" tone="text-muted-foreground" />
        <Counter value={closed.length} label="Closed" tone="text-muted-foreground" />
      </div>

      <Tabs defaultValue={awaiting.length > 0 ? 'awaiting' : noResponse.length > 0 ? 'no_response' : 'declined'} className="space-y-3">
        <TabsList className="h-8">
          {awaiting.length > 0 && (
            <TabsTrigger value="awaiting" className="text-xs h-7">Awaiting Decision ({awaiting.length})</TabsTrigger>
          )}
          {noResponse.length > 0 && (
            <TabsTrigger value="no_response" className="text-xs h-7">No Response ({noResponse.length})</TabsTrigger>
          )}
          {declined.length > 0 && (
            <TabsTrigger value="declined" className="text-xs h-7">Declined ({declined.length})</TabsTrigger>
          )}
          {closed.length > 0 && (
            <TabsTrigger value="closed" className="text-xs h-7">Closed ({closed.length})</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="awaiting" className="space-y-1.5 mt-0">
          {awaiting.length === 0 ? (
            <EmptyCard icon={Clock} message="No trials awaiting decision" />
          ) : awaiting.map(l => (
            <EndedCard
              key={l.id} lead={l} variant="awaiting"
              onSelect={setSelectedLead}
              onContinue={() => recordDecision(l, 'continuing')}
              onDecline={() => recordDecision(l, 'declined')}
            />
          ))}
        </TabsContent>

        <TabsContent value="no_response" className="space-y-1.5 mt-0">
          {noResponse.length === 0 ? (
            <EmptyCard icon={ArrowDownCircle} message="No leads ended without response" />
          ) : noResponse.map(l => (
            <EndedCard key={l.id} lead={l} variant="no_response" onSelect={setSelectedLead} />
          ))}
        </TabsContent>

        <TabsContent value="declined" className="space-y-1.5 mt-0">
          {declined.length === 0 ? (
            <EmptyCard icon={XCircle} message="No declined trials" />
          ) : declined.map(l => (
            <EndedCard key={l.id} lead={l} variant="declined" onSelect={setSelectedLead} />
          ))}
        </TabsContent>

        <TabsContent value="closed" className="space-y-1.5 mt-0">
          {closed.length === 0 ? (
            <EmptyCard icon={CheckCircle2} message="No archived records" />
          ) : closed.map(l => (
            <EndedCard key={l.id} lead={l} variant="closed" onSelect={setSelectedLead} />
          ))}
        </TabsContent>
      </Tabs>

      <CompanyDetailSheet
        open={!!selectedLead} onOpenChange={o => { if (!o) { setSelectedLead(null); refresh(); } }}
        lead={selectedLead} defaultTab="overview"
        onAction={() => {}} onLeadUpdate={(u) => { refresh(); setSelectedLead(u); }}
      />
    </div>
  );
}

function EndedCard({
  lead, variant, onSelect, onContinue, onDecline,
}: {
  lead: Lead;
  variant: 'awaiting' | 'no_response' | 'declined' | 'closed';
  onSelect: (l: Lead) => void;
  onContinue?: () => void;
  onDecline?: () => void;
}) {
  const owner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);
  const grace = getGraceDaysLeft(lead);
  const trialEnd = lead.trialEndDate ? format(new Date(lead.trialEndDate), 'MMM d') : null;

  const borderTone = variant === 'awaiting' ? 'border-l-warning/60' : 'border-l-muted-foreground/30';
  const labelTone = variant === 'awaiting' ? 'text-warning' : 'text-muted-foreground';
  const label = variant === 'awaiting'
    ? `Awaiting decision${grace !== null ? ` · ${grace}d left` : ''}`
    : variant === 'no_response'
      ? 'Ended — no response'
      : variant === 'declined'
        ? `Ended — declined${lead.close_reason ? ` (${lead.close_reason.replace(/-/g, ' ')})` : ''}`
        : 'Closed';

  return (
    <Card
      className={cn('hover:border-primary/25 transition-colors cursor-pointer border-l-[3px]', borderTone)}
      onClick={() => onSelect(lead)}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-medium truncate">{lead.companyName}</h3>
              <span className={cn('text-[10px]', labelTone)}>{label}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
              <span className="text-foreground/70">{lead.contactName}</span>
              {owner && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span>{owner.name?.split(' ')[0]}</span>
                </>
              )}
              {trialEnd && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span>Trial ended {trialEnd}</span>
                </>
              )}
            </div>
          </div>
          {variant === 'awaiting' && onContinue && onDecline && (
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm" variant="outline" className="h-7 text-[11px]"
                onClick={e => { e.stopPropagation(); onDecline(); }}
              >
                Declined
              </Button>
              <Button
                size="sm" className="h-7 text-[11px]"
                onClick={e => { e.stopPropagation(); onContinue(); }}
              >
                Continuing
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Counter({ value, label, tone }: { value: number; label: string; tone: string }) {
  if (value === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/40 bg-card/50 text-xs">
      <span className={cn('font-semibold tabular-nums', tone)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function EmptyCard({ icon: Icon, message }: { icon: typeof XCircle; message: string }) {
  return (
    <Card className="py-8 text-center">
      <Icon className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </Card>
  );
}
