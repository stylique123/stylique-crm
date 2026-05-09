/**
 * STYLIQUE CRM — Leave Request Store
 * Full leave/permission flow with types, approval, probation enforcement, and attendance sync.
 */
import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { safeId, safeRead, safeWrite } from '@/lib/safe-storage';

export type LeaveType =
  | 'full_day' | 'half_day' | 'late_arrival' | 'early_leave'
  | 'two_hour_permission' | 'custom_short' | 'sick_leave' | 'emergency_leave';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  full_day: 'Full Day Leave',
  half_day: 'Half Day Leave',
  late_arrival: 'Late Arrival',
  early_leave: 'Early Leave',
  two_hour_permission: '2-Hour Permission',
  custom_short: 'Custom Short Leave',
  sick_leave: 'Sick Leave',
  emergency_leave: 'Emergency Leave',
};

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'partially_approved' | 'cancelled';

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  partially_approved: 'Partially Approved',
  cancelled: 'Cancelled',
};

export const LEAVE_STATUS_COLORS: Record<LeaveStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  approved: 'bg-green-500/15 text-green-500 border-green-500/30',
  rejected: 'bg-destructive/15 text-destructive border-destructive/30',
  partially_approved: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

export interface LeaveRequest {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  hours?: number;
  reason: string;
  note?: string;
  status: LeaveStatus;
  paidOrUnpaid: 'paid' | 'unpaid' | 'auto';
  isLateRequest?: boolean;
  /** Policy basis at time of request */
  policyBasis?: string;
  /** Whether this exceeds probation monthly limit */
  exceedsProbationLimit?: boolean;
  approvedBy?: string;
  approverNote?: string;
  /** Full ISO timestamp of submission */
  submittedAt: string;
  /** Full ISO timestamp of decision */
  decidedAt?: string;
  /** Who decided */
  decidedBy?: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'stylique-leave-requests';

interface AttendanceSyncEntry {
  id: string;
  userId: string;
  date: string;
  status?: string;
  checkInTime?: string;
  isLate?: boolean;
  leaveReason?: string;
  overrideBy?: string;
  overrideAt?: string;
}

function load(): LeaveRequest[] {
  return safeRead<LeaveRequest[]>(STORAGE_KEY, []);
}
function save(items: LeaveRequest[]) {
  safeWrite(STORAGE_KEY, items);
}

/** Check how many leaves an employee has used in a given month */
function countMonthlyLeaves(requests: LeaveRequest[], userId: string, yearMonth: string): number {
  return requests.filter(r =>
    r.userId === userId &&
    r.startDate.startsWith(yearMonth) &&
    (r.status === 'approved' || r.status === 'pending') &&
    ['full_day', 'half_day', 'sick_leave', 'emergency_leave'].includes(r.type)
  ).length;
}

export interface ProbationLeaveCheck {
  allowed: boolean;
  isProbationary: boolean;
  monthlyUsed: number;
  monthlyLimit: number;
  message?: string;
}

/** Check probation leave eligibility: 2 unpaid leaves per month during first 3 months */
export function checkProbationLeave(
  requests: LeaveRequest[],
  userId: string,
  startDate: string,
  joiningDate?: string,
  employmentStatus?: string,
): ProbationLeaveCheck {
  const isProbationary = employmentStatus === 'probationary';
  if (!isProbationary) return { allowed: true, isProbationary: false, monthlyUsed: 0, monthlyLimit: 999 };

  // Check if within 3-month probation window
  if (joiningDate) {
    const join = new Date(joiningDate + 'T00:00:00');
    const probEnd = new Date(join);
    probEnd.setMonth(probEnd.getMonth() + 3);
    const leaveDate = new Date(startDate + 'T00:00:00');
    if (leaveDate >= probEnd) {
      return { allowed: true, isProbationary: true, monthlyUsed: 0, monthlyLimit: 999, message: 'Probation period ended' };
    }
  }

  const yearMonth = startDate.slice(0, 7); // YYYY-MM
  const monthlyUsed = countMonthlyLeaves(requests, userId, yearMonth);
  const monthlyLimit = 2;
  const allowed = monthlyUsed < monthlyLimit;

  return {
    allowed,
    isProbationary: true,
    monthlyUsed,
    monthlyLimit,
    message: allowed
      ? `Probationary: ${monthlyUsed} of ${monthlyLimit} unpaid leaves used this month`
      : `Probation limit reached: ${monthlyUsed}/${monthlyLimit} unpaid leaves this month. Requires manager override.`,
  };
}

interface LeaveContextValue {
  requests: LeaveRequest[];
  submit: (req: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'submittedAt' | 'isLateRequest'>, shiftStart?: string, joiningDate?: string, employmentStatus?: string) => { success: boolean; isLateRequest?: boolean; probationCheck?: ProbationLeaveCheck };
  approve: (id: string, by: string, note?: string) => void;
  reject: (id: string, by: string, note?: string) => void;
  partialApprove: (id: string, by: string, note?: string) => void;
  cancel: (id: string) => void;
  getForUser: (userId: string) => LeaveRequest[];
  getPending: () => LeaveRequest[];
  getForDate: (userId: string, date: string) => LeaveRequest | undefined;
  hasApprovedLeaveToday: (userId: string) => boolean;
  getMonthlyCount: (userId: string, yearMonth: string) => number;
  refresh: () => void;
}

const LeaveContext = createContext<LeaveContextValue | null>(null);

export function LeaveProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<LeaveRequest[]>(load);

