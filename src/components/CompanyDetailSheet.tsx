/**
 * CompanyDetailSheet — Universal company truth view + DECISION CENTER.
 * 
 * V2: focusAction prop auto-opens the correct modal on mount.
 * No more "generic overview" dead-ends.
 */
import { useState, useMemo, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { format, differenceInDays, differenceInMonths } from 'date-fns';
import {
  Lead, Activity, PIPELINE_LABELS, TEAM_MEMBERS,
  PLAN_LABELS, PLAN_PRICES, getTrialDaysLeft, hasValidCredentials,
  PAYMENT_STATUS_LABELS,
  recalculateNextAction,
  getActiveDeal, getProposedDeal, formatMoney, CURRENCY_LABELS, REGION_LABELS,
  type Currency, type Region, type SubscriptionPlan,
} from '@/types/crm';
import { getLedger, getCurrentBillingEntry } from '@/engine/payment-ledger';
import { useCompanyStore } from '@/lib/company-store';
import { uid } from '@/lib/store';
import { type StepOutcome, getNextActionFromOutcome } from '@/engine/decision-engine';
import { deriveScenarioContext } from '@/engine/canonical-state';
import { StepExecutionPanel } from '@/components/StepExecutionPanel';
import { LeadershipActionPanel } from '@/components/LeadershipActionPanel';
import { TrialSetupDialog, type TrialSetupResult } from '@/components/TrialSetupDialog';
import { CredentialsDialog } from '@/components/CredentialsDialog';
import {
  executeAtomicTrialSetup, executeTrialActivation,
  executeCredentialsSave,
  commitLeadMutation,
} from '@/engine/action-executor';
import { invalidateOnStageChange } from '@/engine/state-machine';
import {
  getCanonicalTrialState, getTrialRole, getRoleTrialAction,
  getVisibleTrialTasks, canViewCredentials, canEditCredentials, maskCredentialValue,
} from '@/engine/trial-engine';
import { useUser } from '@/lib/user-context';
import {
  canCurrentRoleAct, getReadOnlyStatusLabel, getVisibleTabs, type ViewerRole,
} from '@/engine/canonical-state';
import { getCanonicalLeadView, type CanonicalLeadView } from '@/engine/canonical-view';
import { BUCKET_LABELS, type LifecycleBucket } from '@/engine/post-trial';
import { resolveAction, type ActionIntent } from '@/engine/action-router';
import { getNextBestAction, getChannelColor } from '@/engine/nba-engine';
import {
  Building2, User, Mail, Phone, Globe, Instagram, Linkedin as LinkedinIcon,
  Calendar, Clock, CreditCard, FlaskConical, ArrowRight, CheckCircle,
  AlertCircle, Shield, Package, ExternalLink, FileText, Key, MessageSquare,
  ChevronRight, DollarSign, EyeOff, Eye, Rocket, X, Copy, Inbox,
  UserCheck as UserCheckIcon, Info, Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { showActionToast, showErrorToast } from '@/lib/toast-dedup';
import { BrandProgressBadge } from '@/components/BrandProgressBadge';
import { getCommercialState, COMMERCIAL_LABEL } from '@/engine/commercial-state';
type Tab = 'overview' | 'contact' | 'lifecycle' | 'meetings' | 'payment' | 'credentials' | 'timeline' | 'notes';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'contact', label: 'Contact', icon: User },
  { id: 'lifecycle', label: 'Lifecycle', icon: ChevronRight },
  { id: 'meetings', label: 'Meetings', icon: Calendar },
  // Trial tab removed — trial flow is hidden across the app.
  { id: 'payment', label: 'Payment', icon: CreditCard },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
];

const ENTRY_FLOW_LABELS: Record<string, string> = {
  'inbound': 'Inbound',
  'sdr_manual': 'SDR Manual',
  'sdr-manual': 'SDR Manual',
};

const SOURCE_LABELS: Record<string, string> = {
  'instagram': 'Instagram', 'google_search': 'Google Search', 'linkedin_evaboot': 'LinkedIn (Eva)',
  'website_demo': 'Website Demo', 'website_form': 'Website Form', 'whatsapp': 'WhatsApp',
  'instagram_dm': 'Instagram DM', 'linkedin_dm': 'LinkedIn DM', 'email_inbound': 'Email',
  'referral': 'Referral', 'other': 'Other',
};

/** Maps focusAction to the best default tab */
function getTabForAction(action: ActionIntent): Tab {
  switch (action) {
    case 'approve_trial': case 'trial_setup': return 'payment';
    case 'add_credentials': return 'credentials';
    case 'confirm_payment': return 'payment';
    case 'log_meeting_outcome': case 'book_meeting': return 'meetings';
    default: return 'overview';
  }
}

interface CompanyDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onAction?: (action: 'call' | 'email' | 'linkedin' | 'meeting' | 'credentials' | 'approve' | 'payment' | 'trial-setup') => void;
  onLeadUpdate?: (lead: Lead) => void;
  defaultTab?: Tab;
  /** Auto-open the correct modal on mount — replaces generic "open_record" */
  focusAction?: ActionIntent;
  /** Why user was routed here */
  entryReason?: string;
}

