/**
 * STYLIQUE CRM — Employee Profile Drawer
 * Full editable employee profile for CEO/COO. 10 sections:
 * Summary · Role & Hierarchy · Attendance history · KPI history · Leave history
 * · Compensation · Policy · Permissions · Notes · Audit
 */
import { useMemo, useState } from 'react';
import {
  useEmployees, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_COLORS,
  type EmployeeProfile, type EmploymentStatus,
} from '@/lib/employee-store';
import { useAttendance, ATTENDANCE_LABELS } from '@/lib/attendance-store';
import { useLeave, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, LEAVE_STATUS_COLORS } from '@/lib/leave-store';
import { useKPIDefinitions, MANDATORY_KPI_CODE, type KPIDefinition } from '@/lib/kpi-definitions-store';
import { useUser } from '@/lib/user-context';
import { TEAM } from '@/types/roles';
import { getWeeklySnapshot, todayKey } from '@/engine/kpi-engine';
import { computeWeeklyBrandKPI, getLeadershipPacingColor, getLeadershipPacingLabel } from '@/engine/weekly-kpi-engine';
import { getSalaryDisplay, getLeaveBalanceLabel, formatTimestamp } from '@/engine/day-state-engine';
import { computePayrollBreakdown, currentPeriod, formatMoney } from '@/engine/sync-engine';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  MapPin, Clock, Calendar, DollarSign, Target, CalendarOff, UserCog,
  Shield, FileText, History, Save, Network,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeProfileDrawer({ employeeId, open, onOpenChange }: Props) {
  const empStore = useEmployees();
  const attendance = useAttendance();
  const leave = useLeave();
  const kpiDefs = useKPIDefinitions();
  const { currentUser, isLeadership } = useUser();

  const emp = employeeId ? empStore.getEmployee(employeeId) : undefined;
  const [draft, setDraft] = useState<EmployeeProfile | null>(null);

  // Reset draft when employee changes or drawer opens
  useMemo(() => {
    if (emp && open) setDraft({ ...emp });
    if (!open) setDraft(null);
  }, [emp?.id, open]);

  // Attendance history (last 14 days) — unconditional
  const attendanceHistory = useMemo(() => {
    if (!emp) return [];
    const out: { date: string; status: string; checkIn?: string; checkOut?: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const e = attendance.getForDate(emp.id, dateKey);
      const lv = leave.getForDate(emp.id, dateKey);
      out.push({
        date: dateKey,
        status: lv?.status === 'approved' ? `On Leave (${LEAVE_TYPE_LABELS[lv.type]})` : (e ? ATTENDANCE_LABELS[e.status] : '—'),
        checkIn: e?.checkInTime,
        checkOut: e?.checkOutTime,
      });
    }
    return out;
  }, [emp, attendance.entries, leave.requests]);

  if (!emp || !draft) return null;

  const member = TEAM.find(m => m.id === emp.id);
  const policy = empStore.getLeavePolicy(emp.leavePolicyId);
  const canEdit = isLeadership;

  // Derived data
  const weekSnap = getWeeklySnapshot(emp.id);
  const weekLeaveDates = leave.requests
    .filter(r => r.userId === emp.id && r.status === 'approved')
    .map(r => r.startDate);
  const wb = computeWeeklyBrandKPI(emp.id, weekLeaveDates);

  const leaveHistory = leave.getForUser(emp.id).slice(0, 20);
  const auditHistory = empStore.auditLog.filter(a => a.targetId === emp.id).slice(0, 30);
  const commissionRules = empStore.commissionRules.filter(r => emp.commissionRuleIds.includes(r.id));

  // Live payroll breakdown for the current month
  const period = currentPeriod();
  const breakdown = computePayrollBreakdown({
    emp,
    period,
    policy,
    leaveRequests: leave.requests,
    attendanceEntries: attendance.entries,
    commissionRules: empStore.commissionRules,
  });

  function handleSave() {
    if (!draft || !emp) return;
    const changes: string[] = [];
    if (draft.role !== emp.role) changes.push(`role ${emp.role}→${draft.role}`);
    if (draft.employmentStatus !== emp.employmentStatus) changes.push(`status ${emp.employmentStatus}→${draft.employmentStatus}`);
    if (draft.baseSalary !== emp.baseSalary) changes.push(`salary ${emp.baseSalary}→${draft.baseSalary}`);
    if (draft.manager !== emp.manager) changes.push(`manager ${emp.manager}→${draft.manager}`);

    empStore.saveEmployee({ ...draft, probationClassified: true });
    if (changes.length > 0) {
      empStore.logAudit({
        actor: currentUser, action: 'profile_updated', target: 'employee',
        targetId: emp.id, notes: changes.join(', '),
      });
    }
    toast.success(`${draft.fullName} updated`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
              {emp.fullName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg leading-tight">{emp.fullName}</SheetTitle>
              <SheetDescription className="mt-1">
                {emp.title || emp.role}
                {emp.region && ` · ${emp.region}`}
              </SheetDescription>
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <Badge variant="outline" className="text-[10px] capitalize">{emp.role}</Badge>
                <Badge className={cn('text-[10px] border', EMPLOYMENT_STATUS_COLORS[emp.employmentStatus])}>
                  {EMPLOYMENT_STATUS_LABELS[emp.employmentStatus]}
                </Badge>
                {emp.attendanceExempt && <Badge variant="outline" className="text-[10px]">Attendance Exempt</Badge>}
                {!emp.probationClassified && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-500 border-amber-500/30 border">Needs Classification</Badge>
                )}
              </div>
            </div>
            {canEdit && (
              <Button size="sm" className="h-8 text-xs" onClick={handleSave}>
                <Save className="h-3 w-3 mr-1" /> Save
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* Tabs are role-aware: KPI tab only shown for SDR; non-SDR roles never see SDR KPI surface. */}
        {(() => {
          const showKpiTab = emp.role === 'sdr';
          const tabIds = showKpiTab
            ? ['summary', 'role', 'attendance', 'kpi', 'leave', 'compensation', 'policy', 'notes', 'audit']
            : ['summary', 'role', 'attendance', 'leave', 'compensation', 'policy', 'notes', 'audit'];
          return (
            <Tabs defaultValue="summary" className="px-6 pt-3">
              <TabsList className="h-8 bg-transparent border-b border-border/30 rounded-none p-0 w-full justify-start gap-0 overflow-x-auto">
                {tabIds.map(t => (
                  <TabsTrigger
                    key={t}
                    value={t}
                    className="text-[11px] capitalize h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2.5"
                  >
                    {t}
                  </TabsTrigger>
                ))}
              </TabsList>

          {/* ── Summary ── */}
          <TabsContent value="summary" className="space-y-3 py-4">
            <Card>
              <CardContent className="p-4 grid grid-cols-2 gap-3 text-xs">
                <Field label="Role" value={emp.title || emp.role} />
                <Field label="Manager" value={TEAM.find(m => m.id === emp.manager)?.name || '—'} />
                <Field label="Region / Territory" value={emp.region || '—'} />
                <Field label="Time zone" value={emp.timezone || '—'} />
                <Field label="Shift" value={emp.shiftStart && emp.shiftEnd ? `${emp.shiftStart} – ${emp.shiftEnd}` : '—'} />
                <Field label="Joined" value={emp.joiningDate} />
                {emp.confirmationDate && <Field label="Confirmed" value={emp.confirmationDate} />}
                {emp.probationEndDate && <Field label="Probation ends" value={emp.probationEndDate} />}
                <Field label="Base salary" value={getSalaryDisplay(emp.baseSalary, emp.currency)} />
                <Field label="Leave balance" value={getLeaveBalanceLabel(emp.leaveRemaining, emp.annualLeaveAllowance, emp.employmentStatus === 'probationary', policy?.probationMode)} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">This Week</p>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xl font-bold">{wb.brandsCompleted}<span className="text-xs text-muted-foreground font-normal">/{wb.weeklyTarget} brands</span></p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{wb.guidanceMessage}</p>
                  </div>
                  <Badge className={cn('text-[10px]', getLeadershipPacingColor(wb.pacingStatus))}>{getLeadershipPacingLabel(wb.pacingStatus)}</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Applicable Systems</p>
                <ApplicabilityRow label="Attendance tracking" on={!emp.attendanceExempt && (emp.attendanceApplicable !== false)} />
                <ApplicabilityRow label="KPI tracking" on={(emp.kpiApplicable ?? (emp.role === 'sdr')) && (emp.kpiAssignments?.length ?? 0) > 0} />
                <ApplicabilityRow label="Payroll" on={emp.payrollApplicable !== false && emp.baseSalary > 0} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Role & Hierarchy ── */}
          <TabsContent value="role" className="space-y-3 py-4">
            <EditCard title="Role & Hierarchy" icon={Network}>
              <EditField label="Role">
                <Select value={draft.role} onValueChange={v => setDraft({ ...draft, role: v })} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['ceo', 'coo', 'sdr', 'onboarding'].map(r => <SelectItem key={r} value={r}>{r.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </EditField>
              <EditField label="Manager">
                <Select value={draft.manager || ''} onValueChange={v => setDraft({ ...draft, manager: v })} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {empStore.employees.filter(e => e.id !== emp.id).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.fullName} ({m.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditField>
              <EditField label="Region / Territory">
                <Input value={draft.region || ''} onChange={e => setDraft({ ...draft, region: e.target.value })} className="h-8 text-xs" disabled={!canEdit} />
              </EditField>
              <EditField label="Time zone (IANA)">
                <Input value={draft.timezone || ''} onChange={e => setDraft({ ...draft, timezone: e.target.value })} placeholder="Asia/Karachi" className="h-8 text-xs" disabled={!canEdit} />
              </EditField>
              <div className="grid grid-cols-3 gap-2">
                <EditField label="Shift start"><Input value={draft.shiftStart || ''} onChange={e => setDraft({ ...draft, shiftStart: e.target.value })} placeholder="09:00" className="h-8 text-xs" disabled={!canEdit} /></EditField>
                <EditField label="Shift end"><Input value={draft.shiftEnd || ''} onChange={e => setDraft({ ...draft, shiftEnd: e.target.value })} placeholder="17:00" className="h-8 text-xs" disabled={!canEdit} /></EditField>
                <EditField label="Grace (min)"><Input type="number" value={draft.graceMinutes ?? 15} onChange={e => setDraft({ ...draft, graceMinutes: Number(e.target.value) })} className="h-8 text-xs" disabled={!canEdit} /></EditField>
              </div>
            </EditCard>

            <EditCard title="Employment Status" icon={UserCog}>
              <EditField label="Status">
                <Select value={draft.employmentStatus} onValueChange={v => setDraft({ ...draft, employmentStatus: v as EmploymentStatus })} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['probationary', 'confirmed', 'inactive', 'contractor'] as EmploymentStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{EMPLOYMENT_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditField>
              <div className="grid grid-cols-2 gap-2">
                <EditField label="Probation start"><Input type="date" value={draft.probationStartDate || ''} onChange={e => setDraft({ ...draft, probationStartDate: e.target.value })} className="h-8 text-xs" disabled={!canEdit} /></EditField>
                <EditField label="Probation end"><Input type="date" value={draft.probationEndDate || ''} onChange={e => setDraft({ ...draft, probationEndDate: e.target.value })} className="h-8 text-xs" disabled={!canEdit} /></EditField>
              </div>
              <EditField label="Joining date"><Input type="date" value={draft.joiningDate} onChange={e => setDraft({ ...draft, joiningDate: e.target.value })} className="h-8 text-xs" disabled={!canEdit} /></EditField>
              {draft.employmentStatus === 'confirmed' && (
                <EditField label="Confirmation date"><Input type="date" value={draft.confirmationDate || ''} onChange={e => setDraft({ ...draft, confirmationDate: e.target.value })} className="h-8 text-xs" disabled={!canEdit} /></EditField>
              )}
            </EditCard>
          </TabsContent>

          {/* ── Attendance history ── */}
          <TabsContent value="attendance" className="py-4">
            <Card><CardContent className="p-0">
              <div className="divide-y divide-border/30">
                {attendanceHistory.map(h => (
                  <div key={h.date} className="flex items-center justify-between px-4 py-2 text-xs">
                    <span className="text-muted-foreground tabular-nums">{h.date}</span>
                    <span className="flex-1 ml-3">{h.status}</span>
                    <span className="text-muted-foreground">
                      {h.checkIn && `${h.checkIn}`}
                      {h.checkOut && ` → ${h.checkOut}`}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          </TabsContent>

          {/* ── KPI history ── */}
          <TabsContent value="kpi" className="space-y-3 py-4">
            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Current Week</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Brands completed" value={`${wb.brandsCompleted} / ${wb.weeklyTarget}`} />
                <Field label="Pacing" value={getLeadershipPacingLabel(wb.pacingStatus)} />
                <Field label="Required pace" value={`${Math.ceil(wb.requiredPacePerDay)} brands/day`} />
                <Field label="Days remaining" value={String(wb.daysRemaining)} />
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Action Counts (week)</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(weekSnap.actions).filter(([, v]) => v > 0).map(([k, v]) => (
                  <Field key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
                ))}
                {Object.values(weekSnap.actions).every(v => v === 0) && <p className="text-muted-foreground col-span-2">No actions recorded this week.</p>}
              </div>
            </CardContent></Card>

            {/* Per-employee KPI on/off overrides */}
            <EditCard title="KPI Assignments" icon={Target}>
              <p className="text-[10px] text-muted-foreground mb-1">
                Toggle which KPIs apply to this employee. Mandatory KPIs cannot be disabled.
              </p>
              {kpiDefs.definitions
                .filter(k => k.assignedRoles.includes(draft.role) || draft.kpiAssignments?.includes(k.id))
                .map((k: KPIDefinition) => {
                  const isAssigned = draft.kpiAssignments?.includes(k.id) ?? false;
                  const isMandatory = k.code === MANDATORY_KPI_CODE || k.mandatory;
                  return (
                    <div key={k.id} className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium truncate">{k.name}</p>
                          {isMandatory && <Badge variant="outline" className="text-[9px] h-4">Mandatory</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Target {k.targetValue} · {k.period}
                        </p>
                      </div>
                      <Switch
                        checked={isMandatory ? true : isAssigned}
                        disabled={!canEdit || isMandatory}
                        onCheckedChange={v => {
                          const current = draft.kpiAssignments || [];
                          const next = v
                            ? Array.from(new Set([...current, k.id]))
                            : current.filter(id => id !== k.id);
                          setDraft({ ...draft, kpiAssignments: next, kpiApplicable: next.length > 0 ? true : draft.kpiApplicable });
                        }}
                      />
                    </div>
                  );
                })}
            </EditCard>

            {canEdit && (
              <EditCard title="Per-employee target override (Brands)" icon={Target}>
                <p className="text-[10px] text-muted-foreground mb-1">
                  Override the weekly brand target for this person only. Leave empty to use the role default.
                </p>
                {(() => {
                  const brandsKpi = kpiDefs.definitions.find(d => d.code === MANDATORY_KPI_CODE);
                  if (!brandsKpi) return null;
                  const override = brandsKpi.userTargetOverrides?.[emp.id];
                  return (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder={String(brandsKpi.targetValue)}
                        defaultValue={override ?? ''}
                        onBlur={e => {
                          const raw = e.target.value.trim();
                          const next = { ...brandsKpi };
                          next.userTargetOverrides = { ...(brandsKpi.userTargetOverrides || {}) };
                          if (raw === '') {
                            delete next.userTargetOverrides[emp.id];
                          } else {
                            next.userTargetOverrides[emp.id] = Number(raw);
                          }
                          kpiDefs.save(next);
                          empStore.logAudit({
                            actor: currentUser, action: 'kpi_target_override', target: 'employee',
                            targetId: emp.id, notes: raw === '' ? 'cleared brand override' : `brand target → ${raw}`,
                          });
                          toast.success('Override saved');
                        }}
                        className="h-8 text-xs w-32"
                      />
                      <span className="text-[10px] text-muted-foreground">brands/week</span>
                    </div>
                  );
                })()}
              </EditCard>
            )}
          </TabsContent>

          {/* ── Leave history ── */}
          <TabsContent value="leave" className="space-y-3 py-4">
            <Card><CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
              <div><p className="text-lg font-bold">{emp.annualLeaveAllowance}</p><p className="text-[10px] text-muted-foreground">Annual allowance</p></div>
              <div><p className="text-lg font-bold">{emp.leaveUsed}</p><p className="text-[10px] text-muted-foreground">Used</p></div>
              <div><p className="text-lg font-bold text-primary">{emp.leaveRemaining}</p><p className="text-[10px] text-muted-foreground">Remaining</p></div>
            </CardContent></Card>

            {breakdown.probation.isProbationary && breakdown.probation.withinProbationWindow && (
              <Card className={cn('border', breakdown.probation.exceedsMonthlyLimit ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5')}>
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Probation Leave Usage · {period}</p>
                  <p className="text-xs">
                    <span className="font-semibold">{breakdown.probation.monthlyUnpaidUsed}/{breakdown.probation.monthlyUnpaidLimit}</span> unpaid leaves used this month.
                    {breakdown.probation.exceedsMonthlyLimit
                      ? ' Over the cap — additional leave requires manager override.'
                      : ' During probation, all leave is unpaid; no paid leave allowance until confirmation.'}
                  </p>
                  {breakdown.probation.probationEndDate && (
                    <p className="text-[10px] text-muted-foreground mt-1">Probation ends {breakdown.probation.probationEndDate}.</p>
                  )}
                </CardContent>
              </Card>
            )}
            <Card><CardContent className="p-0">
              {leaveHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No leave history</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {leaveHistory.map(r => (
                    <div key={r.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium">{LEAVE_TYPE_LABELS[r.type]}</span>
                        <Badge className={cn('text-[9px] border', LEAVE_STATUS_COLORS[r.status])}>{LEAVE_STATUS_LABELS[r.status]}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {r.startDate}{r.endDate && r.endDate !== r.startDate ? ` → ${r.endDate}` : ''} · {r.paidOrUnpaid}
                      </p>
                      {r.reason && <p className="text-[10px] text-muted-foreground italic mt-0.5">"{r.reason}"</p>}
                      {r.policyBasis && <p className="text-[9px] text-muted-foreground/70 mt-0.5">{r.policyBasis}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          {/* ── Compensation ── */}
          <TabsContent value="compensation" className="space-y-3 py-4">
            {/* Live month payroll breakdown */}
            <Card>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <DollarSign className="h-3 w-3" /> Live Payroll · {period}
                  </p>
                  {breakdown.notApplicable && (
                    <Badge variant="outline" className="text-[9px]">Not applicable</Badge>
                  )}
                </div>
                {breakdown.notApplicable ? (
                  <p className="text-xs text-muted-foreground">{breakdown.notApplicableReason}</p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      {breakdown.lines.map((line, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-start justify-between gap-3 text-xs',
                            line.kind === 'total' && 'border-t border-border/40 pt-2 mt-1 font-semibold',
                          )}
                        >
                          <div className="min-w-0">
                            <p className={cn(
                              line.kind === 'deduction' && 'text-destructive',
                              line.kind === 'commission' && 'text-green-500',
                              line.kind === 'addition' && 'text-green-500',
                            )}>{line.label}</p>
                            {line.detail && (
                              <p className="text-[10px] text-muted-foreground">{line.detail}</p>
                            )}
                          </div>
                          <span className={cn(
                            'tabular-nums shrink-0',
                            line.kind === 'deduction' && 'text-destructive',
                            line.kind === 'commission' && 'text-green-500',
                            line.kind === 'addition' && 'text-green-500',
                          )}>
                            {formatMoney(line.amount, emp.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {breakdown.derivationNotes.length > 0 && (
                      <div className="pt-2 border-t border-border/30 space-y-0.5">
                        {breakdown.derivationNotes.map((n, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">• {n}</p>
                        ))}
                      </div>
                    )}
                    <div className="pt-2 border-t border-border/30 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs font-semibold tabular-nums">{breakdown.totals.paidLeaveDays}</p>
                        <p className="text-[9px] text-muted-foreground">Paid leave</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold tabular-nums">{breakdown.totals.unpaidLeaveDays}</p>
                        <p className="text-[9px] text-muted-foreground">Unpaid leave</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold tabular-nums">{breakdown.totals.absenceDays}</p>
                        <p className="text-[9px] text-muted-foreground">Absent</p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <EditCard title="Salary" icon={DollarSign}>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <EditField label="Base salary">
                    <Input type="number" value={draft.baseSalary} onChange={e => setDraft({ ...draft, baseSalary: Number(e.target.value) })} className="h-8 text-xs" disabled={!canEdit} />
                  </EditField>
                </div>
                <EditField label="Currency">
                  <Select value={draft.currency} onValueChange={v => setDraft({ ...draft, currency: v })} disabled={!canEdit}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PKR">PKR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="AED">AED</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </EditField>
              </div>
              <EditField label="Salary effective from">
                <Input type="date" value={draft.salaryEffectiveDate || ''} onChange={e => setDraft({ ...draft, salaryEffectiveDate: e.target.value })} className="h-8 text-xs" disabled={!canEdit} />
              </EditField>
            </EditCard>

            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Active Commission Rules</p>
              {commissionRules.length === 0 ? (
                <p className="text-xs text-muted-foreground">No commissions assigned.</p>
              ) : (
                <div className="space-y-1.5">
                  {commissionRules.map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs">
                      <span>{r.name}</span>
                      <span className="font-medium tabular-nums">{r.currency} {r.amount.toLocaleString()}{r.isPercentage ? '%' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>

            {canEdit && (
              <EditCard title="Commission Profile" icon={Target}>
                <p className="text-[10px] text-muted-foreground mb-2">Toggle which rules apply to this employee.</p>
                {empStore.commissionRules.map(r => {
                  const checked = draft.commissionRuleIds.includes(r.id);
                  return (
                    <div key={r.id} className="flex items-center justify-between py-1.5">
                      <div>
                        <p className="text-xs">{r.name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.currency} {r.amount.toLocaleString()} · {r.triggerEvent}</p>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={v => {
                          const next = v
                            ? [...draft.commissionRuleIds, r.id]
                            : draft.commissionRuleIds.filter(id => id !== r.id);
                          setDraft({ ...draft, commissionRuleIds: next });
                        }}
                      />
                    </div>
                  );
                })}
              </EditCard>
            )}
          </TabsContent>

          {/* ── Policy assignment ── */}
          <TabsContent value="policy" className="space-y-3 py-4">
            <EditCard title="Leave Policy" icon={CalendarOff}>
              <Select value={draft.leavePolicyId} onValueChange={v => setDraft({ ...draft, leavePolicyId: v })} disabled={!canEdit}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {empStore.leavePolicies.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · {p.annualPaidDays}d/yr</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {policy && (
                <p className="text-[10px] text-muted-foreground">
                  {policy.annualPaidDays} paid days/year · sick {policy.sickLeavePerYear} · emergency {policy.emergencyLeavePerYear}
                </p>
              )}
            </EditCard>

            <EditCard title="Applicable Systems" icon={Shield}>
              <ToggleRow
                label="Attendance applicable"
                hint="Track shift, late, early leave"
                checked={draft.attendanceApplicable !== false && !draft.attendanceExempt}
                disabled={!canEdit}
                onChange={v => setDraft({ ...draft, attendanceApplicable: v, attendanceExempt: !v })}
              />
              <ToggleRow
                label="KPI applicable"
                hint="Weekly brand KPI and other metrics"
                checked={draft.kpiApplicable ?? (draft.role === 'sdr')}
                disabled={!canEdit}
                onChange={v => {
                  const next = { ...draft, kpiApplicable: v };
                  if (!v) next.kpiAssignments = [];
                  else if ((draft.kpiAssignments?.length ?? 0) === 0) next.kpiAssignments = ['kpi-brands-day'];
                  setDraft(next);
                }}
              />
              <ToggleRow
                label="Payroll applicable"
                hint="Generate monthly payroll entries"
                checked={draft.payrollApplicable !== false}
                disabled={!canEdit}
                onChange={v => setDraft({ ...draft, payrollApplicable: v })}
              />
            </EditCard>
          </TabsContent>

          {/* ── Notes ── */}
          <TabsContent value="notes" className="space-y-3 py-4">
            <EditCard title="Manager Notes" icon={FileText}>
              <Textarea
                value={draft.managerNotes || ''}
                onChange={e => setDraft({ ...draft, managerNotes: e.target.value })}
                placeholder="Private notes visible to leadership only…"
                rows={5}
                className="text-xs"
                disabled={!canEdit}
              />
            </EditCard>
            <EditCard title="Contract Notes" icon={FileText}>
              <Textarea
                value={draft.contractNotes || ''}
                onChange={e => setDraft({ ...draft, contractNotes: e.target.value })}
                rows={3}
                className="text-xs"
                disabled={!canEdit}
              />
            </EditCard>
          </TabsContent>

          {/* ── Audit ── */}
          <TabsContent value="audit" className="py-4">
            <Card><CardContent className="p-0">
              {auditHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No audit history</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {auditHistory.map(a => (
                    <div key={a.id} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] text-muted-foreground">{formatTimestamp(a.timestamp)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">by {a.actor}{a.notes ? ` · ${a.notes}` : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          </TabsContent>
            </Tabs>
          );
        })()}

        <div className="h-6" />
      </SheetContent>
    </Sheet>
  );
}

// ─── Small helpers ──────────────────────────────────────

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xs font-medium mt-0.5 capitalize">{value}</p>
    </div>
  );
}

function EditCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" /> {title}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <p className="text-xs">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function ApplicabilityRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <Badge className={cn('text-[9px] border', on ? 'bg-green-500/15 text-green-500 border-green-500/30' : 'bg-muted text-muted-foreground border-border')}>
        {on ? 'On' : 'Off'}
      </Badge>
    </div>
  );
}
