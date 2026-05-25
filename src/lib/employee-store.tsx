/**
 * STYLIQUE CRM — Employee Profile & Payroll Store
 * Manages employee profiles, leave policies, compensation rules,
 * payroll calculations, and audit trail.
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { setTeamMembersFromEmployees } from '@/types/crm';
import { setTeamFromEmployees as setRolesTeamFromEmployees } from '@/types/roles';
import { getApiToken, getStateBucket, saveStateBucket } from '@/lib/backend-api';

// ─── Employment Types ───────────────────────────────────

export type EmploymentStatus = 'probationary' | 'confirmed' | 'inactive' | 'contractor';

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  probationary: 'Probationary',
  confirmed: 'Confirmed',
  inactive: 'Inactive',
  contractor: 'Contractor',
};

export const EMPLOYMENT_STATUS_COLORS: Record<EmploymentStatus, string> = {
  probationary: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  confirmed: 'bg-green-500/15 text-green-500 border-green-500/30',
  inactive: 'bg-muted text-muted-foreground border-border',
  contractor: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

// ─── Leave Policy ───────────────────────────────────────

export type ProbationLeaveMode = 'no_paid_leave' | 'pro_rata' | 'manager_approved_bucket' | 'unpaid_unless_approved';

export interface LeavePolicy {
  id: string;
  name: string;
  annualPaidDays: number;
  probationMode: ProbationLeaveMode;
  probationBucketDays?: number; // for manager_approved_bucket
  sickLeavePerYear: number;
  emergencyLeavePerYear: number;
  halfDayDeduction: number; // fraction of daily rate: 0.5
  lateDeductionEnabled: boolean;
  lateDeductionAmount: number; // fixed or fraction
  shortLeaveDeductionEnabled: boolean;
}

export const PROBATION_MODE_LABELS: Record<ProbationLeaveMode, string> = {
  no_paid_leave: 'No paid leave during probation',
  pro_rata: 'Pro-rata paid leave accrual',
  manager_approved_bucket: 'Manager-approved paid leave bucket',
  unpaid_unless_approved: 'Unpaid leave unless manually approved',
};

// ─── Commission Rules ───────────────────────────────────

export interface CommissionRule {
  id: string;
  name: string;
  triggerEvent: 'outbound_meeting' | 'inbound_meeting' | 'conversion_pakistan' | 'conversion_international' | 'custom';
  amount: number;
  currency: string;
  isPercentage: boolean;
  excludeNoShows: boolean;
  excludeCancelled: boolean;
  excludeDuplicates: boolean;
  active: boolean;
}

// ─── Employee Profile ───────────────────────────────────

export interface EmployeeProfile {
  id: string; // matches team member id
  fullName: string;
  role: string;
  title?: string;
  email?: string;
  phone?: string;
  department?: string;
  manager?: string;
  region?: string;
  active: boolean;
  employmentStatus: EmploymentStatus;
  joiningDate: string; // YYYY-MM-DD
  confirmationDate?: string;
  probationStartDate?: string;
  probationEndDate?: string;
  salaryEffectiveDate?: string;
  baseSalary: number;
  currency: string;
  leavePolicyId: string;
  commissionRuleIds: string[];
  kpiAssignments: string[]; // KPI definition IDs
  annualLeaveAllowance: number;
  leaveUsed: number; // days used this year
  leaveRemaining: number;
  inboundPermission: boolean;
  outboundPermission: boolean;
  canImportLeads?: boolean;
  canAddManualLeads?: boolean;
  canSendDirectives?: boolean;
  canApprove?: boolean;
  dataVisibility?: 'own' | 'team' | 'all';
  defaultSources?: string[];
  /** IANA timezone, e.g. 'Asia/Dubai' */
  timezone?: string;
  /** Shift start in HH:mm format (local to timezone) */
  shiftStart?: string;
  /** Shift end in HH:mm format (local to timezone) */
  shiftEnd?: string;
  /** Grace period in minutes after shift start before marking late */
  graceMinutes?: number;
  /** If true, attendance is not enforced (CEO/COO) */
  attendanceExempt?: boolean;
  /** Explicit applicability toggles (default: derived from role) */
  kpiApplicable?: boolean;
  payrollApplicable?: boolean;
  attendanceApplicable?: boolean;
  /** Set true once CEO/COO has explicitly classified employment status (probationary/confirmed) */
  probationClassified?: boolean;
  /** Free-form manager notes (visible to leadership only) */
  managerNotes?: string;
  notes?: string;
  contractNotes?: string;
  updatedAt: string;
}

