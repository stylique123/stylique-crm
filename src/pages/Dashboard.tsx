import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompanyStore } from '@/lib/company-store';
import { useAttendance } from '@/lib/attendance-store';
import { useEmployees } from '@/lib/employee-store';
import { useUser } from '@/lib/user-context';
import { isLeadershipRole } from '@/lib/role';
import { Lead, getActiveDeal, formatMoney, hasValidCredentials } from '@/types/crm';
import { getCommercialState } from '@/engine/commercial-state';
import { paidThisMonth } from '@/engine/payment-ledger';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CheckCircle2, Clock,
  CreditCard, MessageSquareReply, Target, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function isThisMonth(date?: string) {
  if (!date) return false;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function isThisWeek(date?: string) {
  if (!date) return false;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  return d >= start && d <= now;
}

function dealTotal(leads: Lead[]) {
  const byCurrency = new Map<string, number>();
  for (const lead of leads) {
    const deal = getActiveDeal(lead);
    byCurrency.set(deal.currency, (byCurrency.get(deal.currency) || 0) + deal.value);
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => formatMoney(amount, currency as Parameters<typeof formatMoney>[1]))
    .join(' · ') || '0';
}

function contactCount(lead: Lead) {
  if (lead.contacts?.length) return lead.contacts.length;
  return 1 + (lead.secondaryContact?.name ? 1 : 0);
}

export default function Dashboard() {
  const { companies } = useCompanyStore();
  const attendance = useAttendance();
  const employees = useEmployees();
  const { role, currentUser, userName } = useUser();
  const navigate = useNavigate();
  const isSdr = role === 'sdr';
  const isLeadership = isLeadershipRole(role);
  const employee = employees.employees.find(e => e.id === currentUser);
  const todayAttendance = attendance.getToday(currentUser, employee?.timezone);

  const visibleCompanies = useMemo(() => {
    if (!isSdr) return companies;
    return companies.filter(c => c.assignedTo === currentUser || c.assigned_sdr === currentUser || c.record_owner === currentUser);
  }, [companies, currentUser, isSdr]);

  const state = useMemo(() => {
    const awaitingReview: Lead[] = [];
    const onboardingQueue: Lead[] = [];
    const pilot: Lead[] = [];
    const activeClients: Lead[] = [];
    const dueSoon: Lead[] = [];
    const overdue: Lead[] = [];
    let repliesThisMonth = 0;
    let meetingsThisMonth = 0;

    let secondaryContactsMissing = 0;
    let contactedThisMonth = 0;
    let contactedThisWeek = 0;
    let meetingResultsNeeded = 0;
    let decisionPending = 0;
    let newLeads = 0;

    for (const lead of visibleCompanies) {
      const cs = getCommercialState(lead);
      if (cs === 'conversion_pending' || cs === 'client_review') awaitingReview.push(lead);
      if (cs === 'onboarding_pending') {
        if (hasValidCredentials(lead)) onboardingQueue.push(lead);
        else awaitingReview.push(lead);
      }
      if (cs === 'pilot') pilot.push(lead);
      if (cs === 'active_client' || cs === 'payment_due_soon' || cs === 'overdue') activeClients.push(lead);
      if (cs === 'payment_due_soon') dueSoon.push(lead);
      if (cs === 'overdue') overdue.push(lead);
      if (isThisMonth(lead.lastReplyAt) || (lead.stage === 'sdr-replied' && isThisMonth(lead.updatedAt))) repliesThisMonth++;
      const canonicalCompletedMeetings = (lead.meetings || []).filter(m => m.status === 'completed' && isThisMonth(m.scheduled_at)).length;
      meetingsThisMonth += canonicalCompletedMeetings || (lead.meetingNotes || []).filter(m => isThisMonth(m.date)).length;
      if (contactCount(lead) < 2 && !['converted', 'closed-lost', 'unsubscribed'].includes(lead.stage)) secondaryContactsMissing++;
      if (isThisMonth(lead.lastContactedAt) || isThisMonth(lead.lastEmailAt) || isThisMonth(lead.lastLinkedinAt) || isThisMonth(lead.lastCallAt)) contactedThisMonth++;
      if (isThisWeek(lead.lastContactedAt) || isThisWeek(lead.lastEmailAt) || isThisWeek(lead.lastLinkedinAt) || isThisWeek(lead.lastCallAt)) contactedThisWeek++;
      if (lead.stage === 'sdr-new-lead' || lead.stage === 'new-lead' || lead.stage === 'inbound-new') newLeads++;
      if (['internal-decision', 'pricing-discussion'].includes(lead.stage)) decisionPending++;
      if (lead.stage === 'meeting-booked' && (lead.meetings || []).some(m => m.status !== 'completed' && new Date(m.scheduled_at).getTime() < Date.now())) meetingResultsNeeded++;
    }

    return { awaitingReview, onboardingQueue, pilot, activeClients, dueSoon, overdue, repliesThisMonth, meetingsThisMonth, secondaryContactsMissing, contactedThisMonth, contactedThisWeek, meetingResultsNeeded, decisionPending, newLeads };
  }, [visibleCompanies]);

  const team = useMemo(() => {
    const active = employees.employees.filter(e => e.active && !e.attendanceExempt);
    const today = new Date().toISOString().slice(0, 10);
    const todaysEntries = active.map(emp => attendance.getForDate(emp.id, today));
    const presentToday = todaysEntries.filter(e => e && ['present', 'late', 'remote', 'field_work', 'checked_out'].includes(e.status)).length;
    const absentToday = todaysEntries.filter(e => e?.status === 'absent').length;
    const notCheckedInToday = active.length - presentToday - absentToday - todaysEntries.filter(e => e?.status === 'leave_approved').length;
    const inactiveOwners = active.filter(emp => !companies.some(c =>
      (c.assignedTo === emp.id || c.assigned_sdr === emp.id) && isThisMonth(c.updatedAt)
    ));
    return { presentToday, absentToday, notCheckedInToday: Math.max(0, notCheckedInToday), inactiveOwners: inactiveOwners.slice(0, 4) };
  }, [attendance, attendance.entries, companies, employees.employees]);

  const paidMonth = paidThisMonth(companies);
  const urgent = state.awaitingReview.length + state.onboardingQueue.length + state.overdue.length;

  if (isSdr) {
    return (
      <div className="max-w-6xl mx-auto space-y-5 pb-10">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
            <p className="text-sm text-muted-foreground mt-1">{userName}: what needs your attention right now?</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs w-fit" onClick={() => navigate('/pipeline')}>
            Open pipeline <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </header>

        <Card className={cn('border-l-[3px]', todayAttendance?.checkInTime ? 'border-l-success' : 'border-l-warning')}>
          <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Attendance</p>
              <p className="text-[11px] text-muted-foreground">
                {todayAttendance?.checkInTime
                  ? `Checked in ${todayAttendance.checkInTime}${todayAttendance.checkOutTime ? ` · out ${todayAttendance.checkOutTime}` : ''}`
                  : 'Check in before working pipeline'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!todayAttendance?.checkInTime ? (
                <Button size="sm" className="h-8 text-xs" onClick={() => attendance.checkIn(currentUser, employee?.shiftStart, employee?.graceMinutes, false, employee?.timezone, employee?.shiftEnd)}>
                  Check in
                </Button>
              ) : !todayAttendance.checkOutTime ? (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => attendance.checkOut(currentUser, employee?.timezone, employee?.shiftEnd)}>
                  Check out
                </Button>
              ) : (
                <Badge variant="outline" className="text-[10px]">Done today</Badge>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => navigate('/team')}>
                Monthly list
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PulseTile icon={Target} label="New leads" value={state.newLeads} sub="No outreach yet" tone="neutral" onClick={() => navigate('/pipeline')} />
          <PulseTile icon={Target} label="Contacted this week" value={state.contactedThisWeek} sub="Brands contacted" tone="neutral" onClick={() => navigate('/contacts')} />
          <PulseTile icon={MessageSquareReply} label="Replies this month" value={state.repliesThisMonth} sub="Conversation exists" tone="neutral" onClick={() => navigate('/pipeline')} />
          <PulseTile icon={CalendarCheck2} label="Meetings this month" value={state.meetingsThisMonth} sub="Completed meetings" tone="neutral" onClick={() => navigate('/calendar')} />
          <PulseTile icon={Users} label="Secondary contacts missing" value={state.secondaryContactsMissing} sub="Add second contact" tone={state.secondaryContactsMissing ? 'warning' : 'neutral'} onClick={() => navigate('/pipeline')} />
          <PulseTile icon={Clock} label="Meeting results needed" value={state.meetingResultsNeeded} sub="Past meetings" tone={state.meetingResultsNeeded ? 'warning' : 'neutral'} onClick={() => navigate('/pipeline')} />
          <PulseTile icon={AlertTriangle} label="Decision pending" value={state.decisionPending} sub="Interested, unresolved" tone="neutral" onClick={() => navigate('/pipeline')} />
          <PulseTile icon={Users} label="My active clients" value={state.activeClients.length} sub="Current clients" tone="neutral" onClick={() => navigate('/clients')} />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <CommandSection title="My Pipeline" action="Pipeline" onAction={() => navigate('/pipeline')}>
            <CommandRow title="No outreach yet" detail="New brands waiting" count={visibleCompanies.filter(c => c.stage === 'sdr-new-lead').length} />
            <CommandRow title="Follow-up due" detail="Contacted, no reply yet" count={visibleCompanies.filter(c => c.stage === 'sdr-contacted').length} tone="warning" />
            <CommandRow title="Decision pending" detail="Interested but unresolved" count={visibleCompanies.filter(c => ['meeting-completed', 'internal-decision', 'pricing-discussion'].includes(c.stage)).length} />
          </CommandSection>

          <CommandSection title="My Clients" action="Clients" onAction={() => navigate('/clients')}>
            <CommandRow title="Current clients" detail="Active clients associated with you" count={state.activeClients.length} tone="ok" />
            <CommandRow title="With leadership" detail="Review, payment, credentials" count={state.awaitingReview.length} />
            <CommandRow title="Onboarding queue" detail="Paid with credentials" count={state.onboardingQueue.length} />
          </CommandSection>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground mt-1">What is happening right now?</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs w-fit" onClick={() => navigate('/clients')}>
          Open clients <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <PulseTile icon={CreditCard} label="Client Review" value={state.awaitingReview.length} sub="Review, payment, credentials" tone="warning" onClick={() => navigate('/clients#review')} />
        <PulseTile icon={Clock} label="Onboarding Queue" value={state.onboardingQueue.length} sub="Ready for Muneeb" tone="neutral" onClick={() => navigate('/clients#queue')} />
        <PulseTile icon={Target} label="Pilot" value={state.pilot.length} sub="Paid pilot running" tone="neutral" onClick={() => navigate('/clients#pilot')} />
        <PulseTile icon={Users} label="Active clients" value={state.activeClients.length} sub="Recurring clients" tone="neutral" onClick={() => navigate('/clients#active')} />
        <PulseTile icon={AlertTriangle} label="Overdue" value={state.overdue.length} sub={dealTotal(state.overdue)} tone="danger" onClick={() => navigate('/clients#overdue')} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.85fr]">
        <CommandSection title="Clients" action="Clients" onAction={() => navigate('/clients')}>
          <CommandRow title="Client Review" detail="CEO action: package, payment, credentials" count={state.awaitingReview.length} tone={state.awaitingReview.length ? 'warning' : 'ok'} />
          <CommandRow title="Onboarding Queue" detail="Ready for onboarding completion" count={state.onboardingQueue.length} />
          <CommandRow title="Pilot" detail="Paid pilot running" count={state.pilot.length} tone="ok" />
          <CommandRow title="Active clients" detail="Recurring clients" count={state.activeClients.length} tone="ok" />
          <CommandRow title="Due soon" detail="Renewal within 5 days" count={state.dueSoon.length} tone={state.dueSoon.length ? 'warning' : 'ok'} />
        </CommandSection>

        <CommandSection title="Financial" action="Clients" onAction={() => navigate('/clients')}>
          <CommandRow title="Paid this month" detail="Confirmed payments" value={`$${Math.round(paidMonth).toLocaleString()}`} tone="ok" />
          <CommandRow title="Pending review value" detail="Potential value in Client Review" value={dealTotal(state.awaitingReview)} tone={state.awaitingReview.length ? 'warning' : 'ok'} />
          <CommandRow title="Overdue amount" detail="Past renewal date" value={dealTotal(state.overdue)} tone={state.overdue.length ? 'danger' : 'ok'} />
        </CommandSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CommandSection title="SDR Motion" action="Pipeline" onAction={() => navigate('/pipeline')}>
          <CommandRow title="Replies this month" detail="Conversation exists" count={state.repliesThisMonth} icon={MessageSquareReply} />
          <CommandRow title="Meetings done this month" detail="Completed meeting records" count={state.meetingsThisMonth} icon={CalendarCheck2} />
          <CommandRow title="Pipeline visibility" detail="CEO/COO can inspect overall SDR pipeline" value="Open" />
        </CommandSection>

        <CommandSection title="Team Today" action="Team" onAction={() => navigate('/team')}>
          <CommandRow title="Present today" detail="Checked in, remote, field work, or checked out" count={team.presentToday} tone="ok" icon={Users} />
          <CommandRow title="Absent today" detail="Marked absent" count={team.absentToday} tone={team.absentToday ? 'danger' : 'ok'} />
          <CommandRow title="Not checked in" detail="Shift expected, no attendance record yet" count={team.notCheckedInToday} tone={team.notCheckedInToday ? 'warning' : 'ok'} />
          <CommandRow title="Inactive owners" detail={team.inactiveOwners.map(e => e.fullName.split(' ')[0]).join(', ') || 'None'} count={team.inactiveOwners.length} tone={team.inactiveOwners.length ? 'warning' : 'ok'} />
        </CommandSection>
      </div>

      {urgent === 0 && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Nothing urgent right now.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PulseTile({ icon: Icon, label, value, sub, tone, onClick }: {
  icon: typeof CreditCard;
  label: string;
  value: number;
  sub: string;
  tone: 'warning' | 'danger' | 'neutral';
  onClick: () => void;
}) {
  const toneClass = tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground';
  return (
    <button onClick={onClick} className="rounded-lg border border-border/50 bg-card p-4 text-left hover:border-primary/35 transition-colors">
      <div className="flex items-center justify-between">
        <Icon className={cn('h-4 w-4', toneClass)} />
        {value > 0 && <Badge variant="outline" className={cn('text-[10px]', toneClass)}>{value}</Badge>}
      </div>
      <p className="text-2xl font-semibold tabular-nums mt-3">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      <p className="text-[11px] text-muted-foreground/60 mt-1 truncate">{sub}</p>
    </button>
  );
}

function CommandSection({ title, action, onAction, children }: {
  title: string;
  action: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onAction}>
            {action} <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        <div className="divide-y divide-border/30">{children}</div>
      </CardContent>
    </Card>
  );
}

function CommandRow({ title, detail, count, value, tone = 'neutral', icon: Icon }: {
  title: string;
  detail: string;
  count?: number;
  value?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'ok';
  icon?: typeof Users;
}) {
  const color =
    tone === 'danger' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' :
    tone === 'ok' ? 'text-success' : 'text-foreground';
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex items-center gap-2.5">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-[11px] text-muted-foreground truncate">{detail}</p>
        </div>
      </div>
      <span className={cn('text-sm font-semibold tabular-nums shrink-0', color)}>
        {value ?? count ?? 0}
      </span>
    </div>
  );
}