  const persist = useCallback((updated: LeaveRequest[]) => {
    setRequests(updated);
    save(updated);
  }, []);

  const submit = useCallback((
    req: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'submittedAt' | 'isLateRequest'>,
    shiftStart?: string,
    joiningDate?: string,
    employmentStatus?: string,
  ): { success: boolean; isLateRequest?: boolean; probationCheck?: ProbationLeaveCheck } => {
    const now = new Date();
    const nowISO = now.toISOString();

    // Probation check
    const current = load();
    const probCheck = checkProbationLeave(current, req.userId, req.startDate, joiningDate, employmentStatus);

    // 12-hour rule
    const shift = shiftStart || '09:00';
    const [sh, sm] = shift.split(':').map(Number);
    const leaveStartDateTime = new Date(req.startDate + 'T00:00:00');
    leaveStartDateTime.setHours(sh, sm, 0, 0);
    const hoursUntilShift = (leaveStartDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isLateRequest = hoursUntilShift < 12 && hoursUntilShift > -24;

    // Build policy basis string. Probation within window → forced unpaid.
    const forcedUnpaid = probCheck.isProbationary;
    let policyBasis = forcedUnpaid
      ? `Probationary — unpaid. ${probCheck.message}`
      : (req.paidOrUnpaid === 'unpaid' ? 'Unpaid leave' : 'Paid leave (deducts from annual balance)');
    if (probCheck.isProbationary && !probCheck.allowed) {
      policyBasis += ' Requires manager override.';
    }

    current.push({
      ...req,
      id: crypto.randomUUID(),
      status: 'pending',
      isLateRequest,
      exceedsProbationLimit: probCheck.isProbationary && !probCheck.allowed,
      policyBasis,
      paidOrUnpaid: forcedUnpaid ? 'unpaid' : (req.paidOrUnpaid || 'auto'),
      submittedAt: nowISO,
      createdAt: nowISO,
      updatedAt: nowISO,
    });
    persist(current);
    return { success: true, isLateRequest, probationCheck: probCheck };
  }, [persist]);

  const updateStatus = useCallback((id: string, status: LeaveStatus, by?: string, note?: string) => {
    const current = load();
    const idx = current.findIndex(r => r.id === id);
    if (idx < 0) return;
    // Idempotent: a request can only hold ONE status at a time.
    // Prevents the "Pending AND Approved" duplicate-state bug when an action
    // fires twice or two approvers click within the same render frame.
    const existing = current[idx];
    if (existing.status === status) return;
    const isFinal = (s: LeaveStatus) => s === 'approved' || s === 'rejected' || s === 'cancelled';
    if (isFinal(existing.status) && isFinal(status) && status !== 'cancelled') {
      // A final state can only be overridden by an explicit cancel.
      return;
    }
    const nowISO = new Date().toISOString();
    current[idx] = {
      ...existing,
      status,
      approvedBy: by || existing.approvedBy,
      approverNote: note || existing.approverNote,
      decidedAt: nowISO,
      decidedBy: by,
      updatedAt: nowISO,
    };
    persist(current);
  }, [persist]);

  const approve = useCallback((id: string, by: string, note?: string) => {
    updateStatus(id, 'approved', by, note);
    // Auto-sync approved leave into attendance store
    const current = load();
    const req = current.find(r => r.id === id);
    if (req) {
      const start = new Date(req.startDate + 'T00:00:00');
      const end = req.endDate ? new Date(req.endDate + 'T00:00:00') : start;
      const attendanceKey = 'stylique-attendance';
      const entries = safeRead<AttendanceSyncEntry[]>(attendanceKey, []);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const existing = entries.findIndex(e => e.userId === req.userId && e.date === dateStr);
        const leaveStatus = req.type === 'half_day' ? 'half_day' : req.type === 'early_leave' ? 'early_leave_approved' : req.type === 'two_hour_permission' || req.type === 'custom_short' ? 'short_leave' : 'leave_approved';
        const patch = {
          id: existing >= 0 ? entries[existing].id : safeId('attendance'),
          userId: req.userId,
          date: dateStr,
          status: leaveStatus,
          leaveReason: req.reason,
          overrideBy: by,
          overrideAt: new Date().toISOString(),
        };
        if (existing >= 0) entries[existing] = { ...entries[existing], ...patch };
        else entries.push(patch);
      }
      safeWrite(attendanceKey, entries);
      window.dispatchEvent(new CustomEvent('stylique-attendance-sync'));
    }
  }, [updateStatus]);
  const reject = useCallback((id: string, by: string, note?: string) => updateStatus(id, 'rejected', by, note), [updateStatus]);
  const partialApprove = useCallback((id: string, by: string, note?: string) => updateStatus(id, 'partially_approved', by, note), [updateStatus]);
  const cancel = useCallback((id: string) => updateStatus(id, 'cancelled'), [updateStatus]);