// ─── Payroll Types ──────────────────────────────────────

export interface PayrollEntry {
  id: string;
  employeeId: string;
  period: string; // YYYY-MM
  baseSalary: number;
  proratedSalary: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absenceDays: number;
  halfDayDeductions: number;
  lateDeductions: number;
  unpaidLeaveDeduction: number;
  absenceDeduction: number;
  outboundMeetingCommissions: number;
  conversionCommissions: number;
  manualAdditions: number;
  manualDeductions: number;
  manualAdditionNotes?: string;
  manualDeductionNotes?: string;
  finalPayable: number;
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Audit Types ────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  targetId: string;
  oldValue?: string;
  newValue?: string;
  notes?: string;
}

// ─── Storage Keys ───────────────────────────────────────

const KEYS = {
  employees: 'stylique-employees',
  leavePolicies: 'stylique-leave-policies',
  commissionRules: 'stylique-commission-rules',
  payroll: 'stylique-payroll',
  audit: 'stylique-audit-trail',
};

function readJSON<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function writeJSON<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn(`[Employee persistence] Could not write ${key} locally`, error);
  }
}

function syncEmployees(data: EmployeeProfile[]) {
  if (!getApiToken()) return;
  saveStateBucket('employees', data).catch(error => {
    console.warn('[Employee persistence] Could not sync employees', error);
  });
}

// ─── Default Data ───────────────────────────────────────

const DEFAULT_LEAVE_POLICIES: LeavePolicy[] = [
  {
    id: 'policy-confirmed',
    name: 'Confirmed SDR Policy',
    annualPaidDays: 14,
    probationMode: 'no_paid_leave',
    sickLeavePerYear: 5,
    emergencyLeavePerYear: 3,
    halfDayDeduction: 0.5,
    lateDeductionEnabled: false,
    lateDeductionAmount: 0,
    shortLeaveDeductionEnabled: false,
  },
  {
    id: 'policy-probation-unpaid',
    name: 'Probationary — No Paid Leave',
    annualPaidDays: 0,
    probationMode: 'no_paid_leave',
    sickLeavePerYear: 0,
    emergencyLeavePerYear: 2,
    halfDayDeduction: 0.5,
    lateDeductionEnabled: false,
    lateDeductionAmount: 0,
    shortLeaveDeductionEnabled: false,
  },
  {
    id: 'policy-probation-prorata',
    name: 'Probationary — Pro-Rata',
    annualPaidDays: 14,
    probationMode: 'pro_rata',
    sickLeavePerYear: 2,
    emergencyLeavePerYear: 2,
    halfDayDeduction: 0.5,
    lateDeductionEnabled: false,
    lateDeductionAmount: 0,
    shortLeaveDeductionEnabled: false,
  },
  {
    id: 'policy-probation-bucket',
    name: 'Probationary — Manager Bucket',
    annualPaidDays: 0,
    probationMode: 'manager_approved_bucket',
    probationBucketDays: 3,
    sickLeavePerYear: 2,
    emergencyLeavePerYear: 2,
    halfDayDeduction: 0.5,
    lateDeductionEnabled: false,
    lateDeductionAmount: 0,
    shortLeaveDeductionEnabled: false,
  },
];

const DEFAULT_COMMISSION_RULES: CommissionRule[] = [
  {
    id: 'comm-outbound-meeting',
    name: 'Outbound Meeting Commission',
    triggerEvent: 'outbound_meeting',
    amount: 2000,
    currency: 'PKR',
    isPercentage: false,
    excludeNoShows: true,
    excludeCancelled: true,
    excludeDuplicates: true,
    active: true,
  },
  {
    id: 'comm-conversion-pk-5k',
    name: 'Pakistan Conversion (5K)',
    triggerEvent: 'conversion_pakistan',
    amount: 5000,
    currency: 'PKR',
    isPercentage: false,
    excludeNoShows: true,
    excludeCancelled: true,
    excludeDuplicates: true,
    active: true,
  },
  {
    id: 'comm-conversion-pk-8k',
    name: 'Pakistan Conversion (8K)',
    triggerEvent: 'conversion_pakistan',
    amount: 8000,
    currency: 'PKR',
    isPercentage: false,
    excludeNoShows: true,
    excludeCancelled: true,
    excludeDuplicates: true,
    active: false,
  },
];

