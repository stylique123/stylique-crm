/**
 * STYLIQUE CRM — Contacts Page V5
 * True universal index: company, contact, owner, flow, source, stage, next action.
 * Strict badge hierarchy: primary lifecycle + secondary operational + micro labels.
 */
import { useMemo, useState } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { Lead, TEAM_MEMBERS, PLATFORM_LABELS, CONVERTED_STAGES } from '@/types/crm';
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
import { getLifecycleBucket } from '@/engine/post-trial';

type ContactFilter = 'all' | 'active_leads' | 'meeting_stage' | 'cold' | 'clients' | 'closed';
type OnboardingFilter = 'all' | 'trial_contacts' | 'activation_ready' | 'active_clients' | 'checkin_due';
type OwnerFilter = 'mine' | 'all';

const FLOW_ICONS: Record<string, typeof Inbox> = {
  inbound: Inbox, sdr_manual: UserCheck,
};

function getLifecycleGroup(cs: CanonicalState): ContactFilter {
  if (['closed', 'lost', 'unsubscribed'].includes(cs.lifecycle_stage)) return 'closed';
  if (cs.lifecycle_stage === 'cold_no_response') return 'cold';
  // Clients: anything from Moved to Client Review onward.
  if (['trial_proposed', 'trial_ready', 'trial_active', 'conversion_pending', 'converted'].includes(cs.lifecycle_stage)) {
    return 'clients';
  }
  if (['meeting_booked', 'meeting_completed'].includes(cs.lifecycle_stage)) return 'meeting_stage';
  // Active Leads: New / Contacted / Replied / Decision Pending
  return 'active_leads';
}

/** Onboarding-specific bucket: which onboarding stage does this lead represent? */
function getOnboardingGroup(lead: import('@/types/crm').Lead): OnboardingFilter {
  // Drive bucketing from the canonical lifecycle bucket — never raw stage.
  const bucket = getLifecycleBucket(lead);
  if (bucket === 'trial_ready_to_start') return 'activation_ready';
  if (bucket === 'trial_pending_approval' || bucket === 'trial_ready_to_start_blocked') return 'trial_contacts';
  if (bucket === 'trial_active' || bucket === 'trial_ending_soon' || bucket === 'trial_ended_awaiting') {
    // Check-in due if no recent check-in meeting in last 3 days
    const recent = (lead.meetings || []).find(m =>
      m.meeting_source === 'onboarding_checkin' &&
      (Date.now() - new Date(m.scheduled_at).getTime()) < 3 * 86400000
    );
    return recent ? 'active_clients' : 'checkin_due';
  }
  if (bucket === 'converted' || bucket === 'payment_window_open') return 'active_clients';
  return 'trial_contacts';
}

export default function ContactsPage() {
  const { companies: leads, refresh } = useCompanyStore();
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<ContactFilter>('all');
  const [onboardingTab, setOnboardingTab] = useState<OnboardingFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('mine');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const { currentUser, isLeadership, isOnboarding, isSdr } = useUser();

  const viewerRole: ViewerRole = isLeadership ? 'ceo' : isOnboarding ? 'onboarding' : 'sdr';

  // Role-scoped contact visibility
  const baseLeads = useMemo(() => {
    if (isOnboarding) {
      // Onboarding-relevant only:
      //  • trials in any setup/active state (proposed, ready, blocked, active)
      //  • payment-pending trials still owned by onboarding
      //  • newly converted clients within onboarding window (14d)
      //  • any record explicitly assigned to onboarding owner
      const ONBOARDING_WINDOW_MS = 14 * 86400000;
      return leads.filter(l => {
        if (l.assigned_onboarding_owner === currentUser) return true;
        const b = getLifecycleBucket(l);
        if (b === 'trial_pending_approval' || b === 'trial_ready_to_start'
            || b === 'trial_ready_to_start_blocked' || b === 'trial_active'
            || b === 'trial_ending_soon' || b === 'trial_ended_awaiting'
            || b === 'payment_window_open') return true;
        if (b === 'converted' && l.paymentReceivedAt) {
          const t = new Date(l.paymentReceivedAt).getTime();
          if (Number.isFinite(t) && Date.now() - t <= ONBOARDING_WINDOW_MS) return true;
        }
        return false;
      });
    }
    if (isLeadership) return leads;
    if (ownerFilter === 'all') return leads;
    return leads.filter(l => l.assignedTo === currentUser || l.assigned_sdr === currentUser);
  }, [leads, isSdr, isOnboarding, isLeadership, ownerFilter, currentUser]);

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
      const cs = getCanonicalState(l);
      return getLifecycleGroup(cs) === filterStage;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [baseLeads, search, filterStage, onboardingTab, isOnboarding]);

  const counts = useMemo(() => {
    const c = { total: baseLeads.length, active_leads: 0, meeting_stage: 0, cold: 0, clients: 0, closed: 0 };
    baseLeads.forEach(l => {
      const cs = getCanonicalState(l);
      const group = getLifecycleGroup(cs);
      c[group]++;
    });
    return c;
  }, [baseLeads]);

  const onboardingCounts = useMemo(() => {
    const c = { all: baseLeads.length, trial_contacts: 0, activation_ready: 0, active_clients: 0, checkin_due: 0 };
    baseLeads.forEach(l => { c[getOnboardingGroup(l)]++; });
    return c;
  }, [baseLeads]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
        </div>
        {isSdr && (
          <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
            <button
              onClick={() => setOwnerFilter('mine')}
              className={cn("px-3 py-1 text-xs rounded-md transition-colors", ownerFilter === 'mine' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground')}
            >
              Mine
            </button>
            <button
              onClick={() => setOwnerFilter('all')}
              className={cn("px-3 py-1 text-xs rounded-md transition-colors", ownerFilter === 'all' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground')}
            >
              All
            </button>
          </div>
        )}
      </div>

      {/* Filter tabs — onboarding gets its own scoped buckets */}
      {isOnboarding ? (
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', count: onboardingCounts.all },
            { key: 'active_clients' as const, label: 'Active Clients', count: onboardingCounts.active_clients },
            { key: 'checkin_due' as const, label: 'Check-in Due', count: onboardingCounts.checkin_due },
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
      ) : (
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', count: counts.total },
            { key: 'active_leads' as const, label: 'Active Leads', count: counts.active_leads },
            { key: 'meeting_stage' as const, label: 'Meeting Stage', count: counts.meeting_stage },
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
              if (cs.next_action_owner_role === 'automation') return 'AI sequence running';
              if (!actionable && cs.next_action_owner_role === 'onboarding') return 'Onboarding managing trial';
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