  const getForUser = useCallback((userId: string) => requests.filter(r => r.userId === userId), [requests]);
  const getPending = useCallback(() => requests.filter(r => r.status === 'pending'), [requests]);
  const getForDate = useCallback((userId: string, date: string) => {
    return requests.find(r => r.userId === userId && r.startDate <= date && (r.endDate ? r.endDate >= date : r.startDate === date) && (r.status === 'approved' || r.status === 'pending'));
  }, [requests]);

  const hasApprovedLeaveToday = useCallback((userId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    return requests.some(r => r.userId === userId && r.startDate <= today && (r.endDate ? r.endDate >= today : r.startDate === today) && r.status === 'approved');
  }, [requests]);

  const getMonthlyCount = useCallback((userId: string, yearMonth: string) => {
    return countMonthlyLeaves(requests, userId, yearMonth);
  }, [requests]);

  const refresh = useCallback(() => setRequests(load()), []);

  const value = useMemo(() => ({
    requests, submit, approve, reject, partialApprove, cancel, getForUser, getPending, getForDate, hasApprovedLeaveToday, getMonthlyCount, refresh,
  }), [requests, submit, approve, reject, partialApprove, cancel, getForUser, getPending, getForDate, hasApprovedLeaveToday, getMonthlyCount, refresh]);

  return <LeaveContext.Provider value={value}>{children}</LeaveContext.Provider>;
}

export function useLeave() {
  const ctx = useContext(LeaveContext);
  if (!ctx) throw new Error('useLeave must be within LeaveProvider');
  return ctx;
}
