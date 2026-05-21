/**
 * STYLIQUE CRM — Contacts Page V5
 * True universal index: company, contact, owner, flow, source, stage, next action.
 * Strict badge hierarchy: primary lifecycle + secondary operational + micro labels.
 */
import { useMemo, useState } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { Lead, TEAM_MEMBERS, PLATFORM_LABELS, CONVERTED_STAGES, hasValidCredentials } from '@/types/crm';
import { BrandProgressInline } from '@/components/BrandProgressBadge';
import {
  getCanonicalState, isActionableForRole,
  FLOW_LABELS, SOURCE_LABELS, type CanonicalState, type ViewerRole,
} from '@/engine/canonical-state';
import { useUser } from '@/lib/user-context';
import { CompanyDetailSheet } from '@/components/CompanyDetailSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, Building2, Inbox, UserCheck, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCommercialState } from '@/engine/commercial-state';

type ContactFilter = 'all' | 'active_leads' | 'meeting_stage' | 'decision_pending' | 'cold' | 'clients' | 'closed';
type LeadershipFilter = 'all' | 'active_leads' | 'client_review' | 'onboarding_queue' | 'active_clients' | 'pilot' | 'overdue' | 'history';
type OnboardingFilter = 'all' | 'onboarding_queue' | 'active_clients';

const FLOW_ICONS: Record<string, typeof Inbox> = {
  inbound: Inbox, sdr_manual: UserCheck,
};

function getLifecycleGroup(cs: CanonicalState): ContactFilter {
  if (['closed', 'lost', 'unsubscribed'].includes(cs.lifecycle_stage)) return 'closed';
  if (cs.lifecycle_stage === 'cold_no_response') return 'cold';
  if (['internal_decision', 'pricing_discussion'].includes(cs.lifecycle_stage)) return 'decision_pending';
  // Clients: anything from Moved to Client Review onward.
  if (['trial_proposed', 'trial_ready', 'trial_active', 'conversion_pending', 'converted'].includes(cs.lifecycle_stage)) {
    return 'clients';
  }
  if (['meeting_booked', 'meeting_completed'].includes(cs.lifecycle_stage)) return 'meeting_stage';
  // Active Leads: New / Contacted / Replied / Decision Pending
  return 'active_leads';
}

function getLeadershipGroup(lead: Lead): LeadershipFilter {
  const state = getCommercialState(lead);
  if (state === 'conversion_pending' || state === 'client_review') return 'client_review';
  if (state === 'onboarding_pending') return hasValidCredentials(lead) ? 'onboarding_queue' : 'client_review';
  if (state === 'pilot') return 'pilot';
  if (state === 'active_client' || state === 'payment_due_soon') return 'active_clients';
  if (state === 'overdue') return 'overdue';
  if (state === 'closed_lost' || state === 'closed') return 'history';
  return 'active_leads';
}

function getOnboardingGroup(lead: Lead): OnboardingFilter {
  const state = getCommercialState(lead);
  if (state === 'onboarding_pending' && hasValidCredentials(lead)) return 'onboarding_queue';
  if (state === 'active_client' || state === 'payment_due_soon' || state === 'pilot') return 'active_clients';
  return 'onboarding_queue';
}

