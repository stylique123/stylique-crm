/**
 * STYLIQUE CRM — People & Performance (Rebuilt)
 * 
 * Weekly-first KPI. Probation leave enforcement. Salary editing with history.
 * Attendance-to-compensation policy-driven deductions.
 * Tabs: Overview | Attendance | KPI | Leave | Compensation | People
 */
import { useEffect, useState, useMemo } from 'react';
import { useUser } from '@/lib/user-context';
import { useAttendance, ATTENDANCE_LABELS, ATTENDANCE_COLORS, type AttendanceStatus } from '@/lib/attendance-store';
import { useLeave, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, LEAVE_STATUS_COLORS, type LeaveType, checkProbationLeave } from '@/lib/leave-store';
import { useKPIDefinitions, type KPIDefinition, type KPIMeasurePeriod, type KPIUnit, MANDATORY_KPI_CODE, getEffectiveTarget } from '@/lib/kpi-definitions-store';
import {
  useEmployees, calculatePayroll,
  EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_COLORS,
  PROBATION_MODE_LABELS,
  type EmployeeProfile, type EmploymentStatus, type LeavePolicy,
  type CommissionRule, type PayrollEntry,
} from '@/lib/employee-store';
import { TEAM, type TeamMember } from '@/types/roles';
import { getDailySnapshot, getWeeklySnapshot, getBrandCoverage, todayKey, getKPITargets } from '@/engine/kpi-engine';
import {
  computeWeeklyBrandKPI, getPacingColor, getPacingLabel,
  getLeadershipPacingLabel, getLeadershipPacingColor,
  BRAND_STATUS_LABELS, BRAND_STATUS_COLORS,
  getWeeklyKPIConfig, saveWeeklyKPIConfig,
  type WeeklyKPIConfig,
} from '@/engine/weekly-kpi-engine';
import type { KPISnapshot, ActionKPIMetric } from '@/types/kpi';
import { ACTION_KPI_LABELS } from '@/types/kpi';
import { useCompanyStore } from '@/lib/company-store';
import { getCanonicalState } from '@/engine/canonical-state';
import { countMeetingsBookedThisWeek, countConversionsThisWeek, countMeetingsBookedThisMonth, countConversionsThisMonth } from '@/engine/event-kpi';
import {
  computeDayState, getLeaveBalanceLabel, getSalaryDisplay, formatTimestamp,
  DAY_STATE_COLORS, DAY_STATE_LABELS, type DayStateResult, type FinalDayState,
} from '@/engine/day-state-engine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Users, Building2, Phone, Mail, Linkedin, Calendar, Target,
  TrendingUp, AlertTriangle, CheckCircle2, Clock, UserCheck, UserX,
  LogIn, LogOut, Edit3, Filter, Plus, Trash2,
  ToggleLeft, ToggleRight, CalendarOff, MessageCircle, ArrowRight,
  DollarSign, Shield, Lock, History,
  MapPin, UserCog, ArrowDownRight, ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { EmployeeProfileDrawer } from '@/components/EmployeeProfileDrawer';

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function useDayState(userId: string, date: string) {
  const attendance = useAttendance();
  const leave = useLeave();
  const empStore = useEmployees();

  return useMemo(() => {
    const entry = attendance.getForDate(userId, date);
    const emp = empStore.getEmployee(userId);
    const approvedLeave = leave.getForDate(userId, date);
    const isToday = date === todayKey();

    return computeDayState({
      checkInTime: entry?.checkInTime,
      checkOutTime: entry?.checkOutTime,
      hoursLogged: entry?.hoursLogged,
      isLate: entry?.isLate,
      isEarlyLeave: entry?.isEarlyLeave,
      hasApprovedLeave: !!approvedLeave && approvedLeave.status === 'approved',
      leaveType: approvedLeave?.type,
      hasLeaveRequest: !!approvedLeave,
      shiftStart: emp?.shiftStart || '09:00',
      shiftEnd: emp?.shiftEnd || '17:00',
      graceMinutes: emp?.graceMinutes ?? 15,
      timezone: emp?.timezone,
      attendanceExempt: emp?.attendanceExempt,
      isProbationary: emp?.employmentStatus === 'probationary',
      isToday,
    });
  }, [attendance, leave, empStore, userId, date]);
}

const UNIT_LABELS: Record<KPIUnit, string> = { brands: 'Brands', contacts: 'Contacts', calls: 'Calls', emails: 'Emails', linkedin_actions: 'LinkedIn', whatsapp_actions: 'WhatsApp', meetings: 'Meetings', replies: 'Replies', trials: 'Trials', conversions: 'Conversions', payments: 'Payments', percentage: '%', currency: 'Currency', count: 'Count' };
const PERIOD_LABELS: Record<KPIMeasurePeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
const ROLES = [{ id: 'sdr', label: 'SDR' }, { id: 'onboarding', label: 'Onboarding' }, { id: 'ceo', label: 'CEO' }, { id: 'coo', label: 'COO' }];

function emptyDef(): Partial<KPIDefinition> {
  return { name: '', code: '', description: '', assignedRoles: ['sdr'], active: true, targetValue: 0, period: 'weekly', unit: 'count', warningThreshold: 60, failThreshold: 40, attendanceAffects: true, leaveAffects: true, weekendsCount: false };
}

// ═══════════════════════════════════════════════════════════
// SDR PROFILE DRAWER
// ═══════════════════════════════════════════════════════════