const DEFAULT_EMPLOYEES: EmployeeProfile[] = [
  {
    id: 'abdullah', fullName: 'Abdullah', role: 'ceo', title: 'Chief Executive Officer',
    email: '', phone: '', department: 'Leadership', manager: '',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2023-01-01',
    baseSalary: 250000, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: [], kpiAssignments: [],
    annualLeaveAllowance: 14, leaveUsed: 0, leaveRemaining: 14,
    inboundPermission: false, outboundPermission: false,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: true, canApprove: true, dataVisibility: 'all',
    attendanceExempt: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'hira', fullName: 'Hira', role: 'coo', title: 'Chief Operating Officer',
    email: '', phone: '', department: 'Leadership', manager: 'abdullah',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2023-01-01',
    baseSalary: 200000, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: [], kpiAssignments: [],
    annualLeaveAllowance: 14, leaveUsed: 0, leaveRemaining: 14,
    inboundPermission: false, outboundPermission: false,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: true, canApprove: true, dataVisibility: 'all',
    attendanceExempt: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'namra', fullName: 'Namra', role: 'operations', title: 'Operations',
    email: '', phone: '', department: 'Operations', manager: 'hira',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2026-05-18',
    baseSalary: 0, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: [], kpiAssignments: [],
    annualLeaveAllowance: 14, leaveUsed: 0, leaveRemaining: 14,
    inboundPermission: false, outboundPermission: false,
    canImportLeads: false, canAddManualLeads: false, canSendDirectives: false, canApprove: false, dataVisibility: 'all',
    attendanceExempt: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'areeba', fullName: 'Areeba', role: 'sdr', region: 'USA', title: 'Sales Development Representative',
    email: '', phone: '', department: 'Sales', manager: 'hira',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2024-06-01', confirmationDate: '2024-09-01',
    salaryEffectiveDate: '2024-06-01', baseSalary: 55000, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: ['comm-outbound-meeting', 'comm-conversion-pk-5k'],
    kpiAssignments: ['kpi-brands-day'],
    annualLeaveAllowance: 14, leaveUsed: 7, leaveRemaining: 7,
    inboundPermission: false, outboundPermission: true,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: false, canApprove: false, dataVisibility: 'own',
    timezone: 'America/New_York', shiftStart: '06:00', shiftEnd: '13:00', graceMinutes: 15,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'taiba', fullName: 'Taiba', role: 'sdr', region: 'UK', title: 'Sales Development Representative',
    email: '', phone: '', department: 'Sales', manager: 'hira',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2024-06-01', confirmationDate: '2024-09-01',
    salaryEffectiveDate: '2024-06-01', baseSalary: 55000, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: ['comm-outbound-meeting', 'comm-conversion-pk-5k'],
    kpiAssignments: ['kpi-brands-day'],
    annualLeaveAllowance: 14, leaveUsed: 7, leaveRemaining: 7,
    inboundPermission: false, outboundPermission: true,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: false, canApprove: false, dataVisibility: 'own',
    timezone: 'Europe/London', shiftStart: '14:00', shiftEnd: '22:00', graceMinutes: 15,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'khadija', fullName: 'Khadija', role: 'sdr', region: 'Pakistan', title: 'Sales Development Representative',
    email: '', phone: '', department: 'Sales', manager: 'hira',
    active: true, employmentStatus: 'probationary',
    joiningDate: '2026-02-25', probationStartDate: '2026-02-25', probationEndDate: '2026-05-25',
    baseSalary: 40000, currency: 'PKR',
    leavePolicyId: 'policy-probation-unpaid',
    commissionRuleIds: ['comm-outbound-meeting'],
    kpiAssignments: ['kpi-brands-day'],
    annualLeaveAllowance: 0, leaveUsed: 0, leaveRemaining: 0,
    inboundPermission: true, outboundPermission: true,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: false, canApprove: false, dataVisibility: 'own',
    timezone: 'Asia/Karachi', shiftStart: '10:00', shiftEnd: '19:00', graceMinutes: 15,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'asjad', fullName: 'Asjad', role: 'sdr', region: 'Pakistan', title: 'Sales Development Representative',
    email: '', phone: '', department: 'Sales', manager: 'hira',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2026-05-21', confirmationDate: '2026-05-21',
    baseSalary: 0, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: ['comm-outbound-meeting'],
    kpiAssignments: ['kpi-brands-day'],
    annualLeaveAllowance: 14, leaveUsed: 0, leaveRemaining: 14,
    inboundPermission: false, outboundPermission: true,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: false, canApprove: false, dataVisibility: 'own',
    timezone: 'Asia/Karachi', shiftStart: '18:00', shiftEnd: '02:00', graceMinutes: 15,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'muneeb', fullName: 'Muneeb', role: 'onboarding', title: 'Onboarding Specialist',
    email: '', phone: '', department: 'Operations', manager: 'hira',
    active: true, employmentStatus: 'confirmed',
    joiningDate: '2024-03-01', confirmationDate: '2024-06-01',
    baseSalary: 50000, currency: 'PKR',
    leavePolicyId: 'policy-confirmed',
    commissionRuleIds: [],
    kpiAssignments: [],
    annualLeaveAllowance: 14, leaveUsed: 0, leaveRemaining: 14,
    inboundPermission: false, outboundPermission: false,
    canImportLeads: false, canAddManualLeads: false, canSendDirectives: false, canApprove: false, dataVisibility: 'own',
    timezone: 'Asia/Karachi', shiftStart: '10:00', shiftEnd: '19:00', graceMinutes: 15,
    updatedAt: new Date().toISOString(),
  },
];