export default function ContactsPage() {
  const { companies: leads, refresh } = useCompanyStore();
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<ContactFilter | LeadershipFilter>('all');
  const [onboardingTab, setOnboardingTab] = useState<OnboardingFilter>('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { currentUser, isLeadership, isOnboarding, isSdr } = useUser();

  const viewerRole: ViewerRole = isLeadership ? 'ceo' : isOnboarding ? 'onboarding' : 'sdr';

  // Role-scoped contact visibility
  const baseLeads = useMemo(() => {
    if (isOnboarding) {
      return leads.filter(l => {
        if (l.assigned_onboarding_owner === currentUser) return true;
        const state = getCommercialState(l);
        if (state === 'onboarding_pending' && hasValidCredentials(l)) return true;
        if (state === 'active_client' || state === 'payment_due_soon' || state === 'pilot') return true;
        return false;
      });
    }
    if (isLeadership) return leads;
    return leads.filter(l => l.assignedTo === currentUser || l.assigned_sdr === currentUser);
  }, [leads, isOnboarding, isLeadership, currentUser]);

  const filtered = useMemo(() => {
    return baseLeads.filter(l => {
      const q = search.toLowerCase();
      const matchesSearch = !q || l.companyName.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        (l.contactEmail || '').toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (isOnboarding) {
        if (onboardingTab === 'all') return true;
        return getOnboardingGroup(l) === onboardingTab;
      }
      if (filterStage === 'all') return true;
      if (isLeadership) return getLeadershipGroup(l) === filterStage;
      const cs = getCanonicalState(l);
      return getLifecycleGroup(cs) === filterStage;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [baseLeads, search, filterStage, onboardingTab, isOnboarding, isLeadership]);

  const counts = useMemo(() => {
    const c = { total: baseLeads.length, active_leads: 0, meeting_stage: 0, decision_pending: 0, cold: 0, clients: 0, closed: 0 };
    baseLeads.forEach(l => {
      const cs = getCanonicalState(l);
      const group = getLifecycleGroup(cs);
      c[group]++;
    });
    return c;
  }, [baseLeads]);

  const leadershipCounts = useMemo(() => {
    const c = { all: baseLeads.length, active_leads: 0, client_review: 0, onboarding_queue: 0, active_clients: 0, pilot: 0, overdue: 0, history: 0 };
    baseLeads.forEach(l => { c[getLeadershipGroup(l)]++; });
    return c;
  }, [baseLeads]);

  const onboardingCounts = useMemo(() => {
    const c = { all: baseLeads.length, onboarding_queue: 0, active_clients: 0 };
    baseLeads.forEach(l => { c[getOnboardingGroup(l)]++; });
    return c;
  }, [baseLeads]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
        </div>
        {isSdr && <Badge variant="outline" className="text-xs">Mine</Badge>}
      </div>

      {/* Filter tabs — onboarding gets its own scoped buckets */}
      {isOnboarding ? (
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', count: onboardingCounts.all },
            { key: 'onboarding_queue' as const, label: 'Onboarding Queue', count: onboardingCounts.onboarding_queue },
            { key: 'active_clients' as const, label: 'Active Clients', count: onboardingCounts.active_clients },
          ]).map(item => (
            <button
              key={item.key}
              onClick={() => setOnboardingTab(item.key)}
              className={cn(
                "text-xs px-2.5 py-1.5 rounded-md transition-colors tabular-nums",
                onboardingTab === item.key
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {item.label} <span className="font-semibold ml-0.5">{item.count}</span>
            </button>
          ))}
        </div>
      ) : isLeadership ? (
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'all' as const, label: 'All Contacts', count: leadershipCounts.all },
            { key: 'active_leads' as const, label: 'Active Leads', count: leadershipCounts.active_leads },
            { key: 'client_review' as const, label: 'Client Review', count: leadershipCounts.client_review },
            { key: 'onboarding_queue' as const, label: 'Onboarding Queue', count: leadershipCounts.onboarding_queue },
            { key: 'pilot' as const, label: 'Pilot', count: leadershipCounts.pilot },
            { key: 'active_clients' as const, label: 'Active Clients', count: leadershipCounts.active_clients },
            { key: 'overdue' as const, label: 'Overdue', count: leadershipCounts.overdue },
            { key: 'history' as const, label: 'History', count: leadershipCounts.history },
          ]).map(item => (
            <button
              key={item.key}
              onClick={() => setFilterStage(item.key)}
              className={cn(
                "text-xs px-2.5 py-1.5 rounded-md transition-colors tabular-nums",
                filterStage === item.key
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {item.label} <span className="font-semibold ml-0.5">{item.count}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', count: counts.total },
            { key: 'active_leads' as const, label: 'Active Leads', count: counts.active_leads },
            { key: 'meeting_stage' as const, label: 'Meeting Stage', count: counts.meeting_stage },
            { key: 'decision_pending' as const, label: 'Decision Pending', count: counts.decision_pending },
            { key: 'cold' as const, label: 'Cold', count: counts.cold },
            { key: 'clients' as const, label: 'Clients', count: counts.clients },
            { key: 'closed' as const, label: 'Closed', count: counts.closed },
          ]).map(item => (
            <button
              key={item.key}
              onClick={() => setFilterStage(item.key)}
              className={cn(
                "text-xs px-2.5 py-1.5 rounded-md transition-colors tabular-nums",
                filterStage === item.key
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {item.label} <span className="font-semibold ml-0.5">{item.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search company, contact, or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">No contacts match your search</p>
        </Card>
      ) : (
        <div className="space-y-1">
          {filtered.map(lead => {
            const cs = getCanonicalState(lead);
            const owner = TEAM_MEMBERS.find(m => m.id === lead.assignedTo);
            const FlowIcon = FLOW_ICONS[cs.entry_flow] || UserCheck;
            const actionable = isActionableForRole(cs, viewerRole, currentUser, lead);

            // Build contextual "why" line — natural language
            const getContextLine = (): string | null => {
              if (cs.next_action_owner_role === 'automation') return 'Queued';
              if (!actionable && cs.next_action_owner_role === 'onboarding') return 'Onboarding owns this';
              if (!actionable && cs.next_action_owner_role === 'leadership') return 'Awaiting leadership decision';
              if (!actionable && cs.next_action_owner_role === 'sdr' && viewerRole !== 'sdr') return `${owner?.name?.split(' ')[0] || 'SDR'} handling next step`;
              // Trial-stage context lines removed — trial flow hidden.
              if (cs.lifecycle_stage === 'meeting_booked') {
                const nextMeeting = lead.meetingNotes?.find(m => new Date(m.date) > new Date());
                if (nextMeeting) return `Meeting on ${new Date(nextMeeting.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                return 'Meeting scheduled';
              }
              if (cs.lifecycle_stage === 'contacted') {
                const daysSince = cs.days_since_contact;
                if (daysSince >= 5) return `No reply for ${daysSince}d — follow up due`;
                if (daysSince >= 3) return `Awaiting reply — ${daysSince}d since contact`;
                return 'Awaiting reply';
              }
              return null;
            };
            const contextLine = getContextLine();

            // Leadership view: one clean status, no SDR micro-noise
            if (isLeadership) {
              return (
                <Card
                  key={lead.id}
                  className="hover:border-primary/20 transition-colors cursor-pointer"
                  onClick={() => setSelectedLead(lead)}
                >
                  <CardContent className="py-2.5 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-medium truncate">{lead.companyName}</h3>
                          <Badge variant={cs.primary_badge.variant} className={cn("text-[10px] shrink-0", cs.primary_badge.color)}>
                            {cs.primary_badge.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                          <span>{lead.contactName}</span>
                          {owner && <><span>·</span><span>{owner.name?.split(' ')[0]}</span></>}
                        </div>
                        {contextLine && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{contextLine}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            // SDR / Onboarding view: full execution detail
            return (
              <Card
                key={lead.id}
                className="hover:border-primary/20 transition-colors cursor-pointer"
                onClick={() => setSelectedLead(lead)}
              >
                <CardContent className={cn("py-2.5 px-4", !actionable && 'opacity-75')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-medium truncate">{lead.companyName}</h3>
                        <Badge variant={cs.primary_badge.variant} className={cn("text-[10px] shrink-0", cs.primary_badge.color)}>
                          {cs.primary_badge.label}
                        </Badge>
                        {cs.secondary_badge && (
                          <Badge variant={cs.secondary_badge.variant} className={cn("text-[10px] shrink-0", cs.secondary_badge.color)}>
                            {cs.secondary_badge.label}
                          </Badge>
                        )}
                        <BrandProgressInline lead={lead} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                        <span>{lead.contactName}</span>
                        {owner && <><span>·</span><span>{owner.name?.split(' ')[0]}</span></>}
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <FlowIcon className="h-2.5 w-2.5" />
                          {FLOW_LABELS[cs.entry_flow]}
                        </span>
                        {cs.source_channel !== 'other' && (
                          <><span>·</span><span>{SOURCE_LABELS[cs.source_channel] || cs.source_channel}</span></>
                        )}
                      </div>
                      {cs.next_action_label && cs.next_required_action !== 'no_action' && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5 truncate">
                          <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{cs.next_action_label}</span>
                          {cs.next_action_owner_role !== 'none' && (
                            <span className={cn("shrink-0 ml-0.5",
                              actionable ? "text-primary font-medium" : "text-muted-foreground/60 italic"
                            )}>
                              ({actionable ? 'you' : cs.next_action_owner_role})
                            </span>
                          )}
                        </p>
                      )}
                      {contextLine && (
                        <p className="text-[9px] text-muted-foreground/60 mt-0.5 italic truncate">{contextLine}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CompanyDetailSheet
        open={!!selectedLead}
        onOpenChange={open => { if (!open) { setSelectedLead(null); refresh(); } }}
        lead={selectedLead}
        defaultTab="overview"
        onAction={(action) => {
          if (action === 'linkedin' && selectedLead?.linkedin) {
            window.open(selectedLead.linkedin, '_blank');
          }
        }}
        onLeadUpdate={(updated) => { refresh(); setSelectedLead(updated); }}
      />
    </div>
  );
}
