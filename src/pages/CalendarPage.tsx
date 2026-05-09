/**
 * STYLIQUE CRM — Calendar Page
 * Uses canonical meeting engine as source of truth.
 * Role-filtered. Unified outcome modal on meeting completion.
 */
import { useState, useMemo } from 'react';
import { useCompanyStore } from '@/lib/company-store';
import { Lead, TEAM_MEMBERS, CanonicalMeeting, MEETING_OUTCOME_LABELS, MeetingOutcomeType } from '@/types/crm';
import { useUser } from '@/lib/user-context';
import { getCanonicalMeetings, completeMeeting, rescheduleMeeting, getMeetingNeedingOutcome } from '@/engine/meeting-engine';
import type { ViewerRole } from '@/engine/canonical-state';
import {
  isTrialProposedStage, isTrialActiveStage, isPaymentPendingStage, isConvertedStage,
} from '@/engine/stage-aliases';
import { MeetingOutcomeDialog } from '@/components/MeetingOutcomeDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, ExternalLink, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isSameDay, addDays, startOfWeek, addWeeks, subWeeks, isToday, isBefore, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';
import { toast } from 'sonner';

type ViewMode = 'week' | 'month';

interface FlatMeeting {
  meeting: CanonicalMeeting;
  lead: Lead;
}