export function CompanyDetailSheet({ open, onOpenChange, lead, onAction, onLeadUpdate, defaultTab, focusAction, entryReason }: CompanyDetailSheetProps) {
  const resolvedTab = focusAction ? getTabForAction(focusAction) : (defaultTab || 'overview');
  const [activeTab, setActiveTab] = useState<Tab>(resolvedTab);
  const [noteText, setNoteText] = useState('');
  const { companies: leads, activities: allActivities, saveCompany, addActivity: addAct } = useCompanyStore();
  const { currentUser, role } = useUser();
  const viewerRole: ViewerRole = role === 'ceo' || role === 'coo' ? role : role === 'onboarding' ? 'onboarding' : 'sdr';

  const bridge = useMemo(() => ({ saveCompany, addActivity: addAct }), [saveCompany, addAct]);

  // In-sheet dialog state
  const [trialSetupOpen, setTrialSetupOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);

  // Auto-open the correct modal when focusAction is set
  useEffect(() => {
    if (!open || !lead || !focusAction) return;
    // Set tab
    const tab = getTabForAction(focusAction);
    setActiveTab(tab);
    // Auto-open modal after a small delay so sheet renders first
    const timer = setTimeout(() => {
      switch (focusAction) {
        case 'approve_trial':
        case 'trial_setup':
          // Hard guard: only leadership can open trial setup / credentials.
          if (viewerRole === 'ceo' || viewerRole === 'coo') setTrialSetupOpen(true);
          break;
        case 'add_credentials':
          // Hard guard: onboarding/sdr cannot open credentials editor.
          if (viewerRole === 'ceo' || viewerRole === 'coo') setCredentialsOpen(true);
          break;
        case 'confirm_payment':
          onAction?.('payment');
          break;
        case 'book_meeting':
          onAction?.('meeting');
          break;
        case 'log_meeting_outcome':
          // stays on meetings tab — outcome panel is inline
          break;
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [open, lead?.id, focusAction, viewerRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset tab when lead changes
  useEffect(() => {
    if (open && lead) {
      setActiveTab(focusAction ? getTabForAction(focusAction) : (defaultTab || 'overview'));
    }
  }, [lead?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activities = useMemo(() => {
    if (!lead) return [];
    return allActivities.filter(a => a.leadId === lead.id).slice(0, 50);
  }, [lead, allActivities]);

  if (!lead) return null;

  // CRITICAL: Always read FRESH lead from store
  const freshLead = leads.find(l => l.id === lead.id) || lead;

  const owner = TEAM_MEMBERS.find(m => m.id === freshLead.assignedTo);
  const trialDays = getTrialDaysLeft(freshLead);
  const hasCreds = hasValidCredentials(freshLead);
  const _activeDealForHeader = getActiveDeal(freshLead);
  const plan = _activeDealForHeader.package;
  const amount = _activeDealForHeader.value;
  const isLeadershipViewer = viewerRole === 'ceo' || viewerRole === 'coo';
  // CANONICAL VIEW — the ONE source of truth for all visible meaning AND
  // for the action panels (LeadershipActionPanel / StepExecutionPanel).
  // decision-engine is no longer consulted from this sheet flow.
  const view = getCanonicalLeadView(freshLead, role, currentUser);
  const lifecycleStages = getLifecycleStagesFromView(view);
  const trialInfo = getTrialDayInfo(freshLead);

  // Ownership gating
  const isActionable = canCurrentRoleAct(freshLead, viewerRole, currentUser);
  const readOnlyLabel = !isActionable ? getReadOnlyStatusLabel(freshLead, viewerRole) : null;
  const visibleTabSet = getVisibleTabs(freshLead, viewerRole);
  const filteredTabs = TABS.filter(t => visibleTabSet.has(t.id));

  // SDR-context bucket label override — strip trial/pricing wording.
  const sdrBucketLabel = (() => {
    if (viewerRole !== 'sdr') return null;
    switch (view.bucket) {
      case 'trial_pending_approval':
      case 'trial_ready_to_start':
      case 'trial_ready_to_start_blocked':
        return 'Moved to Client Review';
      case 'trial_active':
      case 'trial_ending_soon':
      case 'trial_ended_awaiting':
        return 'Pilot';
      case 'payment_window_open':
        return 'Client Review';
      default:
        return null;
    }
  })();
  const headerBadgeLabel = sdrBucketLabel || BUCKET_LABELS[view.bucket] || view.state.next_action_label || 'Lead';
  const timeline = buildUnifiedTimeline(freshLead, activities);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSaveNote = () => {
    if (!noteText.trim()) return;
    const updated = { ...freshLead, notes: freshLead.notes ? `${freshLead.notes}\n\n[${format(new Date(), 'MMM d, h:mm a')}] ${noteText}` : `[${format(new Date(), 'MMM d, h:mm a')}] ${noteText}`, updatedAt: new Date().toISOString() };
    commitLeadMutation(bridge, { lead: updated });
    onLeadUpdate?.(updated);
    setNoteText('');
    showActionToast(freshLead.id, 'note-saved', 'Note saved');
  };

  const handleOutcomeSubmit = (outcome: StepOutcome, notes: string) => {
    const now = new Date().toISOString();
    const latest = leads.find(l => l.id === freshLead.id) || freshLead;
    const nextStep = getNextActionFromOutcome(latest, outcome);
    
    let updated: Lead = { ...latest, updatedAt: now, lastContactedAt: now };

    if (nextStep.stage) {
      // Canonical activation path: outcome wants to move into trial-active AND
      // canonical permissions confirm this lead is ready for activation.
      const latestView = getCanonicalLeadView(latest, role, currentUser);
      if (nextStep.stage === 'trial-active' && latestView.permissions.canActivateTrial) {
        const result = executeTrialActivation(latest, currentUser, bridge);
        if (result.success) {
          onLeadUpdate?.(result.lead);
          showActionToast(latest.id, 'trial-activated', result.message);
        } else {
          showErrorToast(`${latest.id}:trial-activate`, result.message);
        }
        return;
      }
      updated = invalidateOnStageChange(updated, nextStep.stage as Lead['stage']);
      if (outcome === 'paid') {
        updated.paymentStatus = 'paid';
        updated.paymentReceivedAt = now;
      }
    }

    updated.actionCompletions = [
      ...(updated.actionCompletions || []),
      { id: uid(), action: `${view.nextActionLabel} → ${outcome}`, completedAt: now, completedBy: currentUser, notes },
    ];

    const intel = recalculateNextAction(updated);
    updated = { ...updated, nextAction: intel.action, nextActionReason: intel.reason, nextActionUrgency: intel.urgency, nextFollowUp: intel.followUpDate };

    commitLeadMutation(bridge, {
      lead: updated,
      activity: {
        id: uid(), leadId: freshLead.id, type: 'action-completed',
        description: `✓ ${view.nextActionLabel} → ${outcome}${notes ? ` — ${notes}` : ''}`,
        createdAt: now, createdBy: currentUser,
      },
    });

    onLeadUpdate?.(updated);
    showActionToast(freshLead.id, `outcome-${outcome}`, `Outcome added: ${outcome}`, `Next: ${nextStep.action}`);
  };

  const handleAction = (action: 'call' | 'email' | 'linkedin' | 'meeting' | 'credentials' | 'approve' | 'payment' | 'trial-setup') => {
    // HARD-BLOCK via canonical permissions. The single source of truth for
    // "can this role click this button on this record" — see canonical-view.ts.
    const view = getCanonicalLeadView(freshLead, role, currentUser);
    if (action === 'trial-setup' && !view.permissions.canApproveTrial && !view.permissions.canEditCredentials) return;
    if (action === 'credentials' && !view.permissions.canEditCredentials) return;
    if (action === 'approve' && !view.permissions.canApproveTrial && !view.permissions.canActivateTrial) return;
    if (action === 'payment' && !view.permissions.canConfirmPayment) return;
    if (action === 'trial-setup') {
      setTrialSetupOpen(true);
      return;
    }
    if (action === 'credentials') {
      setCredentialsOpen(true);
      return;
    }
    if (action === 'approve') {
      // Canonical: if this record is ready to activate (approved + creds in
      // place), execute activation directly. Otherwise open the trial setup
      // dialog so leadership can fill the gap.
      const latest = leads.find(l => l.id === freshLead.id) || freshLead;
      const latestView = getCanonicalLeadView(latest, role, currentUser);
      if (latestView.permissions.canActivateTrial || latestView.bucket === 'trial_ready_to_start') {
        handleActivateTrial();
        return;
      }
      setTrialSetupOpen(true);
      return;
    }
    onAction?.(action);
  };

  const handleTrialSetupComplete = (result: TrialSetupResult) => {
    const latest = leads.find(l => l.id === freshLead.id) || freshLead;
    const execResult = executeAtomicTrialSetup(latest, currentUser, bridge, result);
    setTrialSetupOpen(false);
    onLeadUpdate?.(execResult.lead);
    showActionToast(latest.id, 'trial-setup', execResult.message);
  };

  const handleActivateTrial = () => {
    const latest = leads.find(l => l.id === freshLead.id) || freshLead;
    const result = executeTrialActivation(latest, currentUser, bridge);
    if (!result.success) {
      showErrorToast(`${latest.id}:trial-activate`, result.message);
      return;
    }
    onLeadUpdate?.(result.lead);
    showActionToast(latest.id, 'trial-activated', result.message);
  };

  const handleCredentialsSave = (creds: { username: string; password: string; loginUrl?: string; installationNotes?: string }) => {
    const latest = leads.find(l => l.id === freshLead.id) || freshLead;
    const result = executeCredentialsSave(latest, currentUser, bridge, creds);
    setCredentialsOpen(false);
    onLeadUpdate?.(result.lead);
    showActionToast(latest.id, 'credentials-saved', result.message);
  };

  // Entry flow / source info
  const entryFlow = freshLead.entry_flow || freshLead.entrySource;
  const sourceDetail = freshLead.source_detail;
  const entryFlowLabel = entryFlow ? (ENTRY_FLOW_LABELS[entryFlow] || entryFlow) : null;
  const sourceLabel = sourceDetail ? (SOURCE_LABELS[sourceDetail] || sourceDetail) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 pb-safe" side="right" hideDefaultClose>
        {/* Explicit close button — always visible */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 z-50 rounded-full p-1.5 bg-secondary/80 hover:bg-secondary text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b px-5 pt-5 pb-3">
          <SheetHeader className="pb-0 pr-8">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              {freshLead.companyName}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="secondary" className="text-[10px]">{headerBadgeLabel}</Badge>
              {entryFlowLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {entryFlow === 'inbound' ? <Inbox className="h-2.5 w-2.5 mr-0.5" /> :
                   <UserCheckIcon className="h-2.5 w-2.5 mr-0.5" />}
                  {entryFlowLabel}
                </Badge>
              )}
              {sourceLabel && <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>}
              {owner && <span className="text-[10px] text-muted-foreground">{owner.name}</span>}
            </SheetDescription>
            {/* Brand KPI progress — always visible in header */}
            <BrandProgressBadge lead={freshLead} size="md" showAddPrompt className="mt-2" />
          </SheetHeader>

          {/* Decision Center — Leadership gets leadership panel, others get execution */}
          {/* Entry reason banner — when user was deep-linked here */}
          {entryReason && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/15 mt-2">
              <Target className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-[11px] text-primary font-medium">{entryReason}</p>
            </div>
          )}

          {/* SDR view: no inline action/log panel — pure record viewer.
              Leadership/Onboarding still see their action panels. */}
          {viewerRole !== 'sdr' && (
            <div className="mt-3">
              {isLeadershipViewer ? (
                <LeadershipActionPanel
                  lead={freshLead}
                  view={view}
                  onAction={handleAction}
                  onOutcomeSubmit={handleOutcomeSubmit}
                />
              ) : isActionable ? (
                <StepExecutionPanel
                  lead={freshLead}
                  view={view}
                  onAction={handleAction}
                  onOutcomeSubmit={handleOutcomeSubmit}
                />
              ) : readOnlyLabel ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/50 border border-muted">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground">{readOnlyLabel}</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Tab Navigation — filtered by role+stage */}
          <div className="flex gap-0.5 mt-3 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-1 snap-x">
            {filteredTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "shrink-0 text-[10px] px-2.5 py-1.5 rounded-md transition-colors font-medium snap-start whitespace-nowrap",
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-5 py-4 space-y-4">
          {/* ─── OVERVIEW ─────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* "What Happens Next" guidance panel removed — record viewer should not coach. */}
              {/* Current Position — compact */}
              <Section title="Where This Stands">
                <InfoRow label="Stage" value={sdrBucketLabel || BUCKET_LABELS[view.bucket] || view.state.next_action_label || '—'} />
                <InfoRow label="Sales Owner" value={owner?.name || '—'} />
                {(() => {
                  const r = view.nextActionOwnerRole;
                  if (r === 'none' || r === 'sdr') return null;
                  let actionOwner = '—';
                  if (r === 'onboarding') {
                    const id = freshLead.assigned_onboarding_owner || 'muneeb';
                    actionOwner = TEAM_MEMBERS.find(m => m.id === id)?.name || 'Onboarding';
                  } else if (r === 'leadership') {
                    actionOwner = 'Leadership';
                  } else if (r === 'automation') {
                    actionOwner = 'Automation';
                  }
                  return <InfoRow label="Action Owner" value={actionOwner} />;
                })()}
                <InfoRow label="Next Action" value={view.nextActionLabel} />
                {freshLead.priority && <InfoRow label="Priority" value={freshLead.priority} />}
                {freshLead.nextFollowUp && (
                  <InfoRow label="Next Follow-up" value={format(new Date(freshLead.nextFollowUp), 'MMM d, yyyy')} />
                )}
                <InfoRow label="In Pipeline" value={`${Math.floor((Date.now() - new Date(freshLead.createdAt).getTime()) / 86400000)}d`} />
                {freshLead.lastContactedAt && (
                  <InfoRow label="Last Contact" value={format(new Date(freshLead.lastContactedAt), 'MMM d')} />
                )}
              </Section>

              {/* Recent Actions — only last 3 */}
              {freshLead.actionCompletions && freshLead.actionCompletions.length > 0 && (
                <Section title="Recent Actions">
                  {freshLead.actionCompletions.slice(-3).reverse().map(ac => (
                    <div key={ac.id} className="flex items-start gap-2 py-1 text-xs">
                      <CheckCircle className="h-3 w-3 text-success mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground/80">{ac.action}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(ac.completedAt), 'MMM d, h:mm a')}</p>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* Open Tasks — max 3 */}
              {freshLead.tasks && freshLead.tasks.filter(t => !t.completed && t.state !== 'cancelled').length > 0 && (
                <Section title={`Open Tasks (${freshLead.tasks.filter(t => !t.completed && t.state !== 'cancelled').length})`}>
                  {freshLead.tasks.filter(t => !t.completed && t.state !== 'cancelled').slice(0, 3).map(task => (
                    <div key={task.id} className="flex items-start gap-2 py-1 text-xs">
                      <Clock className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{task.title}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(task.dueDate), 'MMM d')} · {TEAM_MEMBERS.find(m => m.id === task.assignedTo)?.name?.split(' ')[0] || task.assignedTo}</p>
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}

          {/* ─── CONTACT ──────────────────────────────── */}
          {activeTab === 'contact' && (
            <>
              {/* Primary Contact */}
              <Section title="Primary Contact">
                <ContactRow icon={User} label="Name" value={freshLead.contactName} />
                {freshLead.contactRole && <InfoRow label="Role" value={freshLead.contactRole} />}
                <ContactRow icon={Mail} label="Email" value={freshLead.contactEmail} href={`mailto:${freshLead.contactEmail}`} />
                {freshLead.contactPhone && <ContactRow icon={Phone} label="Phone" value={freshLead.contactPhone} href={`tel:${freshLead.contactPhone}`} />}
                {freshLead.linkedin && <ContactRow icon={LinkedinIcon} label="LinkedIn" value={freshLead.linkedin} href={freshLead.linkedin} />}
                {freshLead.instagram && <ContactRow icon={Instagram} label="Instagram" value={freshLead.instagram} href={`https://instagram.com/${freshLead.instagram.replace('@', '')}`} />}
              </Section>

              {/* Secondary Contact */}
              {(freshLead.secondaryContact?.name || (freshLead.contacts && freshLead.contacts.length > 1)) && (
                <Section title="Secondary Contact">
                  {freshLead.secondaryContact?.name ? (
                    <>
                      <ContactRow icon={User} label="Name" value={freshLead.secondaryContact.name} />
                      {freshLead.secondaryContact.role && <InfoRow label="Role" value={freshLead.secondaryContact.role} />}
                      {freshLead.secondaryContact.email && <ContactRow icon={Mail} label="Email" value={freshLead.secondaryContact.email} href={`mailto:${freshLead.secondaryContact.email}`} />}
                      {freshLead.secondaryContact.phone && <ContactRow icon={Phone} label="Phone" value={freshLead.secondaryContact.phone} href={`tel:${freshLead.secondaryContact.phone}`} />}
                    </>
                  ) : freshLead.contacts && freshLead.contacts.length > 1 ? (
                    freshLead.contacts.slice(1).map(c => (
                      <div key={c.id} className="py-1">
                        <ContactRow icon={User} label="Name" value={c.name} />
                        {c.email && <ContactRow icon={Mail} label="Email" value={c.email} href={`mailto:${c.email}`} />}
                      </div>
                    ))
                  ) : null}
                </Section>
              )}

              {/* Brand Identity */}
              <Section title="Brand Info">
                {freshLead.website && <ContactRow icon={Globe} label="Website" value={freshLead.website} href={freshLead.website} />}
                {freshLead.platform && <InfoRow label="Platform" value={freshLead.platform} />}
                {/* Tier removed — tier classification hidden across app. */}
                <InfoRow label="Owner" value={owner?.name || '—'} />
                {entryFlowLabel && <InfoRow label="Entry Flow" value={entryFlowLabel} />}
                {sourceLabel && <InfoRow label="Source" value={sourceLabel} />}
              </Section>

              {/* Brand KPI progress */}
              <Section title="Brand Coverage">
                <BrandProgressBadge lead={freshLead} size="md" showAddPrompt />
              </Section>
            </>
          )}

          {/* ─── LIFECYCLE ────────────────────────────── */}
          {activeTab === 'lifecycle' && (
            <>
              <Section title="Full Lifecycle">
                <div className="space-y-1">
                  {lifecycleStages.map((ls, i) => (
                    <div key={ls.label} className="flex items-center gap-3">
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold",
                        ls.status === 'completed' ? 'bg-success/15 text-success' :
                        ls.status === 'current' ? 'bg-primary/15 text-primary ring-2 ring-primary/30' :
                        'bg-secondary text-muted-foreground'
                      )}>
                        {ls.status === 'completed' ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={cn("text-xs font-medium",
                            ls.status === 'current' ? 'text-primary' :
                            ls.status === 'completed' ? 'text-foreground' : 'text-muted-foreground'
                          )}>{ls.label}</span>
                          {ls.date && <span className="text-[10px] text-muted-foreground">{format(new Date(ls.date), 'MMM d')}</span>}
                        </div>
                        {ls.duration && (
                          <span className="text-[10px] text-muted-foreground">{ls.duration}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Time in Pipeline">
                <InfoRow label="Total days" value={`${Math.floor((Date.now() - new Date(freshLead.createdAt).getTime()) / (1000 * 60 * 60 * 24))}d`} />
                {freshLead.lastContactedAt && (
                  <InfoRow label="Last contact" value={format(new Date(freshLead.lastContactedAt), 'MMM d, h:mm a')} />
                )}
              </Section>
            </>
          )}

          {/* ─── MEETINGS ─────────────────────────────── */}
          {activeTab === 'meetings' && (
            <>
              {(!freshLead.meetingNotes || freshLead.meetingNotes.length === 0) ? (
                <EmptyState icon={Calendar} message="No meetings yet" />
              ) : (
                <Section title={`Meetings (${freshLead.meetingNotes.length})`}>
                  {freshLead.meetingNotes.map(m => (
                    <div key={m.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{format(new Date(m.date), 'MMM d, yyyy · h:mm a')}</span>
                        <Badge variant="secondary" className="text-[10px]">{m.type}</Badge>
                      </div>
                      {m.summary && <p className="text-xs text-muted-foreground">{m.summary}</p>}
                      {m.outcome && <p className="text-xs"><span className="text-muted-foreground">Outcome:</span> {m.outcome}</p>}
                      {m.actionItems.length > 0 && (
                        <div className="space-y-0.5">
                          {m.actionItems.map((item, j) => (
                            <p key={j} className="text-[10px] text-muted-foreground flex gap-1">
                              <span className="text-primary shrink-0">•</span> {item}
                            </p>
                          ))}
                        </div>
                      )}
                      {m.link && (
                        <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-2.5 w-2.5" /> Join link
                        </a>
                      )}
                    </div>
                  ))}
                </Section>
              )}
              {/* Book meeting CTA — visible only when canonical view says we are pre-trial and SDR-actionable */}
              {view.bucket === 'not_in_lifecycle' && view.nextActionOwnerRole === 'sdr' && !freshLead.trialStartDate && (
                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => handleAction('meeting')}>
                  <Calendar className="h-3 w-3 mr-1.5" /> Book Meeting
                </Button>
              )}
            </>
          )}

          {/* ─── PAYMENT (SaaS detail) ────────────────── */}
          {activeTab === 'payment' && (
            <PaymentTabContent lead={freshLead} amount={amount} onAction={handleAction} />
          )}

          {/* ─── CREDENTIALS (role-masked with reveal/copy) ─── */}
          {activeTab === 'credentials' && (
            <CredentialsTabContent lead={freshLead} hasCreds={hasCreds} onAction={handleAction} />
          )}

          {/* ─── TIMELINE ─────────────────────────────── */}
          {activeTab === 'timeline' && (
            <>
              {timeline.length === 0 ? (
                <EmptyState icon={Clock} message="No activity yet" />
              ) : (
                <Section title={`Timeline (${timeline.length})`}>
                  <div className="space-y-0">
                    {timeline.map((item, i) => (
                      <div key={item.id} className="flex gap-3 py-2 border-b border-muted/20 last:border-0">
                        <div className="flex flex-col items-center">
                          <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0",
                            item.kind === 'stage' ? 'bg-primary' :
                            item.kind === 'payment' ? 'bg-success' :
                            item.kind === 'meeting' ? 'bg-warning' :
                            item.kind === 'credentials' ? 'bg-info' :
                            'bg-muted-foreground'
                          )} />
                          {i < timeline.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="min-w-0 flex-1 pb-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-foreground">{item.title}</p>
                            <Badge variant="outline" className="text-[9px] shrink-0">{item.label}</Badge>
                          </div>
                          {item.detail && <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.detail}</p>}
                          <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(item.at), 'MMM d · h:mm a')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {/* ─── NOTES ────────────────────────────────── */}
          {activeTab === 'notes' && (
            <>
              <Section title="Add Note">
                <Textarea
                  placeholder="Type a note..."
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  className="text-xs min-h-[80px] resize-none"
                />
                <Button size="sm" className="h-7 text-xs mt-2" onClick={handleSaveNote} disabled={!noteText.trim()}>
                  Save Note
                </Button>
              </Section>
              {freshLead.notes && (
                <Section title="Notes History">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{freshLead.notes}</p>
                </Section>
              )}
            </>
          )}
        </div>

        {/* In-sheet dialogs */}
        <TrialSetupDialog
          open={trialSetupOpen}
          onOpenChange={setTrialSetupOpen}
          companyName={freshLead.companyName}
          contactName={freshLead.contactName}
          needsApproval={!freshLead.approvedBy}
          needsCredentials={!hasCreds}
          existingUsername={freshLead.credentials?.username}
          onComplete={handleTrialSetupComplete}
        />

        <CredentialsDialog
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
          companyName={freshLead.companyName}
          contactName={freshLead.contactName}
          hasExisting={hasCreds}
          existingUsername={freshLead.credentials?.username}
          onSave={handleCredentialsSave}
        />
      </SheetContent>
    </Sheet>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href }: { icon: typeof User; label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate flex items-center gap-1">
          {value} <ExternalLink className="h-2.5 w-2.5" />
        </a>
      ) : (
        <span className="font-medium truncate">{value}</span>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Clock; message: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Client Duration Helper ──────────────────────────────

function formatClientDuration(startDate: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const days = differenceInDays(now, start);
  const months = differenceInMonths(now, start);
  
  if (days === 0) return 'Client since today';
  if (days === 1) return 'Client for 1 day';
  if (months < 1) return `Client for ${days} days`;
  if (months === 1) return `Client for 1 month (${days}d)`;
  return `Client for ${months} months (${days}d)`;
}

// ─── Payment Tab (SaaS depth) ────────────────────────────

function PaymentTabContent({ lead, amount, onAction }: {
  lead: Lead;
  amount: number;
  onAction?: CompanyDetailSheetProps['onAction'];
}) {
  const { currentUser, role } = useUser();
  const view = getCanonicalLeadView(lead, role, currentUser);
  // ALL visible meaning here flows from canonical view — no raw stage checks.
  const isClient = view.isConverted;
  const overdueDays = lead.nextPaymentDate ? Math.max(0, differenceInDays(new Date(), new Date(lead.nextPaymentDate))) : 0;
  const showPaymentDecision = view.isPaymentDecision || view.isPaymentRisk;
  const canConfirm = view.permissions.canConfirmPayment;
  const canEditTerms = canConfirm; // CEO/COO only
  const activeDeal = getActiveDeal(lead);
  const proposedDeal = getProposedDeal(lead);
  const showProposed = !isClient; // before active client → terms are "proposed"
  const ledger = getLedger(lead);
  const cur = getCurrentBillingEntry(lead);
  
  return (
    <>
      <Section title="Commercial Info">
        <InfoRow
          label={showProposed ? 'Proposed Package' : 'Active Package'}
          value={PLAN_LABELS[(showProposed ? proposedDeal.package : activeDeal.package) as SubscriptionPlan]}
        />
        <InfoRow
          label={showProposed ? 'Proposed Value' : 'Active Value'}
          value={formatMoney(
            showProposed ? proposedDeal.value : activeDeal.value,
            (showProposed ? proposedDeal.currency : activeDeal.currency) as Currency,
          ) + '/mo'}
        />
        <InfoRow
          label="Currency"
          value={CURRENCY_LABELS[(showProposed ? proposedDeal.currency : activeDeal.currency) as Currency]}
        />
        {lead.region && <InfoRow label="Region" value={REGION_LABELS[lead.region]} />}
        <InfoRow label="Billing" value="Monthly" />
        <InfoRow label="Status" value={PAYMENT_STATUS_LABELS[lead.paymentStatus || 'pending'] || lead.paymentStatus || 'N/A'} />
        {(cur?.dueDate || lead.nextPaymentDate) && (
          <InfoRow
            label="Next Due"
            value={format(new Date(cur?.dueDate || lead.nextPaymentDate!), 'MMM d, yyyy')}
          />
        )}
        {lead.paymentStatus === 'overdue' && overdueDays > 0 && (
          <InfoRow label="Overdue" value={`${overdueDays} days`} />
        )}
        {canEditTerms && (
          <CommercialTermsEditor
            lead={lead}
            isClient={isClient}
          />
        )}
      </Section>

      {/* Payment Ledger — first-class billing history */}
      {ledger.length > 0 && (
        <Section title="Payment History">
          <div className="space-y-1">
            {ledger
              .slice()
              .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
              .map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{entry.billingMonth}</span>
                    <span className="text-muted-foreground/60 ml-2">
                      {format(new Date(entry.dueDate), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums">{formatMoney(entry.amount, entry.currency)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] h-4 px-1.5',
                        entry.status === 'paid' && 'text-success border-success/30',
                        entry.status === 'overdue' && 'text-destructive border-destructive/30',
                        entry.status === 'unpaid' && 'text-muted-foreground border-muted-foreground/30',
                      )}
                    >
                      {entry.status === 'paid' && entry.paidAt
                        ? `Paid ${format(new Date(entry.paidAt), 'MMM d')}`
                        : entry.status}
                    </Badge>
                  </div>
                </div>
              ))}
          </div>
        </Section>
      )}

      {isClient && (
        <Section title="Client Lifecycle">
          {lead.subscriptionStartDate && (
            <InfoRow label="Duration" value={formatClientDuration(lead.subscriptionStartDate)} />
          )}
          {lead.subscriptionStartDate && (
            <InfoRow label="Active Since" value={format(new Date(lead.subscriptionStartDate), 'MMM d, yyyy')} />
          )}
        {(lead.pilotStartDate || lead.trialStartDate) && <InfoRow label="Pilot Start" value={format(new Date(lead.pilotStartDate || lead.trialStartDate!), 'MMM d, yyyy')} />}
        {(lead.pilotEndDate || lead.trialEndDate) && <InfoRow label="Pilot End" value={format(new Date(lead.pilotEndDate || lead.trialEndDate!), 'MMM d, yyyy')} />}
          {lead.paymentReceivedAt && <InfoRow label="Conversion Date" value={format(new Date(lead.paymentReceivedAt), 'MMM d, yyyy')} />}
          <InfoRow label="Created" value={format(new Date(lead.createdAt), 'MMM d, yyyy')} />
          {lead.lastContactedAt && <InfoRow label="Last Interaction" value={format(new Date(lead.lastContactedAt), 'MMM d, h:mm a')} />}
        </Section>
      )}

      {isClient && (
        <Section title="Relationship">
          <InfoRow label="SDR Owner" value={TEAM_MEMBERS.find(m => m.id === lead.assignedTo)?.name || '—'} />
          <InfoRow label="Onboarding" value="Muneeb" />
          <InfoRow label="Entry Flow" value={
            lead.entry_flow ? (ENTRY_FLOW_LABELS[lead.entry_flow] || lead.entry_flow) :
            lead.entrySource ? (ENTRY_FLOW_LABELS[lead.entrySource] || lead.entrySource) : '—'
          } />
          {lead.extraTryOns && <InfoRow label="Extra Try-Ons" value={`${lead.extraTryOns}`} />}
        </Section>
      )}

      {!isClient && lead.subscriptionStartDate && (
        <Section title="Client Info">
          <InfoRow label="Duration" value={formatClientDuration(lead.subscriptionStartDate)} />
        </Section>
      )}

      {/* Payment actions — gated by role */}
      {showPaymentDecision ? (
        canConfirm ? (
          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-xs flex-1" onClick={() => onAction?.('payment')}>
              <CreditCard className="h-3 w-3 mr-1.5" /> Confirm Payment
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/50 border border-muted">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Leadership handling payment decision</p>
          </div>
        )
      ) : null}
    </>
  );
}

type TimelineItem = {
  id: string;
  at: string;
  kind: 'stage' | 'meeting' | 'payment' | 'credentials' | 'note' | 'activity';
  label: string;
  title: string;
  detail?: string;
};

function buildUnifiedTimeline(lead: Lead, activities: Activity[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const state = getCommercialState(lead);
  items.push({
    id: `${lead.id}:current-state`,
    at: lead.updatedAt || lead.createdAt,
    kind: 'stage',
    label: 'Current',
    title: COMMERCIAL_LABEL[state],
    detail: `Pipeline stage: ${String(lead.stage).replace(/-/g, ' ')}`,
  });

  for (const activity of activities) {
    items.push({
      id: `activity:${activity.id}`,
      at: activity.createdAt,
      kind: activity.type === 'payment' || activity.type === 'payment_confirmed' ? 'payment'
        : activity.type === 'meeting' ? 'meeting'
        : activity.type === 'stage-change' ? 'stage'
        : 'activity',
      label: activity.type.replace(/-/g, ' '),
      title: activity.description,
      detail: activity.createdBy ? `By ${TEAM_MEMBERS.find(m => m.id === activity.createdBy)?.name || activity.createdBy}` : undefined,
    });
  }

  for (const meeting of lead.meetings || []) {
    items.push({
      id: `meeting:${meeting.meeting_id}`,
      at: meeting.updated_at || meeting.created_at,
      kind: 'meeting',
      label: meeting.status.replace(/_/g, ' '),
      title: `Meeting ${meeting.status.replace(/_/g, ' ')}`,
      detail: [
        `Scheduled: ${format(new Date(meeting.scheduled_at), 'MMM d, yyyy · h:mm a')}`,
        meeting.notes || meeting.summary,
        meeting.outcome ? `Outcome: ${meeting.outcome.replace(/_/g, ' ')}` : '',
        meeting.next_step ? `Next: ${meeting.next_step}` : '',
        meeting.meeting_link ? `Link: ${meeting.meeting_link}` : '',
      ].filter(Boolean).join('\n'),
    });
  }

  for (const entry of getLedger(lead)) {
    items.push({
      id: `payment:${entry.id}`,
      at: entry.paidAt || entry.dueDate,
      kind: 'payment',
      label: entry.status,
      title: `${entry.status === 'paid' ? 'Payment received' : 'Payment due'} · ${formatMoney(entry.amount, entry.currency)}`,
      detail: [
        `Billing month: ${entry.billingMonth}`,
        `Due: ${format(new Date(entry.dueDate), 'MMM d, yyyy')}`,
        entry.paidAt ? `Paid: ${format(new Date(entry.paidAt), 'MMM d, yyyy')}` : '',
        entry.notes,
      ].filter(Boolean).join('\n'),
    });
  }

  if (lead.credentials?.addedAt) {
    items.push({
      id: `${lead.id}:credentials`,
      at: lead.credentials.addedAt,
      kind: 'credentials',
      label: 'Credentials',
      title: 'Credentials added',
      detail: `By ${TEAM_MEMBERS.find(m => m.id === lead.credentials?.addedBy)?.name || lead.credentials.addedBy || '—'}`,
    });
  }

  if (lead.onboardingDoneAt) {
    items.push({
      id: `${lead.id}:onboarding`,
      at: lead.onboardingDoneAt,
      kind: 'stage',
      label: 'Onboarding',
      title: 'Onboarding done and verified',
      detail: `By ${TEAM_MEMBERS.find(m => m.id === lead.onboardingDoneBy)?.name || lead.onboardingDoneBy || '—'}`,
    });
  }

  if (lead.pilotStartDate) {
    items.push({
      id: `${lead.id}:pilot-start`,
      at: lead.pilotStartDate,
      kind: 'stage',
      label: 'Pilot',
      title: 'Pilot started',
      detail: lead.pilotEndDate ? `Ends ${format(new Date(lead.pilotEndDate), 'MMM d, yyyy')}` : undefined,
    });
  }

  if (lead.contractSignedAt) {
    items.push({
      id: `${lead.id}:contract`,
      at: lead.contractSignedAt,
      kind: 'stage',
      label: 'Contract',
      title: 'Contract signed',
      detail: lead.contractEndDate ? `Contract until ${format(new Date(lead.contractEndDate), 'MMM d, yyyy')}` : undefined,
    });
  }

  if (lead.notes) {
    items.push({
      id: `${lead.id}:notes`,
      at: lead.updatedAt || lead.createdAt,
      kind: 'note',
      label: 'Notes',
      title: 'Latest notes',
      detail: lead.notes,
    });
  }

  return items
    .filter(item => item.at && Number.isFinite(new Date(item.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 80);
}

// ─── Lifecycle Stages ────────────────────────────────────

interface LifecycleStage {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date?: string;
  duration?: string;
}

/**
 * Lifecycle steps derived from the canonical view (NOT from raw lead.stage).
 * Bucket → which step is current; billing/conversion → which step is completed.
 */
function getLifecycleStagesFromView(view: CanonicalLeadView): LifecycleStage[] {
  const lead = view.lead;
  const bucket = view.bucket;
  const stages: LifecycleStage[] = [];

  // 1. Lead Created — always completed
  stages.push({ label: 'Lead Created', status: 'completed', date: lead.createdAt });

  // 2. Contacted
  const everContacted = !!lead.lastContactedAt;
  stages.push({
    label: 'Contacted',
    status: everContacted ? 'completed' : (bucket === 'not_in_lifecycle' ? 'current' : 'completed'),
    date: lead.lastContactedAt,
  });

  // 3. Replied
  const everReplied = !!lead.lastReplyAt;
  stages.push({
    label: 'Replied',
    status: everReplied ? 'completed' : 'upcoming',
    date: lead.lastReplyAt,
  });

  // 4. Meeting
  const hasMeeting = !!(lead.meetingNotes && lead.meetingNotes.length > 0);
  const trialOrLater =
    bucket === 'trial_pending_approval' || bucket === 'trial_ready_to_start' ||
    bucket === 'trial_ready_to_start_blocked' || bucket === 'trial_active' ||
    bucket === 'trial_ending_soon' || bucket === 'trial_ended_awaiting' ||
    bucket === 'payment_window_open' || bucket === 'converted';
  stages.push({
    label: 'Meeting',
    status: hasMeeting || trialOrLater ? 'completed' : 'upcoming',
    date: lead.meetingNotes?.[0]?.date,
  });

  // 5. Client review / onboarding
  let trialStatus: LifecycleStage['status'] = 'upcoming';
  if (bucket === 'trial_active' || bucket === 'trial_ending_soon' ||
      bucket === 'trial_pending_approval' || bucket === 'trial_ready_to_start' ||
      bucket === 'trial_ready_to_start_blocked' || bucket === 'trial_ended_awaiting') {
    trialStatus = 'current';
  } else if (bucket === 'payment_window_open' || bucket === 'converted' ||
             bucket === 'ended_no_response' || bucket === 'ended_declined') {
    trialStatus = 'completed';
  }
  stages.push({
    label: 'Client Review',
    status: trialStatus,
    date: lead.trialStartDate,
    duration: lead.trialStartDate && lead.trialEndDate
      ? `${Math.ceil((new Date(lead.trialEndDate).getTime() - new Date(lead.trialStartDate).getTime()) / 86400000)} days`
      : undefined,
  });

  // 6. Paid
  let paidStatus: LifecycleStage['status'] = 'upcoming';
  if (view.isConverted) paidStatus = 'completed';
  else if (bucket === 'payment_window_open' || view.isPaymentDecision) paidStatus = 'current';
  stages.push({
    label: 'Paid',
    status: paidStatus,
    date: lead.paymentReceivedAt,
  });

  // 7. Retained / Ended
  if (view.isConverted) {
    stages.push({ label: 'Retained', status: 'current', date: lead.subscriptionStartDate });
  } else if (bucket === 'ended_declined' || bucket === 'ended_no_response' || bucket === 'closed') {
    stages.push({ label: 'Ended', status: 'current' });
  } else {
    stages.push({ label: 'Retained', status: 'upcoming' });
  }

  return stages;
}

function getTrialDayInfo(lead: Lead): { day: number; total: number; left: number; pct: number } | null {
  const startAt = lead.pilotStartDate || lead.trialStartDate;
  const endAt = lead.pilotEndDate || lead.trialEndDate;
  if (!startAt || !endAt) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const elapsed = Math.ceil((Date.now() - start) / (1000 * 60 * 60 * 24));
  const left = getTrialDaysLeft(lead) ?? 0;
  const day = Math.max(1, Math.min(elapsed, total));
  const pct = Math.max(0, Math.min(100, (day / total) * 100));
  return { day, total, left, pct };
}

// ─── Trial Tab (Role-Aware) ──────────────────────────────

function TrialTabContent({ lead, hasCreds, trialDays, trialInfo, onAction, onActivate }: {
  lead: Lead;
  hasCreds: boolean;
  trialDays: number | null;
  trialInfo: ReturnType<typeof getTrialDayInfo>;
  onAction?: CompanyDetailSheetProps['onAction'];
  onActivate?: () => void;
}) {
  const { currentUser, role: viewerRole } = useUser();
  const role = getTrialRole(currentUser);
  const view = getCanonicalLeadView(lead, viewerRole, currentUser);
  const trialState = getCanonicalTrialState(lead);
  const visibleTasks = getVisibleTrialTasks(lead, role, currentUser);
  const action = getRoleTrialAction(lead, role);

  return (
    <>
      <Section title="Pilot Status">
        <InfoRow label="State" value={trialState.label} />
        <InfoRow label="Approved" value={lead.approvedBy ? `Yes (${TEAM_MEMBERS.find(m => m.id === lead.approvedBy)?.name || lead.approvedBy})` : 'Not yet'} />
        <InfoRow label="Credentials" value={hasCreds ? 'Added' : 'Missing'} />
        {(lead.pilotStartDate || lead.trialStartDate) && <InfoRow label="Start" value={format(new Date(lead.pilotStartDate || lead.trialStartDate!), 'MMM d, yyyy')} />}
        {(lead.pilotEndDate || lead.trialEndDate) && <InfoRow label="End" value={format(new Date(lead.pilotEndDate || lead.trialEndDate!), 'MMM d, yyyy')} />}
        {trialDays !== null && <InfoRow label="Days Left" value={`${trialDays}`} />}
        <InfoRow label="Onboarding Owner" value="Muneeb" />
        <InfoRow label="Sales Owner" value={TEAM_MEMBERS.find(m => m.id === lead.assignedTo)?.name || '—'} />
      </Section>

      {trialInfo && (view.bucket === 'trial_active' || view.bucket === 'trial_ending_soon') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Day {trialInfo.day} of {trialInfo.total}</span>
            <span className={cn("font-semibold tabular-nums",
              trialInfo.left <= 3 ? 'text-destructive' : 'text-foreground'
            )}>
              {trialInfo.left > 0 ? `${trialInfo.left}d left` : 'Expired'}
            </span>
          </div>
          <Progress value={trialInfo.pct} className="h-1.5" />
        </div>
      )}

      <div className="rounded-md border p-2.5 bg-secondary/30">
        <p className="text-[10px] text-muted-foreground mb-0.5">Your next action</p>
        <p className={cn("text-xs font-medium", trialState.color)}>→ {action}</p>
      </div>

      {visibleTasks.length > 0 && (
        <Section title={role === 'onboarding' ? 'Your Onboarding Tasks' : 'Pilot Tasks'}>
          {visibleTasks.map(task => (
            <div key={task.id} className={cn("flex items-center gap-2 text-xs py-1.5", task.completed && 'opacity-50')}>
              <CheckCircle className={cn("h-3 w-3 shrink-0", task.completed ? 'text-success' : 'text-muted-foreground')} />
              <span className={cn("flex-1", task.completed && 'line-through')}>{task.title}</span>
              <span className="text-muted-foreground">{format(new Date(task.dueDate), 'MMM d')}</span>
            </div>
          ))}
        </Section>
      )}

      {view.permissions.canActivateTrial && (
        <Button size="sm" className="h-8 text-xs w-full" onClick={onActivate}>
          <Rocket className="h-3 w-3 mr-1.5" /> Start Pilot
        </Button>
      )}

      {viewerRole === 'onboarding' && view.onboardingBlocker && (
        <div className="rounded-md border border-muted/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
          <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">
              {view.onboardingBlocker.kind === 'awaiting_approval' ? 'Waiting for leadership approval' :
               view.onboardingBlocker.kind === 'awaiting_credentials' ? 'Waiting for credentials' :
               'Waiting for SDR follow-up'}
            </p>
            <p className="text-[10px] mt-0.5">
              {view.onboardingBlocker.resolvedBy === 'leadership'
                ? 'Leadership must complete approval and credential setup before onboarding can continue.'
                : 'SDR is handling next step.'}
            </p>
          </div>
        </div>
      )}

      {view.permissions.canApproveTrial && (
        <Button size="sm" className="h-8 text-xs w-full" onClick={() => onAction?.('approve')}>
          <Shield className="h-3 w-3 mr-1.5" /> Review Client
        </Button>
      )}
    </>
  );
}

// ─── Credentials Tab (Role-Masked with Reveal/Copy) ─────

function CredentialsTabContent({ lead, hasCreds, onAction }: {
  lead: Lead;
  hasCreds: boolean;
  onAction?: CompanyDetailSheetProps['onAction'];
}) {
  const { currentUser, role: viewerRole } = useUser();
  const { addActivity } = useCompanyStore();
  const role = getTrialRole(currentUser);
  const view = getCanonicalLeadView(lead, viewerRole, currentUser);
  // Permissions come from the canonical view — never re-derive locally.
  const canView = view.permissions.canViewCredentials;
  const canEdit = view.permissions.canEditCredentials;
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [revealAudited, setRevealAudited] = useState(false);

  const handleReveal = () => {
    const next = !passwordRevealed;
    setPasswordRevealed(next);
    // Audit only on first reveal per session — onboarding views are tracked.
    if (next && !revealAudited && role === 'onboarding') {
      addActivity({
        id: `act-${Date.now()}-cred-reveal`,
        leadId: lead.id,
        type: 'note',
        description: 'Credentials revealed (read-only)',
        createdAt: new Date().toISOString(),
        createdBy: currentUser,
      });
      setRevealAudited(true);
    }
  };

  const handleCopy = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(() => {
      showActionToast(lead.id, `copy-${label}`, `${label} copied`);
      if (role === 'onboarding') {
        addActivity({
          id: `act-${Date.now()}-cred-copy`,
          leadId: lead.id,
          type: 'note',
          description: `Credential field copied: ${label.toLowerCase()}`,
          createdAt: new Date().toISOString(),
          createdBy: currentUser,
        });
      }
    }).catch(() => {
      showErrorToast(`${lead.id}:copy`, 'Copy failed');
    });
  };

  return (
    <>
      {hasCreds ? (
        <Section title="Store Credentials">
          {/* Username */}
          <div className="flex items-center justify-between text-xs py-1">
            <span className="text-muted-foreground">Username</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{canView ? (lead.credentials?.username || '—') : maskCredentialValue(lead.credentials?.username || '', role)}</span>
              {canView && lead.credentials?.username && (
                <button onClick={() => handleCopy(lead.credentials!.username, 'Username')} className="p-0.5 hover:bg-secondary rounded" title="Copy username">
                  <Copy className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Password */}
          <div className="flex items-center justify-between text-xs py-1">
            <span className="text-muted-foreground">Password</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium font-mono">
                {canView && passwordRevealed ? (lead.credentials?.password || '—') : '••••••••'}
              </span>
              {canView && (
                <>
                  <button onClick={handleReveal} className="p-0.5 hover:bg-secondary rounded" title={passwordRevealed ? 'Hide' : 'Reveal'}>
                    {passwordRevealed ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <Eye className="h-3 w-3 text-muted-foreground" />}
                  </button>
                  {lead.credentials?.password && (
                    <button onClick={() => handleCopy(lead.credentials!.password, 'Password')} className="p-0.5 hover:bg-secondary rounded" title="Copy password">
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {!canView && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1">
              <EyeOff className="h-3 w-3" />
              Credentials hidden — visible to onboarding & leadership only
            </div>
          )}
          {canView && lead.credentials?.loginUrl && (
            <div className="flex items-center justify-between text-xs py-1">
              <span className="text-muted-foreground">Login URL</span>
              <a href={lead.credentials.loginUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1 truncate max-w-[200px]">
                {lead.credentials.loginUrl.replace(/^https?:\/\//, '').slice(0, 30)} <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            </div>
          )}
          {canView && lead.credentials?.installationNotes && (
            <div className="mt-2">
              <p className="text-[10px] text-muted-foreground mb-1">Setup Notes</p>
              <p className="text-xs whitespace-pre-wrap bg-secondary/30 rounded p-2">{lead.credentials.installationNotes}</p>
            </div>
          )}
          {lead.credentials?.addedBy && (
            <InfoRow label="Added by" value={TEAM_MEMBERS.find(m => m.id === lead.credentials!.addedBy)?.name || lead.credentials.addedBy} />
          )}
          {lead.credentials?.addedAt && (
            <InfoRow label="Added on" value={format(new Date(lead.credentials.addedAt), 'MMM d, yyyy')} />
          )}
        </Section>
      ) : (
        <EmptyState icon={Key} message="No credentials added yet" />
      )}

      {/* Action buttons by role */}
      {/* Edit gated to leadership only. Onboarding can view/reveal but cannot add or change. */}
      {canEdit && (
        <Button size="sm" variant="outline" className="h-8 text-xs w-full" onClick={() => onAction?.('credentials')}>
          <Key className="h-3 w-3 mr-1.5" /> {hasCreds ? 'Update Credentials' : 'Add Credentials'}
        </Button>
      )}
      {role === 'onboarding' && (
        <div className="rounded-md border border-muted/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground flex items-start gap-1.5">
          <Shield className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            {hasCreds
              ? 'View and copy access only. Credentials are managed by leadership.'
              : 'Credentials not yet received. Activation is blocked until leadership adds them.'}
          </span>
        </div>
      )}
      {role === 'sdr' && hasCreds && (
        <div className="text-center">
          <Badge variant="secondary" className="text-[10px]">
            <CheckCircle className="h-2.5 w-2.5 mr-1" /> Credentials Added
          </Badge>
          <p className="text-[10px] text-muted-foreground mt-1">Managed by onboarding team</p>
        </div>
      )}
      {role === 'sdr' && !hasCreds && (
        <div className="text-center">
          <Badge variant="outline" className="text-[10px] text-warning">
            <AlertCircle className="h-2.5 w-2.5 mr-1" /> Credentials Missing
          </Badge>
          <p className="text-[10px] text-muted-foreground mt-1">Onboarding will handle credentials</p>
        </div>
      )}
    </>
  );
}

// ─── Commercial Terms Editor (CEO/COO only) ──────────────

function CommercialTermsEditor({ lead, isClient }: { lead: Lead; isClient: boolean }) {
  const { saveCompany } = useCompanyStore();
  const [open, setOpen] = useState(false);
  const initial = isClient ? getActiveDeal(lead) : getProposedDeal(lead);
  const [pkg, setPkg] = useState<SubscriptionPlan>(initial.package);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [value, setValue] = useState<string>(String(initial.value));
  const [region, setRegion] = useState<Region>(lead.region || 'PK');

  if (!open) {
    return (
      <div className="pt-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>
          <DollarSign className="h-3 w-3 mr-1" /> Edit commercial terms
        </Button>
      </div>
    );
  }

  const numericValue = Number(value);
  const valid = pkg && currency && Number.isFinite(numericValue) && numericValue >= 0;

  const save = () => {
    if (!valid) return;
    const patch: Partial<Lead> = isClient
      ? { active_package: pkg, active_currency: currency, active_value: numericValue, region }
      : { proposed_package: pkg, proposed_currency: currency, proposed_value: numericValue, region };
    const updated: Lead = { ...lead, ...patch, updatedAt: new Date().toISOString() };
    saveCompany(updated);
    showActionToast(lead.id, 'commercial-terms', `${isClient ? 'Active' : 'Proposed'} terms updated`);
    setOpen(false);
  };

  return (
    <div className="pt-2 space-y-2 p-2.5 rounded-lg border border-border/40 bg-secondary/20">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {isClient ? 'Active client terms' : 'Proposed terms'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-muted-foreground space-y-1">
          <span className="block">Package</span>
          <select
            className="w-full h-7 text-xs rounded bg-background border border-border px-1"
            value={pkg}
            onChange={e => setPkg(e.target.value as SubscriptionPlan)}
          >
            {(['lite', 'starter', 'growth', 'enterprise', 'custom'] as SubscriptionPlan[]).map(p => (
              <option key={p} value={p}>{PLAN_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-muted-foreground space-y-1">
          <span className="block">Currency</span>
          <select
            className="w-full h-7 text-xs rounded bg-background border border-border px-1"
            value={currency}
            onChange={e => setCurrency(e.target.value as Currency)}
          >
            {(['PKR', 'USD', 'GBP', 'AED'] as Currency[]).map(c => (
              <option key={c} value={c}>{CURRENCY_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-muted-foreground space-y-1 col-span-1">
          <span className="block">Value (per month)</span>
          <input
            type="number"
            min={0}
            className="w-full h-7 text-xs rounded bg-background border border-border px-1.5"
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        </label>
        <label className="text-[10px] text-muted-foreground space-y-1 col-span-1">
          <span className="block">Region</span>
          <select
            className="w-full h-7 text-xs rounded bg-background border border-border px-1"
            value={region}
            onChange={e => setRegion(e.target.value as Region)}
          >
            {(['PK', 'US', 'UK', 'UAE', 'OTHER'] as Region[]).map(r => (
              <option key={r} value={r}>{REGION_LABELS[r]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!valid} onClick={save}>Save</Button>
      </div>
    </div>
  );
}