// ─── Payroll Calculation ────────────────────────────────

function getDaysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function getWorkingDaysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  let working = 0;
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) working++;
  }
  return working;
}

export function calculatePayroll(
  emp: EmployeeProfile,
  period: string,
  policy: LeavePolicy | undefined,
  paidLeaveDays: number,
  unpaidLeaveDays: number,
  absenceDays: number,
  halfDays: number,
  lateDays: number,
  outboundMeetings: number,
  conversionCount: number,
  commissionRules: CommissionRule[],
  manualAdditions: number = 0,
  manualDeductions: number = 0,
): Omit<PayrollEntry, 'id' | 'locked' | 'lockedAt' | 'lockedBy' | 'createdAt' | 'updatedAt'> {
  const workingDays = getWorkingDaysInMonth(period);
  const dailyRate = workingDays > 0 ? emp.baseSalary / workingDays : 0;

  // Proration: if joining date is in this period
  const [py, pm] = period.split('-').map(Number);
  const joinDate = new Date(emp.joiningDate);
  let proratedSalary = emp.baseSalary;
  if (joinDate.getFullYear() === py && joinDate.getMonth() + 1 === pm) {
    // Count working days from join date to end of month
    const totalDays = getDaysInMonth(period);
    let workedDays = 0;
    for (let d = joinDate.getDate(); d <= totalDays; d++) {
      const dow = new Date(py, pm - 1, d).getDay();
      if (dow !== 0 && dow !== 6) workedDays++;
    }
    proratedSalary = Math.round((emp.baseSalary / workingDays) * workedDays);
  }

  // Deductions
  const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate);
  const absenceDeduction = Math.round(absenceDays * dailyRate);
  const halfDayDeductions = Math.round(halfDays * dailyRate * (policy?.halfDayDeduction || 0.5));
  const lateDeductions = policy?.lateDeductionEnabled ? Math.round(lateDays * (policy.lateDeductionAmount || 0)) : 0;

  // Commissions
  const outboundRule = commissionRules.find(r => r.triggerEvent === 'outbound_meeting' && r.active);
  const convRule = commissionRules.find(r => r.triggerEvent === 'conversion_pakistan' && r.active);
  const outboundMeetingCommissions = outboundRule ? outboundMeetings * outboundRule.amount : 0;
  const conversionCommissions = convRule ? conversionCount * convRule.amount : 0;

  const finalPayable = proratedSalary
    - unpaidLeaveDeduction
    - absenceDeduction
    - halfDayDeductions
    - lateDeductions
    + outboundMeetingCommissions
    + conversionCommissions
    + manualAdditions
    - manualDeductions;

  return {
    employeeId: emp.id,
    period,
    baseSalary: emp.baseSalary,
    proratedSalary,
    paidLeaveDays,
    unpaidLeaveDays,
    absenceDays,
    halfDayDeductions,
    lateDeductions,
    unpaidLeaveDeduction,
    absenceDeduction,
    outboundMeetingCommissions,
    conversionCommissions,
    manualAdditions,
    manualDeductions,
    finalPayable: Math.max(0, finalPayable),
  };
}