function SDRProfileDrawer({ employeeId, open, onOpenChange }: { employeeId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const empStore = useEmployees();
  const leave = useLeave();
  const { companies, activities } = useCompanyStore();
  const kpiDefs = useKPIDefinitions();

  if (!employeeId) return null;
  const emp = empStore.getEmployee(employeeId);
  const member = TEAM.find(m => m.id === employeeId);
  if (!emp || !member) return null;

  const policy = empStore.getLeavePolicy(emp.leavePolicyId);
  const weekLeaveDates = leave.requests.filter(r => r.userId === employeeId && r.status === 'approved').map(r => r.startDate);
  const wb = computeWeeklyBrandKPI(employeeId, weekLeaveDates);
  const ownedLeads = companies.filter(c => c.assignedTo === employeeId || c.assigned_sdr === employeeId);
  // Event-based weekly counts — survive lifecycle progression past meeting/converted state.
  const meetingsBooked = countMeetingsBookedThisMonth(ownedLeads, employeeId);
  const conversions = countConversionsThisMonth(ownedLeads, activities, employeeId);
  const balanceLabel = getLeaveBalanceLabel(emp.leaveRemaining, emp.annualLeaveAllowance, emp.employmentStatus === 'probationary', policy?.probationMode);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">{emp.fullName.charAt(0)}</div>
            <div>
              <SheetTitle className="text-lg">{emp.fullName}</SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] capitalize">{emp.role}</Badge>
                {emp.region && <Badge variant="outline" className="text-[10px]"><MapPin className="h-2.5 w-2.5 mr-0.5" />{emp.region}</Badge>}
                <Badge className={cn('text-[10px] border', EMPLOYMENT_STATUS_COLORS[emp.employmentStatus])}>{EMPLOYMENT_STATUS_LABELS[emp.employmentStatus]}</Badge>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-4 pb-6">
          {/* Weekly KPI with pacing */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Target className="h-3 w-3" /> Weekly Brand Progress</h4>
              <Badge className={cn('text-[9px]', getPacingColor(wb.pacingStatus))}>{getPacingLabel(wb.pacingStatus)}</Badge>
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold">{wb.brandsCompleted}</span>
                <span className="text-xs text-muted-foreground">/ {wb.weeklyTarget} brands</span>
                {wb.brandsInProgress > 0 && <span className="text-[10px] text-warning ml-1">+ {wb.brandsInProgress} need 2nd contact</span>}
              </div>
              <Progress value={wb.weeklyTarget > 0 ? Math.min(100, Math.round((wb.brandsCompleted / wb.weeklyTarget) * 100)) : 0} className="h-1.5 mt-1" />
              <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">{wb.guidanceMessage}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mt-1">
              <div><p className="text-sm font-bold">{meetingsBooked}</p><p className="text-[9px] text-muted-foreground">Meetings MTD</p></div>
              <div><p className="text-sm font-bold">{Math.ceil(wb.requiredPacePerDay)}/day</p><p className="text-[9px] text-muted-foreground">{wb.daysRemaining}d left</p></div>
              <div><p className="text-sm font-bold text-primary">{conversions}</p><p className="text-[9px] text-muted-foreground">Conversions MTD</p></div>
            </div>
          </div>
          {/* Leave */}
          <div className="rounded-lg border p-3 space-y-1">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><CalendarOff className="h-3 w-3" /> Leave</h4>
            <p className="text-xs">{balanceLabel}</p>
            <p className="text-[10px] text-muted-foreground">Joined {emp.joiningDate}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════

function OverviewTab({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const { currentUser, isLeadership, isSdr, isOnboarding } = useUser();
  const { companies: onbCompanies, activities: allActivities } = useCompanyStore();
  const attendance = useAttendance();
  const leave = useLeave();
  const empStore = useEmployees();
  const kpiDefs = useKPIDefinitions();

  const sdrs = TEAM.filter(m => m.role === 'sdr' || m.role === 'onboarding');
  const today = todayKey();

  // Manager stats
  const stats = useMemo(() => {
    let present = 0, late = 0, onLeave = 0, absent = 0, notCheckedIn = 0;
    for (const m of sdrs) {
      const emp = empStore.getEmployee(m.id);
      const entry = attendance.getForDate(m.id, today);
      const approvedLeave = leave.getForDate(m.id, today);
      const ds = computeDayState({
        checkInTime: entry?.checkInTime, checkOutTime: entry?.checkOutTime,
        hoursLogged: entry?.hoursLogged, isLate: entry?.isLate, isEarlyLeave: entry?.isEarlyLeave,
        hasApprovedLeave: !!approvedLeave && approvedLeave.status === 'approved',
        leaveType: approvedLeave?.type,
        shiftStart: emp?.shiftStart || '09:00', shiftEnd: emp?.shiftEnd || '17:00',
        graceMinutes: emp?.graceMinutes ?? 15, timezone: emp?.timezone,
        attendanceExempt: emp?.attendanceExempt, isProbationary: emp?.employmentStatus === 'probationary',
        isToday: true,
      });
      if (['present', 'present_late', 'present_early_leave', 'present_late_early_leave'].includes(ds.state)) {
        present++;
        if (ds.lateByMinutes > 0) late++;
      }
      else if (ds.state === 'on_leave' || ds.state === 'half_day') onLeave++;
      else if (ds.state === 'absent') absent++;
      else if (ds.state === 'not_checked_in') notCheckedIn++;
    }
    return { present, late, onLeave, absent, notCheckedIn };
  }, [attendance, leave, empStore, sdrs, today]);

  const kpiStats = useMemo(() => {
    const sdrOnly = sdrs.filter(m => m.role === 'sdr');
    const brandsKPI = kpiDefs.getActive('sdr').find(k => k.code === MANDATORY_KPI_CODE);
    const totalBrands = sdrOnly.reduce((s, m) => s + getWeeklySnapshot(m.id).brandsReached, 0);
    // Canonical: derive weekly target from the brands-per-working-day setting.
    // No hardcoded fallback — it must always trace back to settings.
    const cfg = getWeeklyKPIConfig();
    const weekTarget = brandsKPI ? brandsKPI.targetValue : cfg.brandsPerWorkingDay * 5;
    const atRisk = sdrOnly.filter(m => {
      const snap = getWeeklySnapshot(m.id);
      const target = brandsKPI ? getEffectiveTarget(brandsKPI, m.id) : weekTarget;
      return target > 0 && (snap.brandsReached / target) < 0.5;
    }).length;
    const onTrack = sdrOnly.filter(m => {
      const snap = getWeeklySnapshot(m.id);
      const target = brandsKPI ? getEffectiveTarget(brandsKPI, m.id) : weekTarget;
      return target > 0 && (snap.brandsReached / target) >= 0.7;
    }).length;
    return { totalBrands, atRisk, onTrack };
  }, [sdrs, kpiDefs]);

  const pendingLeaves = leave.getPending();
  const myAttendance = attendance.getToday(currentUser);
  const myProfile = empStore.getEmployee(currentUser);
  const myPolicy = myProfile ? empStore.getLeavePolicy(myProfile.leavePolicyId) : undefined;

  return (
    <div className="space-y-5">
      {/* Onboarding self view — no SDR KPI, no brands/week, no pacing */}
      {isOnboarding && (() => {
        const enriched = onbCompanies.map(c => ({ c, cs: getCanonicalState(c) }));
        const myTrials = enriched.filter(({ cs }) =>
          ['trial_proposed', 'trial_ready', 'trial_active'].includes(cs.lifecycle_stage)
        );
        const blocked = myTrials.filter(({ cs }) =>
          cs.trial_stage === 'needs_approval' ||
          cs.trial_stage === 'needs_approval_and_credentials' ||
          cs.trial_stage === 'needs_credentials'
        );
        const ready = myTrials.filter(({ cs }) => cs.trial_stage === 'ready_to_activate');
        const active = myTrials.filter(({ cs }) => cs.trial_stage === 'active');
        return (
          <Card>
            <CardContent className="py-4 px-4">
              <h3 className="text-sm font-medium mb-3">Onboarding overview</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-xl font-semibold">{ready.length}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Ready to start</p></div>
                <div><p className="text-xl font-semibold text-warning">{blocked.length}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Blocked</p></div>
                <div><p className="text-xl font-semibold text-success">{active.length}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Active trials</p></div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* SDR self check-in + KPI */}
      {isSdr && (
        <>
          <Card className={cn('border', myAttendance?.checkInTime ? 'border-green-500/30' : 'border-amber-500/30')}>
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn('p-2 rounded-lg', myAttendance?.checkInTime ? 'bg-green-500/10' : 'bg-amber-500/10')}>
                  {myAttendance?.checkInTime ? <UserCheck className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-amber-500" />}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {myAttendance?.checkInTime ? `Checked in at ${myAttendance.checkInTime}` : 'Not checked in yet'}
                  </p>
                  {myProfile && (
                    <p className="text-[10px] text-muted-foreground">
                      {EMPLOYMENT_STATUS_LABELS[myProfile.employmentStatus]} · {getLeaveBalanceLabel(myProfile.leaveRemaining, myProfile.annualLeaveAllowance, myProfile.employmentStatus === 'probationary', myPolicy?.probationMode)}
                    </p>
                  )}
                  {myAttendance?.checkOutTime && (
                    <p className="text-[10px] text-muted-foreground">Out at {myAttendance.checkOutTime} · {myAttendance.hoursLogged}h</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {!myAttendance?.checkInTime && (
                  <Button size="sm" onClick={() => {
                    const emp = empStore.getEmployee(currentUser);
                    const hasLeave = leave.hasApprovedLeaveToday(currentUser);
                    const result = attendance.checkIn(currentUser, emp?.shiftStart, emp?.graceMinutes, hasLeave, emp?.timezone);
                    if (result.success) toast.success('Checked in');
                    else toast.error(result.message || 'Check-in blocked');
                  }}><LogIn className="h-3.5 w-3.5 mr-1" /> Check In</Button>
                )}
                {myAttendance?.checkInTime && !myAttendance.checkOutTime && (
                  <Button size="sm" variant="outline" onClick={() => {
                    const emp = empStore.getEmployee(currentUser);
                    attendance.checkOut(currentUser, emp?.timezone, emp?.shiftEnd);
                    toast.success('Checked out');
                  }}><LogOut className="h-3.5 w-3.5 mr-1" /> Check Out</Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Weekly Brand KPI with pacing */}
          {(() => {
            const weekLeaveDates = leave.requests
              .filter(r => r.userId === currentUser && r.status === 'approved')
              .map(r => r.startDate);
            const wb = computeWeeklyBrandKPI(currentUser, weekLeaveDates);
            const weekPct = wb.weeklyTarget > 0 ? Math.round((wb.brandsCompleted / wb.weeklyTarget) * 100) : 0;
            const activeKPIs = kpiDefs.getForUser(currentUser, 'sdr').filter(k => k.code !== MANDATORY_KPI_CODE && k.targetValue > 0);
            const weeklySnap = getWeeklySnapshot(currentUser);
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/10 bg-primary/5 px-4 py-2.5">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">Brands Reached Out</span> is mandatory. 1 brand = both contacts reached. Weekly target is what matters.
                  </p>
                </div>
                <Card><CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-primary" /><span className="text-xs text-muted-foreground">Brands This Week</span></div>
                    <Badge className={cn('text-[9px]', getPacingColor(wb.pacingStatus))}>{getPacingLabel(wb.pacingStatus)}</Badge>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    <span className="text-2xl font-bold">{wb.brandsCompleted}</span>
                    <span className="text-sm text-muted-foreground">/ {wb.weeklyTarget}</span>
                    {wb.brandsInProgress > 0 && <span className="text-xs text-warning ml-2">+ {wb.brandsInProgress} need 2nd contact</span>}
                  </div>
                  <Progress value={Math.min(100, weekPct)} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{wb.guidanceMessage}</p>
                  {wb.daysRemaining > 0 && wb.requiredPacePerDay > 0 && (
                    <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Required pace to finish</span>
                      <span className="text-xs font-semibold">{Math.ceil(wb.requiredPacePerDay)} brands/day · {wb.daysRemaining} day{wb.daysRemaining > 1 ? 's' : ''} left</span>
                    </div>
                  )}
                </CardContent></Card>
                {activeKPIs.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {activeKPIs.map(kpi => {
                      const target = getEffectiveTarget(kpi, currentUser);
                      const metricKey = kpi.code as keyof typeof weeklySnap.actions;
                      const actual = weeklySnap.actions[metricKey] ?? 0;
                      const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
                      return (
                        <Card key={kpi.id}><CardContent className="py-2.5 px-3">
                          <p className="text-[10px] text-muted-foreground">{kpi.name}</p>
                          <div className="flex items-baseline gap-1 mt-0.5"><span className="text-lg font-bold">{actual}</span><span className="text-xs text-muted-foreground">/ {target}/wk</span></div>
                          <Progress value={pct} className="h-1 mt-1" />
                        </CardContent></Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Leadership overview */}
      {isLeadership && (
        <>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><UserCheck className="h-3 w-3" /> Attendance Today</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: 'Present', value: stats.present, icon: UserCheck, color: 'text-green-500' },
                { label: 'Late', value: stats.late, icon: AlertTriangle, color: 'text-amber-500' },
                { label: 'On Leave', value: stats.onLeave, icon: CalendarOff, color: 'text-blue-400' },
                { label: 'Not Checked In', value: stats.notCheckedIn, icon: Clock, color: 'text-amber-500' },
                { label: 'Absent', value: stats.absent, icon: UserX, color: 'text-destructive' },
              ].filter(s => s.value > 0 || ['Present', 'Absent'].includes(s.label)).map(s => (
                <Card key={s.label}><CardContent className="py-3 px-3 flex items-center gap-2">
                  <s.icon className={cn('h-3.5 w-3.5', s.color)} />
                  <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground">{s.label}</p></div>
                </CardContent></Card>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Target className="h-3 w-3" /> Weekly Brand KPI</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Card><CardContent className="py-3 px-3 text-center"><p className="text-lg font-bold text-primary">{kpiStats.totalBrands}</p><p className="text-[9px] text-muted-foreground">Brands This Week</p></CardContent></Card>
              <Card><CardContent className="py-3 px-3 text-center"><p className={cn("text-lg font-bold", kpiStats.onTrack > 0 ? 'text-green-500' : '')}>{kpiStats.onTrack}</p><p className="text-[9px] text-muted-foreground">On Track</p></CardContent></Card>
              <Card><CardContent className="py-3 px-3 text-center"><p className={cn("text-lg font-bold", kpiStats.atRisk > 0 ? 'text-destructive' : 'text-green-500')}>{kpiStats.atRisk}</p><p className="text-[9px] text-muted-foreground">Needs Review</p></CardContent></Card>
            </div>
          </div>

          {(() => {
            const companies = onbCompanies;
            const activities = allActivities;
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            let weekMeetings = 0, monthMeetings = 0, weekConvs = 0, monthConvs = 0;
            const sdrIds = new Set(sdrs.filter(m => m.role === 'sdr').map(m => m.id));
            for (const lead of companies) {
              const owner = lead.assignedTo || lead.assigned_sdr;
              if (!owner || !sdrIds.has(owner)) continue;
              for (const m of lead.meetings || []) {
                if (!m.created_at) continue;
                const t = new Date(m.created_at);
                if (t >= monthStart) monthMeetings++;
              }
              weekMeetings += countMeetingsBookedThisWeek([lead], owner);
            }
            const seenM = new Set<string>(), seenW = new Set<string>();
            for (const a of activities) {
              if (a.type !== 'conversion' && a.type !== 'payment_confirmed') continue;
              const lead = companies.find(c => c.id === a.leadId);
              const owner = lead?.assignedTo || lead?.assigned_sdr;
              if (!owner || !sdrIds.has(owner)) continue;
              const t = new Date(a.createdAt);
              if (t >= monthStart && !seenM.has(a.leadId)) { seenM.add(a.leadId); monthConvs++; }
            }
            for (const id of sdrIds) weekConvs += countConversionsThisWeek(companies, activities, id);
            return (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Meetings & Conversions</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card><CardContent className="py-3 px-3 text-center"><p className="text-lg font-bold">{weekMeetings}</p><p className="text-[9px] text-muted-foreground">Meetings · Week</p></CardContent></Card>
                  <Card><CardContent className="py-3 px-3 text-center"><p className="text-lg font-bold">{monthMeetings}</p><p className="text-[9px] text-muted-foreground">Meetings · Month</p></CardContent></Card>
                  <Card><CardContent className="py-3 px-3 text-center"><p className="text-lg font-bold text-primary">{weekConvs}</p><p className="text-[9px] text-muted-foreground">Conversions · Week</p></CardContent></Card>
                  <Card><CardContent className="py-3 px-3 text-center"><p className="text-lg font-bold text-primary">{monthConvs}</p><p className="text-[9px] text-muted-foreground">Conversions · Month</p></CardContent></Card>
                </div>
              </div>
            );
          })()}

          {pendingLeaves.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><CalendarOff className="h-3 w-3" /> Pending Leave ({pendingLeaves.length})</h3>
              <div className="space-y-1.5">
                {pendingLeaves.map(req => {
                  const member = TEAM.find(m => m.id === req.userId);
                  const emp = empStore.getEmployee(req.userId);
                  return (
                    <Card key={req.id} className="border-amber-500/20">
                      <CardContent className="py-2.5 px-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{member?.name} — {LEAVE_TYPE_LABELS[req.type]}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {req.startDate}{req.endDate && req.endDate !== req.startDate ? ` → ${req.endDate}` : ''} · {req.reason}
                            {req.isLateRequest && <span className="text-amber-500 ml-1">⚠ Late request</span>}
                          </p>
                          {req.exceedsProbationLimit && <p className="text-[9px] text-destructive">⚠ Exceeds probation monthly limit — requires manager override</p>}
                          <p className="text-[9px] text-muted-foreground">Submitted {formatTimestamp(req.submittedAt || req.createdAt)}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-green-500" onClick={() => { leave.approve(req.id, 'leadership'); toast.success('Leave approved'); }}>Approve</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => { leave.reject(req.id, 'leadership'); toast.success('Leave rejected'); }}>Reject</Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Team rows */}
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Users className="h-3 w-3" /> Team Status</h3>
            <div className="space-y-1.5">
              {sdrs.map(member => {
                const entry = attendance.getForDate(member.id, today);
                const emp = empStore.getEmployee(member.id);
                const approvedLeave = leave.getForDate(member.id, today);
                const ds = computeDayState({
                  checkInTime: entry?.checkInTime, checkOutTime: entry?.checkOutTime,
                  hoursLogged: entry?.hoursLogged, isLate: entry?.isLate,
                  hasApprovedLeave: !!approvedLeave && approvedLeave.status === 'approved',
                  leaveType: approvedLeave?.type,
                  shiftStart: emp?.shiftStart || '09:00', shiftEnd: emp?.shiftEnd || '17:00',
                  graceMinutes: emp?.graceMinutes ?? 15, timezone: emp?.timezone,
                  attendanceExempt: emp?.attendanceExempt, isProbationary: emp?.employmentStatus === 'probationary',
                  isToday: true,
                });
                const weekLeaveDates = leave.requests.filter(r => r.userId === member.id && r.status === 'approved').map(r => r.startDate);
                const wb = computeWeeklyBrandKPI(member.id, weekLeaveDates);

                return (
                  <Card key={member.id} className={cn('cursor-pointer hover:border-primary/30 transition-colors', (wb.pacingStatus === 'behind' || wb.pacingStatus === 'at_risk' || wb.pacingStatus === 'missed') && 'border-amber-500/20')} onClick={() => onOpenProfile(member.id)}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">{member.name.charAt(0)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{member.name}</span>
                            <Badge className={cn('text-[9px] border', ds.color)}>{ds.label}</Badge>
                            {ds.lateByLabel && <span className="text-[9px] text-amber-500">Late {ds.lateByLabel}</span>}
                          </div>
                          <div className="mt-1.5 max-w-[180px]">
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className="text-muted-foreground">Weekly brands</span>
                              <span className="font-medium tabular-nums">{wb.brandsCompleted}/{wb.weeklyTarget}</span>
                            </div>
                            <Progress value={wb.weeklyTarget > 0 ? Math.min(100, Math.round((wb.brandsCompleted / wb.weeklyTarget) * 100)) : 0} className="h-1" />
                          </div>
                        </div>
                        <Badge className={cn('text-[9px] shrink-0', getLeadershipPacingColor(wb.pacingStatus))}>{getLeadershipPacingLabel(wb.pacingStatus)}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════

function AttendanceTab() {
  const { currentUser, isLeadership } = useUser();
  const attendance = useAttendance();
  const leave = useLeave();
  const empStore = useEmployees();
  const [date, setDate] = useState(todayKey());
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideUser, setOverrideUser] = useState('');
  const [overrideStatus, setOverrideStatus] = useState<AttendanceStatus>('present');
  const [overrideNote, setOverrideNote] = useState('');
  const isToday = date === todayKey();

  const team = useMemo(() => TEAM.filter(m => m.role === 'sdr' || m.role === 'onboarding'), []);

  if (!isLeadership) {
    const myEntry = attendance.getForDate(currentUser, date);
    const emp = empStore.getEmployee(currentUser);
    const approvedLeave = leave.getForDate(currentUser, date);
    const ds = computeDayState({
      checkInTime: myEntry?.checkInTime, checkOutTime: myEntry?.checkOutTime,
      hoursLogged: myEntry?.hoursLogged, isLate: myEntry?.isLate,
      hasApprovedLeave: !!approvedLeave && approvedLeave.status === 'approved',
      leaveType: approvedLeave?.type,
      shiftStart: emp?.shiftStart || '09:00', shiftEnd: emp?.shiftEnd || '17:00',
      graceMinutes: emp?.graceMinutes ?? 15, timezone: emp?.timezone,
      attendanceExempt: emp?.attendanceExempt, isProbationary: emp?.employmentStatus === 'probationary',
      isToday,
    });
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto h-8 text-xs" />
          {isToday && <Badge variant="outline" className="text-[9px]">Today</Badge>}
        </div>
        <Card>
          <CardContent className="py-4 px-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={cn('text-xs border', ds.color)}>{ds.label}</Badge>
              {ds.hoursWorked > 0 && <span className="text-sm font-medium">{ds.hoursWorked}h worked</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground text-xs">Check-in</span><p className="font-medium">{ds.checkInTime || '—'}</p></div>
              <div><span className="text-muted-foreground text-xs">Check-out</span><p className="font-medium">{ds.checkOutTime || '—'}</p></div>
              {ds.lateByMinutes > 0 && <div><span className="text-muted-foreground text-xs">Late by</span><p className="font-medium text-amber-500">{ds.lateByLabel}</p></div>}
              {ds.earlyLeaveMinutes > 0 && <div><span className="text-muted-foreground text-xs">Early leave</span><p className="font-medium text-amber-500">{ds.earlyLeaveLabel}</p></div>}
            </div>
            {ds.payImpacted && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">{ds.payImpactReason}</div>
            )}
            {ds.needsApproval && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-500">{ds.approvalReason}</div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto h-8 text-xs" />
        {isToday && <Badge variant="outline" className="text-[9px]">Today</Badge>}
      </div>
      <div className="space-y-1.5">
        {team.map(member => {
          const entry = attendance.getForDate(member.id, date);
          const emp = empStore.getEmployee(member.id);
          const approvedLeave = leave.getForDate(member.id, date);
          const ds = computeDayState({
            checkInTime: entry?.checkInTime, checkOutTime: entry?.checkOutTime,
            hoursLogged: entry?.hoursLogged, isLate: entry?.isLate,
            hasApprovedLeave: !!approvedLeave && approvedLeave.status === 'approved',
            leaveType: approvedLeave?.type,
            shiftStart: emp?.shiftStart || '09:00', shiftEnd: emp?.shiftEnd || '17:00',
            graceMinutes: emp?.graceMinutes ?? 15, timezone: emp?.timezone,
            attendanceExempt: emp?.attendanceExempt, isProbationary: emp?.employmentStatus === 'probationary',
            isToday,
          });

          return (
            <Card key={member.id} className={cn(ds.needsApproval && 'border-amber-500/20', ds.state === 'absent' && 'border-destructive/20')}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">{member.name.charAt(0)}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{member.name}</span>
                        <Badge className={cn('text-[9px] border', ds.color)}>{ds.label}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {ds.managerLabel}
                        {ds.checkInTime && ` · In ${ds.checkInTime}`}
                        {ds.checkOutTime && ` · Out ${ds.checkOutTime}`}
                        {ds.hoursWorked > 0 && ` · ${ds.hoursWorked}h`}
                      </p>
                      {ds.payImpacted && <p className="text-[9px] text-destructive mt-0.5">{ds.payImpactReason}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => { setOverrideUser(member.id); setOverrideStatus(entry?.status || 'present'); setOverrideOpen(true); }}>
                    <Edit3 className="h-3 w-3" />
                  </Button>
                </div>
                {entry?.managerNote && <p className="text-[9px] text-muted-foreground mt-1.5 ml-11 italic">{entry.managerNote}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Attendance</DialogTitle><DialogDescription>Set status for {TEAM.find(m => m.id === overrideUser)?.name}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Select value={overrideStatus} onValueChange={v => setOverrideStatus(v as AttendanceStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['present', 'late', 'absent', 'half_day', 'leave_approved', 'remote', 'field_work', 'holiday'] as AttendanceStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{ATTENDANCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea placeholder="Manager note (optional)" value={overrideNote} onChange={e => setOverrideNote(e.target.value)} className="text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button onClick={() => { attendance.markStatus(overrideUser, date, overrideStatus, currentUser, overrideNote || undefined); toast.success('Attendance updated'); setOverrideOpen(false); setOverrideNote(''); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// KPI TAB — Weekly-first, reads from KPI definitions store
// ═══════════════════════════════════════════════════════════

function KPITab() {
  const { currentUser, isLeadership } = useUser();
  const kpiDefs = useKPIDefinitions();
  const leave = useLeave();
  const [showSettings, setShowSettings] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<KPIDefinition>>(emptyDef());
  const [isNew, setIsNew] = useState(true);
  const [weeklyConfig, setWeeklyConfig] = useState<WeeklyKPIConfig>(getWeeklyKPIConfig);
  const [kpiRevision, setKpiRevision] = useState(0);

  useEffect(() => {
    const refreshPolicy = () => {
      setWeeklyConfig(getWeeklyKPIConfig());
      kpiDefs.refresh();
      setKpiRevision(rev => rev + 1);
    };
    window.addEventListener('stylique:kpi-policy-updated', refreshPolicy);
    window.addEventListener('storage', refreshPolicy);
    return () => {
      window.removeEventListener('stylique:kpi-policy-updated', refreshPolicy);
      window.removeEventListener('storage', refreshPolicy);
    };
  }, [kpiDefs]);

  const sdrs = useMemo(() => isLeadership ? TEAM.filter(m => m.role === 'sdr') : TEAM.filter(m => m.id === currentUser), [isLeadership, currentUser]);
  const [selectedSdr, setSelectedSdr] = useState(sdrs[0]?.id || currentUser);

  const weekLeaveDates = useMemo(() => 
    leave.requests.filter(r => r.userId === selectedSdr && r.status === 'approved').map(r => r.startDate),
  [leave.requests, selectedSdr]);
  const wb = useMemo(() => computeWeeklyBrandKPI(selectedSdr, weekLeaveDates, weeklyConfig), [selectedSdr, weekLeaveDates, weeklyConfig, kpiRevision]);
  const weeklySnap = useMemo(() => getWeeklySnapshot(selectedSdr), [selectedSdr, kpiRevision]);
  const { companies, activities } = useCompanyStore();

  const activeKPIs = kpiDefs.getActive('sdr');
  const weeklyScoreValue = (code: string) => {
    const ownedLeads = companies.filter(c => c.assignedTo === selectedSdr || c.assigned_sdr === selectedSdr);
    if (code === 'meetings_booked') return countMeetingsBookedThisMonth(ownedLeads, selectedSdr);
    if (code === 'conversions') return countConversionsThisMonth(ownedLeads, activities, selectedSdr);
    const metricKey = code as keyof typeof weeklySnap.actions;
    return weeklySnap.actions[metricKey] ?? 0;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {isLeadership && sdrs.length > 1 && (
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              {sdrs.map(s => (
                <button key={s.id} onClick={() => setSelectedSdr(s.id)}
                  className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors', selectedSdr === s.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {s.name.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
        </div>
        {isLeadership && <Button size="sm" variant={showSettings ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Hide Settings' : 'KPI Settings'}</Button>}
      </div>

      {!showSettings && (
        <>
          {/* Brand KPI explanation */}
          <Card className="border-primary/15 bg-primary/5">
            <CardContent className="py-2.5 px-4 text-xs text-muted-foreground flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary shrink-0" />
              <span><strong className="text-foreground">Brands Reached Out</strong> is mandatory. 1 brand = both contacts reached. Weekly target is what matters.</span>
            </CardContent>
          </Card>

          {/* Main brands metric with pacing */}
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-primary" /><span className="text-xs text-muted-foreground">Brands This Week</span></div>
              <Badge className={cn('text-[9px]', isLeadership ? getLeadershipPacingColor(wb.pacingStatus) : getPacingColor(wb.pacingStatus))}>
                {isLeadership ? getLeadershipPacingLabel(wb.pacingStatus) : getPacingLabel(wb.pacingStatus)}
              </Badge>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-bold">{wb.brandsCompleted}</span>
              <span className="text-sm text-muted-foreground">/ {wb.weeklyTarget}</span>
              {!isLeadership && wb.brandsInProgress > 0 && <span className="text-xs text-warning ml-2">+ {wb.brandsInProgress} need 2nd contact</span>}
            </div>
            <Progress value={wb.weeklyTarget > 0 ? Math.min(100, Math.round((wb.brandsCompleted / wb.weeklyTarget) * 100)) : 0} className="h-1.5" />

            {/* Manager-like guidance — SDR only; leadership uses the simpler badge */}
            {!isLeadership && (
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{wb.guidanceMessage}</p>
            )}

            {/* Pacing recovery bar — SDR only */}
            {!isLeadership && wb.daysRemaining > 0 && wb.requiredPacePerDay > 0 && (
              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Required pace to finish</span>
                <span className="text-xs font-semibold">{Math.ceil(wb.requiredPacePerDay)} brands/day · {wb.daysRemaining} day{wb.daysRemaining > 1 ? 's' : ''} left</span>
              </div>
            )}

            {/* Week day-by-day */}
            {wb.leaveDays > 0 && (
              <p className="text-[9px] text-blue-400 mt-1">
                {wb.leaveDays} approved leave day{wb.leaveDays > 1 ? 's' : ''} this week · {wb.effectiveWorkingDays} effective working days
              </p>
            )}
          </CardContent></Card>

          {/* Focused weekly scorecard: meetings + conversions. Brands are shown above. */}
          {(() => {
            const otherKPIs = activeKPIs.filter(k => k.code !== MANDATORY_KPI_CODE && k.targetValue > 0);
            if (otherKPIs.length === 0) return null;
            return (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Monthly Targets</h4>
                <div className="grid grid-cols-2 gap-2">
                  {otherKPIs.map(kpi => {
                    const target = getEffectiveTarget(kpi, selectedSdr);
                    const actual = weeklyScoreValue(kpi.code);
                    const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
                    return (
                      <Card key={kpi.id}><CardContent className="py-2.5 px-3">
                        <p className="text-[10px] text-muted-foreground">{kpi.name}</p>
                        <div className="flex items-baseline gap-1 mt-0.5"><span className="text-lg font-bold">{actual}</span><span className="text-xs text-muted-foreground">/ {target}/mo</span></div>
                        <Progress value={pct} className="h-1 mt-1" />
                      </CardContent></Card>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Brand workflow detail */}
          {wb.brandDetails.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Target className="h-4 w-4" /> This Week's Brands<Badge variant="outline" className="text-[9px] ml-auto">{wb.brandsCompleted}/{wb.brandsTouched} complete</Badge></CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-1.5">
                {wb.brandDetails.map(b => (
                  <div key={b.leadId} className={cn('p-2.5 rounded-lg border text-sm', BRAND_STATUS_COLORS[b.status])}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs">{b.companyName}</span>
                      <Badge variant={b.status === 'completed' ? 'default' : 'outline'} className="text-[9px]">
                        {BRAND_STATUS_LABELS[b.status]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* KPI SETTINGS — leadership only */}
      {showSettings && isLeadership && (
        <div className="space-y-4">
          {/* Weekly KPI Policy */}
          <Card className="border-primary/15">
            <CardContent className="py-3 px-4 space-y-3">
              <h4 className="text-xs font-medium">Weekly KPI Policy</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Brands per working day</Label>
                  <Input type="number" value={weeklyConfig.brandsPerWorkingDay} onChange={e => setWeeklyConfig({ ...weeklyConfig, brandsPerWorkingDay: Number(e.target.value) })} className="text-sm h-8" />
                </div>
                <div>
                  <Label className="text-[10px]">Approved leave affects target?</Label>
                  <Select value={weeklyConfig.leaveProrationMode} onValueChange={v => setWeeklyConfig({ ...weeklyConfig, leaveProrationMode: v as 'fixed' | 'prorated' })}>
                    <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prorated">Prorated — reduce target for leave days</SelectItem>
                      <SelectItem value="fixed">Fixed — target stays regardless of leave</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => {
                saveWeeklyKPIConfig(weeklyConfig);
                kpiDefs.refresh();
                setWeeklyConfig(getWeeklyKPIConfig());
                setKpiRevision(rev => rev + 1);
                toast.success('Weekly KPI policy saved');
              }}>Save Policy</Button>
            </CardContent>
          </Card>

          <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-2.5">
            <p className="text-xs text-muted-foreground"><strong className="text-foreground">KPI Definitions</strong> — Toggle KPIs on/off, edit weekly targets. Brands Reached Out is mandatory.</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">All KPI definitions</p>
            <Button size="sm" onClick={() => { setEditing(emptyDef()); setIsNew(true); setEditOpen(true); }}><Plus className="h-3.5 w-3.5 mr-1" /> New KPI</Button>
          </div>
          <div className="space-y-1.5">
            {kpiDefs.definitions.map(def => (
              <Card key={def.id} className={cn(!def.active && 'opacity-60')}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{def.name}</span>
                        {def.mandatory && <Badge className="text-[9px] bg-primary/15 text-primary border-primary/30">Mandatory</Badge>}
                        <Badge className={cn('text-[9px]', def.active ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground')}>{def.active ? 'Active' : 'Off'}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{PERIOD_LABELS[def.period]} · Target: {def.targetValue} · Roles: {def.assignedRoles.join(', ')}</p>
                      {def.description && <p className="text-[10px] text-muted-foreground">{def.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!def.mandatory && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => kpiDefs.toggle(def.id)}>
                          {def.active ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditing({ ...def }); setIsNew(false); setEditOpen(true); }}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      {!def.mandatory && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => { kpiDefs.remove(def.id); toast.success('Removed'); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* KPI Edit Dialog */}
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{isNew ? 'Create KPI' : 'Edit KPI'}</DialogTitle><DialogDescription>{isNew ? 'Define a new weekly metric' : 'Update KPI definition'}</DialogDescription></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Name</Label><Input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="text-sm" /></div>
                  <div><Label className="text-xs">Code</Label><Input value={editing.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value })} className="text-sm" /></div>
                </div>
                <div><Label className="text-xs">Description</Label><Textarea value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="text-sm" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Weekly Target</Label><Input type="number" value={editing.targetValue || 0} onChange={e => setEditing({ ...editing, targetValue: Number(e.target.value) })} className="text-sm" /></div>
                  <div><Label className="text-xs">Period</Label>
                    <Select value={editing.period || 'weekly'} onValueChange={v => setEditing({ ...editing, period: v as KPIMeasurePeriod })}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(PERIOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Unit</Label>
                    <Select value={editing.unit || 'count'} onValueChange={v => setEditing({ ...editing, unit: v as KPIUnit })}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(UNIT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Warning %</Label><Input type="number" value={editing.warningThreshold || 60} onChange={e => setEditing({ ...editing, warningThreshold: Number(e.target.value) })} className="text-sm" /></div>
                  <div><Label className="text-xs">Fail %</Label><Input type="number" value={editing.failThreshold || 40} onChange={e => setEditing({ ...editing, failThreshold: Number(e.target.value) })} className="text-sm" /></div>
                </div>
                <div><Label className="text-xs mb-2 block">Assigned Roles</Label>
                  <div className="flex gap-2 flex-wrap">{ROLES.map(r => (
                    <label key={r.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox checked={editing.assignedRoles?.includes(r.id)} onCheckedChange={() => { const roles = editing.assignedRoles || []; setEditing({ ...editing, assignedRoles: roles.includes(r.id) ? roles.filter(x => x !== r.id) : [...roles, r.id] }); }} />{r.label}
                    </label>
                  ))}</div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between"><Label className="text-xs">Attendance affects target</Label><Switch checked={editing.attendanceAffects} onCheckedChange={v => setEditing({ ...editing, attendanceAffects: v })} /></div>
                  <div className="flex items-center justify-between"><Label className="text-xs">Leave affects target</Label><Switch checked={editing.leaveAffects} onCheckedChange={v => setEditing({ ...editing, leaveAffects: v })} /></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  if (!editing.name || !editing.code) { toast.error('Name and code required'); return; }
                  kpiDefs.save({
                    id: editing.id || `kpi-${crypto.randomUUID().slice(0, 8)}`,
                    name: editing.name!, code: editing.code!, description: editing.description || '',
                    assignedRoles: editing.assignedRoles || ['sdr'], active: editing.active ?? true,
                    mandatory: editing.code === MANDATORY_KPI_CODE,
                    targetValue: editing.targetValue || 0, period: editing.period || 'weekly',
                    unit: editing.unit || 'count', warningThreshold: editing.warningThreshold || 60,
                    failThreshold: editing.failThreshold || 40, attendanceAffects: editing.attendanceAffects ?? true,
                    leaveAffects: editing.leaveAffects ?? true, weekendsCount: editing.weekendsCount ?? false,
                    createdAt: editing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
                  } as KPIDefinition);
                  setKpiRevision(rev => rev + 1);
                  toast.success(isNew ? 'KPI created' : 'KPI updated');
                  setEditOpen(false);
                }}>{isNew ? 'Create' : 'Save'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LEAVE TAB — with timestamps, probation enforcement, history
// ═══════════════════════════════════════════════════════════

function LeaveTab() {
  const { currentUser, isLeadership } = useUser();
  const leave = useLeave();
  const empStore = useEmployees();
  const [requestOpen, setRequestOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('full_day');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState('');
  const [hours, setHours] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const myProfile = empStore.getEmployee(currentUser);
  const myPolicy = myProfile ? empStore.getLeavePolicy(myProfile.leavePolicyId) : undefined;

  const displayedRequests = useMemo(() => {
    let reqs = isLeadership ? leave.requests : leave.getForUser(currentUser);
    reqs = [...reqs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filter !== 'all') return reqs.filter(r => r.status === filter);
    return reqs;
  }, [leave.requests, currentUser, isLeadership, filter]);

  // Probation check for current user
  const probCheck = useMemo(() => {
    if (!myProfile) return null;
    return checkProbationLeave(leave.requests, currentUser, startDate, myProfile.joiningDate, myProfile.employmentStatus);
  }, [myProfile, leave.requests, currentUser, startDate]);

  const handleSubmit = () => {
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    const isPaidType = ['full_day', 'half_day', 'sick_leave'].includes(leaveType);
    const paidOrUnpaid: 'paid' | 'unpaid' | 'auto' = myProfile?.employmentStatus === 'probationary' ? 'unpaid' : isPaidType ? 'paid' : 'auto';
    const result = leave.submit(
      { userId: currentUser, type: leaveType, startDate, endDate: endDate || undefined, hours: hours || undefined, reason, note: note || undefined, paidOrUnpaid },
      myProfile?.shiftStart,
      myProfile?.joiningDate,
      myProfile?.employmentStatus,
    );
    if (result.probationCheck && !result.probationCheck.allowed) {
      toast.warning('Probation limit reached — this request requires manager override.');
    } else if (result.isLateRequest) {
      toast.warning('Late request — submitted less than 12h before shift. Requires manager override.');
    } else {
      toast.success('Leave request submitted');
    }
    setRequestOpen(false); setReason(''); setNote('');
  };

  const needsHours = ['two_hour_permission', 'custom_short', 'late_arrival', 'early_leave'].includes(leaveType);

  return (
    <div className="space-y-4">
      {/* Leadership: month summary of leave taken */}
      {isLeadership && (() => {
        const monthKey = new Date().toISOString().slice(0, 7);
        const team = empStore.employees.filter(e => e.active && (e.role === 'sdr' || e.role === 'onboarding'));
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {team.map(emp => {
              const monthlyUsed = leave.getMonthlyCount(emp.id, monthKey);
              return (
                <Card key={emp.id}>
                  <CardContent className="py-2 px-3">
                    <p className="text-xs font-medium truncate">{emp.fullName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{monthlyUsed} leave day{monthlyUsed === 1 ? '' : 's'} this month</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })()}

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'ghost'} className="h-7 text-xs capitalize" onClick={() => setFilter(f)}>{f}{f === 'pending' ? ` (${leave.getPending().length})` : ''}</Button>
          ))}
        </div>
        {!isLeadership && <Button size="sm" onClick={() => setRequestOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Request</Button>}
      </div>

      {/* Leave request list with full timestamps */}
      <div className="space-y-1.5">
        {displayedRequests.length === 0 ? (
          <Card className="py-8 text-center"><CalendarOff className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-xs text-muted-foreground">No leave requests</p></Card>
        ) : displayedRequests.map(req => {
          const member = TEAM.find(m => m.id === req.userId);
          const emp = empStore.getEmployee(req.userId);
          const isProbationary = emp?.employmentStatus === 'probationary';
          return (
            <Card key={req.id} className={cn(req.status === 'pending' && 'border-amber-500/20')}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isLeadership && <span className="text-sm font-medium">{member?.name}</span>}
                      <Badge className={cn('text-[9px] border', LEAVE_STATUS_COLORS[req.status])}>{LEAVE_STATUS_LABELS[req.status]}</Badge>
                      <Badge variant="outline" className="text-[9px]">{LEAVE_TYPE_LABELS[req.type]}</Badge>
                      {req.isLateRequest && <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500">Late request</Badge>}
                      {req.exceedsProbationLimit && <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">Over limit</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {req.startDate}{req.endDate && req.endDate !== req.startDate ? ` → ${req.endDate}` : ''}{req.hours ? ` · ${req.hours}h` : ''} · {req.reason}
                    </p>
                    {/* Timestamps */}
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      Submitted {formatTimestamp(req.submittedAt || req.createdAt)}
                    </p>
                    {req.decidedAt && req.decidedBy && (
                      <p className="text-[9px] text-muted-foreground">
                        {req.status === 'approved' ? 'Approved' : req.status === 'rejected' ? 'Rejected' : 'Decided'} by {TEAM.find(m => m.id === req.decidedBy)?.name || req.decidedBy} on {formatTimestamp(req.decidedAt)}
                      </p>
                    )}
                    {/* Policy basis */}
                    {req.approverNote && <p className="text-[9px] text-muted-foreground italic">Note: {req.approverNote}</p>}
                  </div>
                  {isLeadership && req.status === 'pending' && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-green-500" onClick={() => { leave.approve(req.id, currentUser); toast.success('Approved'); }}>Approve</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => { leave.reject(req.id, currentUser); toast.success('Rejected'); }}>Reject</Button>
                    </div>
                  )}
                  {!isLeadership && req.status === 'pending' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { leave.cancel(req.id); toast.success('Cancelled'); }}>Cancel</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Leave request dialog with probation warnings */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Leave</DialogTitle><DialogDescription>Submit a leave or permission request</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Leave Type</Label>
              <Select value={leaveType} onValueChange={v => setLeaveType(v as LeaveType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Start Date</Label><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm" /></div>
              {['full_day', 'sick_leave', 'emergency_leave'].includes(leaveType) && (
                <div><Label className="text-xs">End Date</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm" /></div>
              )}
              {needsHours && (<div><Label className="text-xs">Hours</Label><Input type="number" value={hours} onChange={e => setHours(Number(e.target.value))} className="text-sm" /></div>)}
            </div>
            {probCheck && !probCheck.allowed && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                <p className="text-[10px] text-destructive">{probCheck.message}</p>
              </div>
            )}
            <div><Label className="text-xs">Reason</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for leave" className="text-sm" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button><Button onClick={handleSubmit}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COMPENSATION TAB — with salary editing, history
// ═══════════════════════════════════════════════════════════

function CompensationTab() {
  const { currentUser, isLeadership } = useUser();
  const empStore = useEmployees();
  const leave = useLeave();
  const attendance = useAttendance();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustEmpId, setAdjustEmpId] = useState('');
  const [manualAdd, setManualAdd] = useState(0);
  const [manualDeduct, setManualDeduct] = useState(0);
  const [manualAddNotes, setManualAddNotes] = useState('');
  const [manualDeductNotes, setManualDeductNotes] = useState('');
  const [editRuleOpen, setEditRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [salaryEditOpen, setSalaryEditOpen] = useState(false);
  const [salaryEditEmpId, setSalaryEditEmpId] = useState('');
  const [newSalary, setNewSalary] = useState(0);
  const [view, setView] = useState<'payroll' | 'rules' | 'history'>('payroll');

  const locked = empStore.isPayrollLocked(period);

  const payrollRows = useMemo(() => {
    return empStore.employees.filter(e => e.active).map(emp => {
      const existing = empStore.payrollEntries.find(p => p.employeeId === emp.id && p.period === period);
      if (existing) return { emp, entry: existing };

      const policy = empStore.getLeavePolicy(emp.leavePolicyId);
      const periodLeaves = leave.requests.filter(r => r.userId === emp.id && r.startDate.startsWith(period));
      const paidLeaves = periodLeaves.filter(r => r.status === 'approved' && ['full_day', 'half_day', 'sick_leave'].includes(r.type) && emp.employmentStatus !== 'probationary').length;
      const unpaidLeaves = periodLeaves.filter(r => r.status === 'approved').length - paidLeaves;
      const monthEntries = attendance.entries.filter(e => e.userId === emp.id && e.date.startsWith(period));
      const absences = monthEntries.filter(e => e.status === 'absent').length;
      const halfDays = monthEntries.filter(e => e.status === 'half_day').length;
      const lates = monthEntries.filter(e => e.isLate).length;

      const calc = calculatePayroll(emp, period, policy, paidLeaves, unpaidLeaves, absences, halfDays, lates, 0, 0, empStore.commissionRules);
      return { emp, entry: { ...calc, id: `payroll-${emp.id}-${period}`, locked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as PayrollEntry };
    });
  }, [empStore.employees, empStore.payrollEntries, empStore.commissionRules, period, leave.requests, attendance.entries]);

  const handleSalaryChange = () => {
    const emp = empStore.getEmployee(salaryEditEmpId);
    if (!emp) return;
    const oldSalary = emp.baseSalary;
    empStore.saveEmployee({ ...emp, baseSalary: newSalary, salaryEffectiveDate: todayKey() });
    empStore.logAudit({ actor: currentUser, action: 'changed_salary', target: 'employee', targetId: emp.id, oldValue: String(oldSalary), newValue: String(newSalary), notes: `${emp.currency} ${oldSalary} → ${emp.currency} ${newSalary}` });
    toast.success(`Base salary updated to ${emp.currency} ${newSalary.toLocaleString()}`);
    setSalaryEditOpen(false);
  };

  // Self-service view
  if (!isLeadership) {
    const myRow = payrollRows.find(r => r.emp.id === currentUser);
    const myProfile = empStore.getEmployee(currentUser);
    if (!myRow || !myProfile) return (
      <div className="py-8 text-center"><DollarSign className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No payroll data available.</p></div>
    );
    const salaryLabel = getSalaryDisplay(myProfile.baseSalary, myProfile.currency);
    const entry = myRow.entry;
    return (
      <div className="space-y-4">
        <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-auto h-8 text-xs" />
        <Card>
          <CardContent className="py-4 px-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">My Payroll — {period}</p>
              {entry.locked && <Badge className="text-[9px] bg-green-500/15 text-green-500"><Lock className="h-2.5 w-2.5 mr-0.5" />Finalized</Badge>}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Base Salary</span><span className={myProfile.baseSalary <= 0 ? 'text-amber-500' : ''}>{salaryLabel}</span></div>
              {entry.proratedSalary !== entry.baseSalary && entry.baseSalary > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Prorated</span><span>{myProfile.currency} {entry.proratedSalary.toLocaleString()}</span></div>
              )}
              {entry.unpaidLeaveDays > 0 && <div className="flex justify-between text-destructive"><span>Unpaid leave ({entry.unpaidLeaveDays}d)</span><span>−{myProfile.currency} {entry.unpaidLeaveDeduction.toLocaleString()}</span></div>}
              {entry.absenceDays > 0 && <div className="flex justify-between text-destructive"><span>Absences ({entry.absenceDays}d)</span><span>−{myProfile.currency} {entry.absenceDeduction.toLocaleString()}</span></div>}
              {entry.outboundMeetingCommissions > 0 && <div className="flex justify-between text-green-500"><span>Meeting commissions</span><span>+{myProfile.currency} {entry.outboundMeetingCommissions.toLocaleString()}</span></div>}
              {entry.conversionCommissions > 0 && <div className="flex justify-between text-green-500"><span>Conversion commissions</span><span>+{myProfile.currency} {entry.conversionCommissions.toLocaleString()}</span></div>}
              {entry.manualAdditions > 0 && <div className="flex justify-between text-green-500"><span>Additions{entry.manualAdditionNotes ? ` (${entry.manualAdditionNotes})` : ''}</span><span>+{myProfile.currency} {entry.manualAdditions.toLocaleString()}</span></div>}
              {entry.manualDeductions > 0 && <div className="flex justify-between text-destructive"><span>Deductions{entry.manualDeductionNotes ? ` (${entry.manualDeductionNotes})` : ''}</span><span>−{myProfile.currency} {entry.manualDeductions.toLocaleString()}</span></div>}
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Final Payable</span>
                <span className={myProfile.baseSalary <= 0 ? 'text-amber-500' : ''}>{myProfile.baseSalary <= 0 ? 'Pending salary config' : `${myProfile.currency} ${entry.finalPayable.toLocaleString()}`}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Leadership payroll view
  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {(['payroll', 'rules', 'history'] as const).map(v => (
          <Button key={v} size="sm" variant={view === v ? 'default' : 'ghost'} className="h-7 text-xs capitalize" onClick={() => setView(v)}>{v === 'rules' ? 'Commission & Policies' : v === 'history' ? 'Audit History' : v}</Button>
        ))}
      </div>

      {view === 'payroll' && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-auto h-8 text-xs" />
              {locked && <Badge className="text-[9px] bg-green-500/15 text-green-500 border-green-500/30"><Lock className="h-2.5 w-2.5 mr-0.5" />Locked</Badge>}
            </div>
            {/* Lock Period removed — payroll auto-finalizes on month close. */}
          </div>
          <div className="space-y-2">
            {payrollRows.map(({ emp, entry }) => {
              const salaryLabel = getSalaryDisplay(emp.baseSalary, emp.currency);
              const isSalaryMissing = emp.baseSalary <= 0;
              return (
                <Card key={emp.id} className={cn(entry.locked && 'opacity-75', isSalaryMissing && 'border-amber-500/20')}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">{emp.fullName.charAt(0)}</div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="text-sm font-medium">{emp.fullName}</span><Badge variant="outline" className="text-[9px] capitalize">{emp.role}</Badge></div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                            <span className={cn(isSalaryMissing ? 'text-amber-500 font-medium' : '')}>Base: {salaryLabel}</span>
                            {entry.unpaidLeaveDays > 0 && <span className="text-destructive">{entry.unpaidLeaveDays}d unpaid</span>}
                            {entry.absenceDays > 0 && <span className="text-destructive">{entry.absenceDays}d absent</span>}
                            {entry.outboundMeetingCommissions > 0 && <span className="text-green-500">+{emp.currency} {entry.outboundMeetingCommissions.toLocaleString()}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn("text-lg font-bold", isSalaryMissing && 'text-amber-500')}>{isSalaryMissing ? '—' : `${emp.currency} ${entry.finalPayable.toLocaleString()}`}</p>
                        <p className="text-[9px] text-muted-foreground">{isSalaryMissing ? 'Salary not set' : 'Final Payable'}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {/* Set salary button */}
                        <Button size="sm" variant="ghost" className={cn("h-7 text-xs", isSalaryMissing && 'text-amber-500')} onClick={() => { setSalaryEditEmpId(emp.id); setNewSalary(emp.baseSalary); setSalaryEditOpen(true); }}>
                          <DollarSign className="h-3 w-3 mr-0.5" />{isSalaryMissing ? 'Set' : 'Edit'}
                        </Button>
                        {!locked && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            setAdjustEmpId(emp.id); setManualAdd(entry.manualAdditions || 0); setManualDeduct(entry.manualDeductions || 0);
                            setManualAddNotes(entry.manualAdditionNotes || ''); setManualDeductNotes(entry.manualDeductionNotes || '');
                            setAdjustOpen(true);
                          }}><Edit3 className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {/* Salary edit dialog */}
          <Dialog open={salaryEditOpen} onOpenChange={setSalaryEditOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Set Base Salary</DialogTitle><DialogDescription>{empStore.getEmployee(salaryEditEmpId)?.fullName}</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Current</Label><p className="text-sm text-muted-foreground">{getSalaryDisplay(empStore.getEmployee(salaryEditEmpId)?.baseSalary || 0, empStore.getEmployee(salaryEditEmpId)?.currency || 'PKR')}</p></div>
                <div><Label className="text-xs">New Base Salary</Label><Input type="number" value={newSalary} onChange={e => setNewSalary(Number(e.target.value))} className="text-sm" /></div>
                <p className="text-[10px] text-muted-foreground">Effective from today. Previous salary will be recorded in audit history.</p>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setSalaryEditOpen(false)}>Cancel</Button><Button onClick={handleSalaryChange}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          {/* Adjust payroll dialog */}
          <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Adjust Payroll</DialogTitle><DialogDescription>{empStore.getEmployee(adjustEmpId)?.fullName} — {period}</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Manual Addition</Label><Input type="number" value={manualAdd} onChange={e => setManualAdd(Number(e.target.value))} className="text-sm" /></div>
                <div><Label className="text-xs">Addition Notes</Label><Input value={manualAddNotes} onChange={e => setManualAddNotes(e.target.value)} className="text-sm" placeholder="Bonus, allowance..." /></div>
                <div><Label className="text-xs">Manual Deduction</Label><Input type="number" value={manualDeduct} onChange={e => setManualDeduct(Number(e.target.value))} className="text-sm" /></div>
                <div><Label className="text-xs">Deduction Notes</Label><Input value={manualDeductNotes} onChange={e => setManualDeductNotes(e.target.value)} className="text-sm" placeholder="Penalty, advance..." /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button><Button onClick={() => {
                const row = payrollRows.find(r => r.emp.id === adjustEmpId);
                if (!row) return;
                const e = empStore.payrollEntries.find(p => p.employeeId === adjustEmpId && p.period === period) || row.entry;
                const updated = { ...e, manualAdditions: manualAdd, manualDeductions: manualDeduct, manualAdditionNotes: manualAddNotes || undefined, manualDeductionNotes: manualDeductNotes || undefined, finalPayable: Math.max(0, e.proratedSalary - e.unpaidLeaveDeduction - e.absenceDeduction - e.halfDayDeductions - e.lateDeductions + e.outboundMeetingCommissions + e.conversionCommissions + manualAdd - manualDeduct) };
                empStore.savePayrollEntry(updated);
                empStore.logAudit({ actor: currentUser, action: 'adjusted_payroll', target: 'payroll', targetId: `${adjustEmpId}-${period}`, notes: `+${manualAdd} -${manualDeduct}` });
                toast.success('Adjusted');
                setAdjustOpen(false);
              }}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {view === 'rules' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Leave Policies</h3>
            <div className="space-y-1.5">
              {empStore.leavePolicies.map(pol => (
                <Card key={pol.id}><CardContent className="py-2.5 px-4">
                  <p className="text-sm font-medium">{pol.name}</p>
                  <p className="text-[10px] text-muted-foreground">{pol.annualPaidDays} paid days/yr · Sick: {pol.sickLeavePerYear}/yr · Emergency: {pol.emergencyLeavePerYear}/yr{pol.probationMode !== 'no_paid_leave' ? ` · ${PROBATION_MODE_LABELS[pol.probationMode]}` : ''}</p>
                  {pol.probationMode === 'no_paid_leave' && <p className="text-[9px] text-amber-500">First 3 months: no paid leave, max 2 unpaid/month with prior approval</p>}
                </CardContent></Card>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Commission Rules</h3>
            <div className="space-y-1.5">
              {empStore.commissionRules.map(rule => (
                <Card key={rule.id} className={cn(!rule.active && 'opacity-60')}>
                  <CardContent className="py-2.5 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2"><span className="text-sm font-medium">{rule.name}</span><Badge className={cn('text-[9px]', rule.active ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground')}>{rule.active ? 'Active' : 'Off'}</Badge></div>
                        <p className="text-[10px] text-muted-foreground">{rule.currency} {rule.amount.toLocaleString()} per {rule.triggerEvent.replace(/_/g, ' ')}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingRule({ ...rule }); setEditRuleOpen(true); }}><Edit3 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          {editingRule && (
            <Dialog open={editRuleOpen} onOpenChange={setEditRuleOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Edit Commission Rule</DialogTitle><DialogDescription>{editingRule.name}</DialogDescription></DialogHeader>
                <div className="space-y-3">
                  <div><Label className="text-xs">Name</Label><Input value={editingRule.name} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })} className="text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Amount</Label><Input type="number" value={editingRule.amount} onChange={e => setEditingRule({ ...editingRule, amount: Number(e.target.value) })} className="text-sm" /></div>
                    <div><Label className="text-xs">Currency</Label><Input value={editingRule.currency} onChange={e => setEditingRule({ ...editingRule, currency: e.target.value })} className="text-sm" /></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between"><Label className="text-xs">Active</Label><Switch checked={editingRule.active} onCheckedChange={v => setEditingRule({ ...editingRule, active: v })} /></div>
                    <div className="flex items-center justify-between"><Label className="text-xs">Exclude no-shows</Label><Switch checked={editingRule.excludeNoShows} onCheckedChange={v => setEditingRule({ ...editingRule, excludeNoShows: v })} /></div>
                  </div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setEditRuleOpen(false)}>Cancel</Button><Button onClick={() => { empStore.saveCommissionRule(editingRule!); toast.success('Updated'); setEditRuleOpen(false); }}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}

      {view === 'history' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">All salary changes, payroll adjustments, and policy updates</p>
          {empStore.auditLog.length === 0 ? (
            <Card className="py-8 text-center"><History className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-xs text-muted-foreground">No audit entries yet</p></Card>
          ) : (
            <div className="space-y-1">
              {empStore.auditLog.slice(0, 50).map(entry => {
                const member = TEAM.find(m => m.id === entry.actor);
                const targetMember = TEAM.find(m => m.id === entry.targetId);
                return (
                  <Card key={entry.id}><CardContent className="py-2 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-medium">{member?.name || entry.actor}</span>
                          <span className="text-muted-foreground">{entry.action.replace(/_/g, ' ')}</span>
                          {targetMember && <span className="text-muted-foreground">→ {targetMember.name}</span>}
                        </div>
                        {entry.oldValue && entry.newValue && (
                          <p className="text-[9px] text-muted-foreground mt-0.5 ml-5">{entry.oldValue} → {entry.newValue}</p>
                        )}
                        {entry.notes && <p className="text-[9px] text-muted-foreground mt-0.5 ml-5 italic">{entry.notes}</p>}
                      </div>
                      <span className="text-[9px] text-muted-foreground shrink-0">{formatTimestamp(entry.timestamp)}</span>
                    </div>
                  </CardContent></Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PEOPLE TAB
// ═══════════════════════════════════════════════════════════

function PeopleTab({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const { currentUser, isLeadership } = useUser();
  const empStore = useEmployees();
  const [editOpen, setEditOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<EmployeeProfile | null>(null);

  if (!isLeadership) return (
    <div className="py-8 text-center"><Users className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">Employee profiles are managed by leadership.</p></div>
  );

  const handleSave = () => {
    if (!editingEmp) return;
    const old = empStore.getEmployee(editingEmp.id);
    empStore.saveEmployee(editingEmp);
    if (old) {
      const auditFields: { key: keyof EmployeeProfile; action: string }[] = [
        { key: 'baseSalary', action: 'changed_salary' }, { key: 'employmentStatus', action: 'changed_status' },
        { key: 'leavePolicyId', action: 'changed_leave_policy' }, { key: 'joiningDate', action: 'changed_joining_date' },
        { key: 'shiftStart', action: 'changed_shift' }, { key: 'timezone', action: 'changed_timezone' },
      ];
      for (const { key, action } of auditFields) {
        if (String(old[key] ?? '') !== String(editingEmp[key] ?? '')) {
          empStore.logAudit({ actor: currentUser, action, target: 'employee', targetId: editingEmp.id, oldValue: String(old[key] ?? ''), newValue: String(editingEmp[key] ?? '') });
        }
      }
    }
    toast.success('Employee updated');
    setEditOpen(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Employee profiles, permissions, and policy assignments</p>
      <div className="space-y-1.5">
        {empStore.employees.filter(e => e.active).map(emp => {
          const policy = empStore.getLeavePolicy(emp.leavePolicyId);
          const salaryLabel = getSalaryDisplay(emp.baseSalary, emp.currency);
          return (
            <Card key={emp.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => onOpenProfile(emp.id)}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">{emp.fullName.charAt(0)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{emp.fullName}</span>
                      <Badge variant="outline" className="text-[9px] capitalize">{emp.role}</Badge>
                      {emp.region && <Badge variant="outline" className="text-[9px]"><MapPin className="h-2 w-2 mr-0.5" />{emp.region}</Badge>}
                      <Badge className={cn('text-[9px] border', EMPLOYMENT_STATUS_COLORS[emp.employmentStatus])}>{EMPLOYMENT_STATUS_LABELS[emp.employmentStatus]}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      <span>Joined {emp.joiningDate}</span>
                      <span className={emp.baseSalary <= 0 ? 'text-amber-500' : ''}>{salaryLabel}</span>
                      <span>Leave: {getLeaveBalanceLabel(emp.leaveRemaining, emp.annualLeaveAllowance, emp.employmentStatus === 'probationary', policy?.probationMode)}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={(e) => { e.stopPropagation(); setEditingEmp({ ...emp }); setEditOpen(true); }}><Edit3 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editingEmp && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Employee</DialogTitle><DialogDescription>{editingEmp.fullName}</DialogDescription></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Full Name</Label><Input value={editingEmp.fullName} onChange={e => setEditingEmp({ ...editingEmp, fullName: e.target.value })} className="text-sm" /></div>
                <div><Label className="text-xs">Title</Label><Input value={editingEmp.title || ''} onChange={e => setEditingEmp({ ...editingEmp, title: e.target.value })} className="text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Employment Status</Label>
                  <Select value={editingEmp.employmentStatus} onValueChange={v => setEditingEmp({ ...editingEmp, employmentStatus: v as EmploymentStatus })}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(EMPLOYMENT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Leave Policy</Label>
                  <Select value={editingEmp.leavePolicyId} onValueChange={v => setEditingEmp({ ...editingEmp, leavePolicyId: v })}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{empStore.leavePolicies.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Joining Date</Label><Input type="date" value={editingEmp.joiningDate} onChange={e => setEditingEmp({ ...editingEmp, joiningDate: e.target.value })} className="text-sm" /></div>
                <div><Label className="text-xs">Region</Label><Input value={editingEmp.region || ''} onChange={e => setEditingEmp({ ...editingEmp, region: e.target.value })} className="text-sm" /></div>
              </div>
              <div className="rounded-lg border p-3 space-y-3">
                <Label className="text-xs font-medium">Shift & Timezone</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Timezone</Label><Input value={editingEmp.timezone || ''} onChange={e => setEditingEmp({ ...editingEmp, timezone: e.target.value })} className="text-sm" placeholder="e.g. Asia/Karachi" /></div>
                  <div><Label className="text-xs">Grace (min)</Label><Input type="number" value={editingEmp.graceMinutes ?? 15} onChange={e => setEditingEmp({ ...editingEmp, graceMinutes: Number(e.target.value) })} className="text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Shift Start</Label><Input type="time" value={editingEmp.shiftStart || ''} onChange={e => setEditingEmp({ ...editingEmp, shiftStart: e.target.value })} className="text-sm" /></div>
                  <div><Label className="text-xs">Shift End</Label><Input type="time" value={editingEmp.shiftEnd || ''} onChange={e => setEditingEmp({ ...editingEmp, shiftEnd: e.target.value })} className="text-sm" /></div>
                </div>
                <div className="flex items-center justify-between"><Label className="text-xs">Attendance Exempt</Label><Switch checked={editingEmp.attendanceExempt || false} onCheckedChange={v => setEditingEmp({ ...editingEmp, attendanceExempt: v })} /></div>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs font-medium">Permissions</Label>
                <div className="flex items-center justify-between"><Label className="text-xs">Inbound</Label><Switch checked={editingEmp.inboundPermission} onCheckedChange={v => setEditingEmp({ ...editingEmp, inboundPermission: v })} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">Outbound</Label><Switch checked={editingEmp.outboundPermission} onCheckedChange={v => setEditingEmp({ ...editingEmp, outboundPermission: v })} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">Can import</Label><Switch checked={editingEmp.canImportLeads || false} onCheckedChange={v => setEditingEmp({ ...editingEmp, canImportLeads: v })} /></div>
                {/* Directives feature removed. */}
                <div className="flex items-center justify-between"><Label className="text-xs">Can approve</Label><Switch checked={editingEmp.canApprove || false} onCheckedChange={v => setEditingEmp({ ...editingEmp, canApprove: v })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs">Base Salary</Label><Input type="number" value={editingEmp.baseSalary} onChange={e => setEditingEmp({ ...editingEmp, baseSalary: Number(e.target.value) })} className="text-sm" /></div>
                <div><Label className="text-xs">Currency</Label><Input value={editingEmp.currency} onChange={e => setEditingEmp({ ...editingEmp, currency: e.target.value })} className="text-sm" /></div>
                <div><Label className="text-xs">Leave Remaining</Label><Input type="number" value={editingEmp.leaveRemaining} onChange={e => setEditingEmp({ ...editingEmp, leaveRemaining: Number(e.target.value) })} className="text-sm" /></div>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={handleSave}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

export default function PeoplePerformancePage() {
  const { isLeadership } = useUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const openProfile = (id: string) => { setProfileId(id); setProfileOpen(true); };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{isLeadership ? 'Team' : 'My Performance'}</h1>
        <p className="text-sm text-muted-foreground">{isLeadership ? 'Attendance, KPI, and leave' : 'Your attendance, KPI, and leave'}</p>
      </div>
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-8 bg-transparent border-b border-border/30 rounded-none p-0 w-full justify-start gap-0">
          <TabsTrigger value="overview" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Overview</TabsTrigger>
          <TabsTrigger value="attendance" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Attendance</TabsTrigger>
          <TabsTrigger value="kpi" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">KPI</TabsTrigger>
          <TabsTrigger value="leave" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Leave</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab onOpenProfile={openProfile} /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="kpi"><KPITab /></TabsContent>
        <TabsContent value="leave"><LeaveTab /></TabsContent>
      </Tabs>
      <EmployeeProfileDrawer employeeId={profileId} open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}