export default function CalendarPage() {
  const { companies: leads, saveCompany, addActivity, refresh } = useCompanyStore();
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const { currentUser, role } = useUser();

  // Outcome dialog state
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeTarget, setOutcomeTarget] = useState<FlatMeeting | null>(null);

  const bridge = useMemo(() => ({ saveCompany, addActivity }), [saveCompany, addActivity]);

  const viewerRole: ViewerRole = role === 'ceo' || role === 'coo' ? role : role === 'onboarding' ? 'onboarding' : 'sdr';

  // Canonical meetings — source of truth
  const allMeetings: FlatMeeting[] = useMemo(
    () => getCanonicalMeetings(leads, viewerRole, currentUser),
    [leads, viewerRole, currentUser]
  );

  const today = new Date();
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const monthStartDay = getDay(monthStart);
  const monthPadding = monthStartDay === 0 ? 6 : monthStartDay - 1;

  const navigateWeek = (dir: number) => setCurrentDate(dir > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
  const navigateMonth = (dir: number) => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  };
  const goToToday = () => setCurrentDate(new Date());
  const getMeetingsForDay = (day: Date) => allMeetings.filter(m => isSameDay(new Date(m.meeting.scheduled_at), day));

  const dayMeetings = selectedDay ? getMeetingsForDay(selectedDay) : null;
  const upcoming = allMeetings.filter(m => m.meeting.status === 'scheduled' && new Date(m.meeting.scheduled_at) >= today);
  const past = allMeetings.filter(m => new Date(m.meeting.scheduled_at) < today).reverse();
  const allNeedsOutcome = past.filter(m => m.meeting.status === 'scheduled');

  // Leadership gating: only flag outcomes that are blocking (>48h overdue OR high-value lifecycle)
  const isHighValueLifecycle = (lead: Lead) =>
    isTrialProposedStage(lead.stage) || isTrialActiveStage(lead.stage)
    || isPaymentPendingStage(lead.stage) || isConvertedStage(lead.stage);
  const needsOutcome = (viewerRole === 'ceo' || viewerRole === 'coo')
    ? allNeedsOutcome.filter(m => {
        const hoursOverdue = (today.getTime() - new Date(m.meeting.scheduled_at).getTime()) / 3600000;
        return hoursOverdue >= 48 || isHighValueLifecycle(m.lead);
      })
    : allNeedsOutcome;

  const openOutcomeModal = (fm: FlatMeeting) => {
    setOutcomeTarget(fm);
    setOutcomeOpen(true);
  };

  const handleOutcomeSubmit = (data: { outcome: MeetingOutcomeType; summary: string; nextStep: string; nextStepDate?: string }) => {
    if (!outcomeTarget) return;
    const freshLead = leads.find(l => l.id === outcomeTarget.lead.id);
    if (!freshLead) return;

    completeMeeting({
      lead: freshLead,
      meetingId: outcomeTarget.meeting.meeting_id,
      outcome: data.outcome,
      summary: data.summary,
      nextStep: data.nextStep,
      nextStepDate: data.nextStepDate,
      performedBy: currentUser,
    }, bridge);

    refresh();
    setOutcomeOpen(false);
    // Defer clearing target so dialog unmounts cleanly; ensures next open uses fresh state.
    // Outcome banner & "Outcome Required" badges recompute from `leads` after refresh().
    setTimeout(() => setOutcomeTarget(null), 150);
    toast.success(`Outcome added — ${freshLead.companyName}`, { duration: 2200 });
  };

  const getStatusBadge = (meeting: CanonicalMeeting, isPastMeeting?: boolean) => {
    switch (meeting.status) {
      case 'scheduled':
        // Past meetings that are still "scheduled" = outcome required
        if (isPastMeeting || isBefore(new Date(meeting.scheduled_at), today)) {
          return <Badge variant="outline" className="text-[10px] text-warning border-warning/30">Outcome Required</Badge>;
        }
        return <Badge variant="outline" className="text-[10px]">Scheduled</Badge>;
      case 'completed': return <Badge variant="secondary" className="text-[10px] text-success border-success/30">{meeting.outcome ? MEETING_OUTCOME_LABELS[meeting.outcome] : 'Completed'}</Badge>;
      case 'no_show': return <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">No Show</Badge>;
      case 'rescheduled': return <Badge variant="outline" className="text-[10px] text-warning border-warning/30">Rescheduled</Badge>;
      case 'cancelled': return <Badge variant="secondary" className="text-[10px] text-muted-foreground">Cancelled</Badge>;
    }
  };

  const MeetingCard = ({ fm, isPast }: { fm: FlatMeeting; isPast?: boolean }) => {
    const { meeting, lead } = fm;
    const owner = TEAM_MEMBERS.find(m => m.id === meeting.owner || m.id === lead.assignedTo);
    const needsAction = isPast && meeting.status === 'scheduled';
    return (
      <Card className={cn(
        "hover:border-primary/30 transition-colors",
        needsAction && 'border-warning/30 bg-warning/5',
      )}>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <div className={cn("text-center shrink-0 w-12", isPast && !needsAction && 'opacity-60')}>
              <div className="text-lg font-semibold tabular-nums">{format(new Date(meeting.scheduled_at), 'd')}</div>
              <div className="text-[10px] text-muted-foreground uppercase">{format(new Date(meeting.scheduled_at), 'MMM')}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{lead.companyName}</span>
                <Badge variant="secondary" className="text-[10px]">{meeting.meeting_type}</Badge>
                {getStatusBadge(meeting, isPast)}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{format(new Date(meeting.scheduled_at), 'h:mm a')}</span>
                <span>{lead.contactName}</span>
                {owner && <span>· {owner.name.split(' ')[0]}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {needsAction && (
                <Button size="sm" variant="outline" className="text-xs h-7 border-warning text-warning hover:bg-warning/10" onClick={() => openOutcomeModal(fm)}>
                  Log result
                </Button>
              )}
              {meeting.meeting_link && (
                <a href={meeting.meeting_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-primary hover:text-primary/80">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
          {meeting.summary && (
            <div className="mt-2 text-xs text-muted-foreground bg-secondary/50 rounded p-2">
              {meeting.summary}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
            <button onClick={() => setViewMode('week')} className={cn("px-3 py-1 text-xs rounded-md", viewMode === 'week' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground')}>Week</button>
            <button onClick={() => setViewMode('month')} className={cn("px-3 py-1 text-xs rounded-md", viewMode === 'month' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground')}>Month</button>
          </div>
        </div>
      </div>

      {/* Needs outcome banner */}
      {needsOutcome.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <FileText className="h-4 w-4 text-warning shrink-0" />
            <span className="text-sm"><strong>{needsOutcome.length}</strong> meeting{needsOutcome.length > 1 ? 's' : ''} need an outcome</span>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => viewMode === 'week' ? navigateWeek(-1) : navigateMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={goToToday}>Today</Button>
          <Button size="sm" variant="outline" onClick={() => viewMode === 'week' ? navigateWeek(1) : navigateMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {viewMode === 'week'
            ? `${format(weekDays[0], 'MMM d')} — ${format(weekDays[6], 'MMM d, yyyy')}`
            : format(currentDate, 'MMMM yyyy')
          }
        </span>
      </div>

      {/* Week view */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => {
            const dayMtgs = getMeetingsForDay(day);
            const isTodayDay = isToday(day);
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            return (
              <button key={day.toISOString()} onClick={() => setSelectedDay(isSelected ? null : day)} className={cn(
                "text-center py-2 rounded-lg text-xs transition-colors",
                isTodayDay ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary/50',
                isSelected && 'ring-2 ring-primary/40',
                isBefore(day, today) && !isTodayDay && 'opacity-60'
              )}>
                <div>{format(day, 'EEE')}</div>
                <div className="text-lg font-semibold tabular-nums">{format(day, 'd')}</div>
                {dayMtgs.length > 0 && (
                  <div className="mt-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="ml-1 text-[10px]">{dayMtgs.length}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Month view */}
      {viewMode === 'month' && (
        <div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-center text-[10px] text-muted-foreground py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: monthPadding }).map((_, i) => <div key={`pad-${i}`} />)}
            {monthDays.map(day => {
              const dayMtgs = getMeetingsForDay(day);
              const isTodayDay = isToday(day);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              return (
                <button key={day.toISOString()} onClick={() => setSelectedDay(isSelected ? null : day)} className={cn(
                  "text-center py-1.5 rounded-md text-xs transition-colors min-h-[40px]",
                  isTodayDay ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary/50',
                  isSelected && 'ring-2 ring-primary/40',
                )}>
                  <div className="text-sm tabular-nums">{format(day, 'd')}</div>
                  {dayMtgs.length > 0 && (
                    <div className="flex justify-center gap-0.5 mt-0.5">
                      {dayMtgs.slice(0, 3).map((_, i) => (
                        <span key={i} className="w-1 h-1 rounded-full bg-primary" />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected day */}
      {selectedDay && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            {format(selectedDay, 'EEEE, MMMM d')} ({dayMeetings?.length || 0} meetings)
          </h3>
          {dayMeetings && dayMeetings.length > 0 ? (
            <div className="space-y-2">{dayMeetings.map(fm => <MeetingCard key={fm.meeting.meeting_id} fm={fm} isPast={isBefore(new Date(fm.meeting.scheduled_at), today)} />)}</div>
          ) : (
              <Card className="py-6 text-center">
              <p className="text-sm text-muted-foreground">No meetings on this day</p>
            </Card>
          )}
        </div>
      )}

      {/* Default: upcoming & past */}
      {!selectedDay && (
        <>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Upcoming ({upcoming.length})</h3>
            {upcoming.length === 0 ? (
              <Card className="py-8 text-center">
                <CalendarIcon className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No meetings scheduled</p>
              </Card>
            ) : (
              <div className="space-y-2">{upcoming.map(fm => <MeetingCard key={fm.meeting.meeting_id} fm={fm} />)}</div>
            )}
          </div>
          {past.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Past ({past.length})</h3>
              <div className="space-y-2">{past.slice(0, 10).map(fm => <MeetingCard key={fm.meeting.meeting_id} fm={fm} isPast />)}</div>
            </div>
          )}
        </>
      )}

      {/* Unified outcome modal — keyed so it resets between targets */}
      {outcomeTarget && (
        <MeetingOutcomeDialog
          key={outcomeTarget.meeting.meeting_id}
          open={outcomeOpen}
          onOpenChange={setOutcomeOpen}
          companyName={outcomeTarget.lead.companyName}
          meetingId={outcomeTarget.meeting.meeting_id}
          lead={outcomeTarget.lead}
          onSubmit={handleOutcomeSubmit}
        />
      )}
    </div>
  );
}