// ─── Context ────────────────────────────────────────────

interface EmployeeContextValue {
  employees: EmployeeProfile[];
  leavePolicies: LeavePolicy[];
  commissionRules: CommissionRule[];
  payrollEntries: PayrollEntry[];
  auditLog: AuditEntry[];

  // Employee CRUD
  saveEmployee: (emp: EmployeeProfile) => void;
  getEmployee: (id: string) => EmployeeProfile | undefined;

  // Leave policy
  saveLeavePolicy: (policy: LeavePolicy) => void;
  getLeavePolicy: (id: string) => LeavePolicy | undefined;

  // Commission
  saveCommissionRule: (rule: CommissionRule) => void;

  // Payroll
  savePayrollEntry: (entry: PayrollEntry) => void;
  getPayrollForPeriod: (period: string) => PayrollEntry[];
  lockPayroll: (period: string, by: string) => void;
  isPayrollLocked: (period: string) => boolean;

  // Audit
  logAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;

  refresh: () => void;
}

const EmployeeContext = createContext<EmployeeContextValue | null>(null);

const SALARY_DEFAULTS: Record<string, number> = {
  abdullah: 250000, hira: 200000, areeba: 55000, taiba: 55000,
  khadija: 40000, muneeb: 50000, namra: 0, asjad: 0,
};

function loadEmployees(): EmployeeProfile[] {
  const stored = readJSON<EmployeeProfile>(KEYS.employees);
  if (stored.length > 0) {
    // Migration: backfill base salaries if still 0
    let migrated = false;
    const updated = stored.map(emp => {
      if (emp.baseSalary === 0 && SALARY_DEFAULTS[emp.id]) {
        migrated = true;
        return { ...emp, baseSalary: SALARY_DEFAULTS[emp.id] };
      }
      return emp;
    });
    for (const defaultEmp of DEFAULT_EMPLOYEES) {
      if (!updated.some(emp => emp.id === defaultEmp.id)) {
        migrated = true;
        updated.push(defaultEmp);
      }
    }
    if (migrated) writeJSON(KEYS.employees, updated);
    const final = migrated ? updated : stored;
    setTeamMembersFromEmployees(final);
    setRolesTeamFromEmployees(final);
    return final;
  }
  writeJSON(KEYS.employees, DEFAULT_EMPLOYEES);
  setTeamMembersFromEmployees(DEFAULT_EMPLOYEES);
  setRolesTeamFromEmployees(DEFAULT_EMPLOYEES);
  return DEFAULT_EMPLOYEES;
}
function loadPolicies(): LeavePolicy[] {
  const stored = readJSON<LeavePolicy>(KEYS.leavePolicies);
  if (stored.length > 0) return stored;
  writeJSON(KEYS.leavePolicies, DEFAULT_LEAVE_POLICIES);
  return DEFAULT_LEAVE_POLICIES;
}
function loadCommissions(): CommissionRule[] {
  const stored = readJSON<CommissionRule>(KEYS.commissionRules);
  if (stored.length > 0) return stored;
  writeJSON(KEYS.commissionRules, DEFAULT_COMMISSION_RULES);
  return DEFAULT_COMMISSION_RULES;
}

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const [employees, setEmployees] = useState<EmployeeProfile[]>(loadEmployees);
  const [leavePolicies, setLeavePolicies] = useState<LeavePolicy[]>(loadPolicies);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>(loadCommissions);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>(() => readJSON<PayrollEntry>(KEYS.payroll));
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(() => readJSON<AuditEntry>(KEYS.audit));

  useEffect(() => {
    if (!getApiToken()) return;
    let cancelled = false;
    getStateBucket<EmployeeProfile>('employees')
      .then(remote => {
        if (cancelled || !Array.isArray(remote) || remote.length === 0) return;
        writeJSON(KEYS.employees, remote);
        setEmployees(remote);
        setTeamMembersFromEmployees(remote);
        setRolesTeamFromEmployees(remote);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const saveEmployee = useCallback((emp: EmployeeProfile) => {
    const current = readJSON<EmployeeProfile>(KEYS.employees);
    if (current.length === 0) current.push(...DEFAULT_EMPLOYEES);
    const idx = current.findIndex(e => e.id === emp.id);
    emp.updatedAt = new Date().toISOString();
    if (idx >= 0) current[idx] = emp; else current.push(emp);
    writeJSON(KEYS.employees, current);
    syncEmployees(current);
    setEmployees([...current]);
    setTeamMembersFromEmployees(current);
    setRolesTeamFromEmployees(current);
  }, []);

  const getEmployee = useCallback((id: string) => employees.find(e => e.id === id), [employees]);

  const saveLeavePolicy = useCallback((policy: LeavePolicy) => {
    const current = readJSON<LeavePolicy>(KEYS.leavePolicies);
    if (current.length === 0) current.push(...DEFAULT_LEAVE_POLICIES);
    const idx = current.findIndex(p => p.id === policy.id);
    if (idx >= 0) current[idx] = policy; else current.push(policy);
    writeJSON(KEYS.leavePolicies, current);
    setLeavePolicies([...current]);
  }, []);

  const getLeavePolicy = useCallback((id: string) => leavePolicies.find(p => p.id === id), [leavePolicies]);

  const saveCommissionRule = useCallback((rule: CommissionRule) => {
    const current = readJSON<CommissionRule>(KEYS.commissionRules);
    if (current.length === 0) current.push(...DEFAULT_COMMISSION_RULES);
    const idx = current.findIndex(r => r.id === rule.id);
    if (idx >= 0) current[idx] = rule; else current.push(rule);
    writeJSON(KEYS.commissionRules, current);
    setCommissionRules([...current]);
  }, []);

  const savePayrollEntry = useCallback((entry: PayrollEntry) => {
    const current = readJSON<PayrollEntry>(KEYS.payroll);
    const idx = current.findIndex(p => p.id === entry.id);
    entry.updatedAt = new Date().toISOString();
    if (idx >= 0) current[idx] = entry; else current.push(entry);
    writeJSON(KEYS.payroll, current);
    setPayrollEntries([...current]);
  }, []);

  const getPayrollForPeriod = useCallback((period: string) => {
    return payrollEntries.filter(p => p.period === period);
  }, [payrollEntries]);

  const lockPayroll = useCallback((period: string, by: string) => {
    const current = readJSON<PayrollEntry>(KEYS.payroll);
    const now = new Date().toISOString();
    for (const entry of current) {
      if (entry.period === period) {
        entry.locked = true;
        entry.lockedAt = now;
        entry.lockedBy = by;
      }
    }
    writeJSON(KEYS.payroll, current);
    setPayrollEntries([...current]);
  }, []);

  const isPayrollLocked = useCallback((period: string) => {
    return payrollEntries.some(p => p.period === period && p.locked);
  }, [payrollEntries]);

  const logAudit = useCallback((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    const current = readJSON<AuditEntry>(KEYS.audit);
    current.unshift({
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    // Keep last 500 entries
    const trimmed = current.slice(0, 500);
    writeJSON(KEYS.audit, trimmed);
    setAuditLog(trimmed);
  }, []);

  const refresh = useCallback(() => {
    setEmployees(loadEmployees());
    setLeavePolicies(loadPolicies());
    setCommissionRules(loadCommissions());
    setPayrollEntries(readJSON<PayrollEntry>(KEYS.payroll));
    setAuditLog(readJSON<AuditEntry>(KEYS.audit));
  }, []);

  const value = useMemo(() => ({
    employees, leavePolicies, commissionRules, payrollEntries, auditLog,
    saveEmployee, getEmployee, saveLeavePolicy, getLeavePolicy,
    saveCommissionRule, savePayrollEntry, getPayrollForPeriod,
    lockPayroll, isPayrollLocked, logAudit, refresh,
  }), [employees, leavePolicies, commissionRules, payrollEntries, auditLog,
    saveEmployee, getEmployee, saveLeavePolicy, getLeavePolicy,
    saveCommissionRule, savePayrollEntry, getPayrollForPeriod,
    lockPayroll, isPayrollLocked, logAudit, refresh]);

  return <EmployeeContext.Provider value={value}>{children}</EmployeeContext.Provider>;
}

export function useEmployees() {
  const ctx = useContext(EmployeeContext);
  if (!ctx) throw new Error('useEmployees must be within EmployeeProvider');
  return ctx;
}
