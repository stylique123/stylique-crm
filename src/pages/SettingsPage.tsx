/**
 * STYLIQUE CRM — Settings (Team Management).
 * CEO/COO only. One row per teammate. Edit dialog covers role, manager,
 * market, shift, attendance, KPI, status, and active.
 */
import { useEffect, useState } from 'react';
import {
  useEmployees, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_COLORS,
  type EmploymentStatus, type EmployeeProfile,
} from '@/lib/employee-store';
import {
  getWeeklyKPIConfig, saveWeeklyKPIConfig, type WeeklyKPIConfig,
} from '@/engine/weekly-kpi-engine';
import {
  getPackageLabels, getPackagePricing, savePackageLabels, savePackagePricing, type PackageLabelTable, type PackagePriceTable,
} from '@/lib/package-pricing';
import {
  getConnectorReadiness, getConnectors, saveConnectors, type ConnectorConfig,
} from '@/lib/connectors';
import {
  getApiBaseUrl, getAuthUsers, getBackendHealth, loginToBackend, pingConnector, saveAuthUser, saveAuthUsers,
  type AuthUserRecord, type BackendHealth,
} from '@/lib/backend-api';
import { useCompanyStore } from '@/lib/company-store';
import { useUser } from '@/lib/user-context';
import { PLAN_LABELS, type Currency, type SubscriptionPlan } from '@/types/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, EyeOff, KeyRound, Shield, Plus, Pencil, UserMinus, UserCheck, Target, PlugZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const ROLES: Array<{ id: string; label: string }> = [
  { id: 'ceo', label: 'CEO' },
  { id: 'coo', label: 'COO' },
  { id: 'operations', label: 'Operations' },
  { id: 'sdr', label: 'SDR' },
  { id: 'onboarding', label: 'Onboarding' },
];
const MARKETS = ['USA', 'UK', 'Pakistan', 'UAE', 'Other'];
const PLANS: SubscriptionPlan[] = ['lite', 'starter', 'growth', 'enterprise', 'custom'];
const CURRENCIES: Currency[] = ['PKR', 'USD', 'GBP', 'AED'];
const READINESS_LABEL = {
  ready: 'Ready',
  disabled: 'Disabled',
  missing_endpoint: 'Needs endpoint',
  missing_key: 'Needs key reference',
} as const;

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

const DEFAULT_TITLE_BY_ROLE: Record<string, string> = {
  ceo: 'Chief Executive Officer',
  coo: 'Chief Operating Officer',
  operations: 'Operations',
  sdr: 'Sales Development Representative',
  onboarding: 'Onboarding Specialist',
};

function blankEmployee(): EmployeeProfile {
  return {
    id: '',
    fullName: '',
    role: 'sdr',
    title: 'Sales Development Representative',
    email: '',
    phone: '',
    department: 'Sales',
    manager: 'hira',
    region: 'USA',
    active: true,
    employmentStatus: 'probationary',
    joiningDate: new Date().toISOString().slice(0, 10),
    baseSalary: 40000,
    currency: 'PKR',
    leavePolicyId: 'policy-probation-unpaid',
    commissionRuleIds: ['comm-outbound-meeting'],
    kpiAssignments: ['kpi-brands-day'],
    annualLeaveAllowance: 0, leaveUsed: 0, leaveRemaining: 0,
    inboundPermission: false, outboundPermission: true,
    canImportLeads: true, canAddManualLeads: true, canSendDirectives: false,
    canApprove: false, dataVisibility: 'own',
    timezone: 'Asia/Karachi', shiftStart: '10:00', shiftEnd: '19:00', graceMinutes: 15,
    attendanceExempt: false,
    updatedAt: new Date().toISOString(),
  };
}

export default function SettingsPage() {
  const empStore = useEmployees();
  const companyStore = useCompanyStore();
  const { currentUser, role } = useUser();
  const canManageSettings = role === 'ceo' || role === 'coo';
  const [weekly, setWeekly] = useState<WeeklyKPIConfig>(getWeeklyKPIConfig);
  const [pricing, setPricing] = useState<PackagePriceTable>(getPackagePricing);
  const [packageLabels, setPackageLabels] = useState<PackageLabelTable>(getPackageLabels);
  const [connectors, setConnectors] = useState<ConnectorConfig[]>(getConnectors);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [authUsers, setAuthUsers] = useState<AuthUserRecord[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordVisible, setPasswordVisible] = useState<Record<string, boolean>>({});
  const [apiPassword, setApiPassword] = useState('');
  const [connectorChecks, setConnectorChecks] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EmployeeProfile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [reassigning, setReassigning] = useState<EmployeeProfile | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => {
    getBackendHealth().then(setBackendHealth);
  }, []);

  const loadAuthUsers = async () => {
    if (!canManageSettings) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      setAuthUsers(await getAuthUsers());
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not load passwords');
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    loadAuthUsers();
  }, [canManageSettings]);

  const findAuthUser = (id: string) => authUsers.find(user => user.id === id);

  const removeLoginForEmployee = async (id: string) => {
    const nextUsers = authUsers.filter(user => user.id !== id);
    setAuthUsers(nextUsers);
    try {
      await saveAuthUsers(nextUsers);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Login removal failed');
    }
  };

  const countOwnedRecords = (employeeId: string) => companyStore.companies.filter(company =>
    company.assignedTo === employeeId ||
    company.assigned_sdr === employeeId ||
    company.record_owner === employeeId ||
    company.assigned_onboarding_owner === employeeId
  ).length;

  const defaultReassignOwner = (employee: EmployeeProfile) =>
    empStore.employees.find(emp => emp.id === employee.manager && emp.active)?.id ||
    empStore.employees.find(emp => emp.active && emp.id !== employee.id && emp.role === employee.role)?.id ||
    empStore.employees.find(emp => emp.active && emp.id !== employee.id && (emp.role === 'ceo' || emp.role === 'coo'))?.id ||
    '';

  const visibleEmployees = empStore.employees.filter(emp => showRemoved || emp.active);
  const sorted = [...visibleEmployees].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const order = ['ceo', 'coo', 'operations', 'sdr', 'onboarding'];
    return order.indexOf(a.role) - order.indexOf(b.role) || a.fullName.localeCompare(b.fullName);
  });
  const removedCount = empStore.employees.filter(emp => !emp.active).length;

  const openAdd = () => {
    setEditing(blankEmployee());
    setIsNew(true);
    setPasswordDraft(generatePassword());
  };

  const openEdit = (e: EmployeeProfile) => {
    setEditing({ ...e });
    setIsNew(false);
    setPasswordDraft(findAuthUser(e.id)?.password || '');
  };

  const deactivateEmployee = (e: EmployeeProfile) => {
    if (!canManageSettings) { toast.error('Only CEO/COO can remove teammates'); return; }
    if (e.role === 'ceo' && empStore.employees.filter(emp => emp.active && emp.role === 'ceo' && emp.id !== e.id).length === 0) {
      toast.error('Keep at least one active CEO account');
      return;
    }
    const ownedCount = countOwnedRecords(e.id);
    if (ownedCount > 0) {
      setReassignTo(defaultReassignOwner(e));
      setReassigning(e);
      return;
    }
    empStore.saveEmployee({
      ...e,
      active: false,
      employmentStatus: 'inactive',
    });
    void removeLoginForEmployee(e.id);
    toast.success(`${e.fullName} removed from active CRM and login access revoked`);
    setEditing(null);
  };

  const toggleActive = (e: EmployeeProfile) => {
    const nextActive = !e.active;
    if (!nextActive) {
      deactivateEmployee(e);
      return;
    }
    empStore.saveEmployee({
      ...e,
      active: nextActive,
      employmentStatus: nextActive ? (e.employmentStatus === 'inactive' ? 'confirmed' : e.employmentStatus) : 'inactive',
    });
    toast.success(
      `${e.fullName} reactivated`
    );
  };

  const completeReassignment = () => {
    if (!reassigning || !reassignTo) {
      toast.error('Choose a new owner before deactivating');
      return;
    }
    const now = new Date().toISOString();
    let reassigned = 0;
    companyStore.companies.forEach(company => {
      const owned =
        company.assignedTo === reassigning.id ||
        company.assigned_sdr === reassigning.id ||
        company.record_owner === reassigning.id ||
        company.assigned_onboarding_owner === reassigning.id;
      if (!owned) return;
      reassigned++;
      companyStore.saveCompany({
        ...company,
        assignedTo: company.assignedTo === reassigning.id ? reassignTo : company.assignedTo,
        assigned_sdr: company.assigned_sdr === reassigning.id ? reassignTo : company.assigned_sdr,
        record_owner: company.record_owner === reassigning.id ? reassignTo : company.record_owner,
        assigned_onboarding_owner: company.assigned_onboarding_owner === reassigning.id ? reassignTo : company.assigned_onboarding_owner,
        notes: [company.notes, `[Ownership] Previous owner: ${reassigning.fullName}`].filter(Boolean).join('\n'),
        updatedAt: now,
      });
      companyStore.addActivity({
        id: crypto.randomUUID(),
        leadId: company.id,
        type: 'assigned',
        description: `${company.companyName} reassigned from ${reassigning.fullName}`,
        createdAt: now,
        createdBy: currentUser,
      });
    });
    empStore.saveEmployee({ ...reassigning, active: false, employmentStatus: 'inactive' });
    void removeLoginForEmployee(reassigning.id);
    toast.success(`${reassigning.fullName} removed · ${reassigned} records reassigned · login revoked`);
    setReassigning(null);
    setReassignTo('');
  };

  const submitEdit = async () => {
    if (!canManageSettings) { toast.error('Operations can view settings only'); return; }
    if (!editing) return;
    if (!editing.fullName.trim()) { toast.error('Name is required'); return; }
    const next = { ...editing };
    if (isNew) {
      const id = next.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) { toast.error('Invalid name'); return; }
      if (empStore.employees.some(e => e.id === id)) {
        toast.error('A teammate with that name already exists');
        return;
      }
      next.id = id;
    }
    if (isNew && !passwordDraft.trim()) {
      toast.error('Set a login password before adding teammate');
      return;
    }
    const existing = !isNew ? empStore.employees.find(emp => emp.id === next.id) : null;
    if (existing?.active && next.active === false && countOwnedRecords(next.id) > 0) {
      setReassignTo(defaultReassignOwner(next));
      setReassigning(next);
      setEditing(null);
      return;
    }
    empStore.saveEmployee(next);
    if (passwordDraft.trim()) {
      try {
        const saved = await saveAuthUser({
          id: next.id,
          role: next.role,
          password: passwordDraft.trim(),
          mustChangePassword: true,
        });
        setAuthUsers(prev => {
          const idx = prev.findIndex(user => user.id === saved.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = saved;
            return copy;
          }
          return [...prev, saved].sort((a, b) => a.id.localeCompare(b.id));
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Password was not saved');
        return;
      }
    }
    if (!next.active) void removeLoginForEmployee(next.id);
    toast.success(isNew ? `${next.fullName} added with login` : `${next.fullName} updated`);
    setEditing(null);
    setPasswordDraft('');
  };

  const resetPassword = async (emp: EmployeeProfile, password: string) => {
    if (!canManageSettings) { toast.error('Operations can view settings only'); return; }
    if (!password.trim()) {
      toast.error('Password cannot be empty');
      return;
    }
    try {
      const saved = await saveAuthUser({ id: emp.id, role: emp.role, password: password.trim(), mustChangePassword: true });
      setAuthUsers(prev => {
        const idx = prev.findIndex(user => user.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [...prev, saved].sort((a, b) => a.id.localeCompare(b.id));
      });
      toast.success(`${emp.fullName} password updated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password update failed');
    }
  };

  const loginApi = async () => {
    try {
      await loginToBackend(currentUser, apiPassword);
      setApiPassword('');
      setBackendHealth(await getBackendHealth());
      await loadAuthUsers();
      toast.success('Backend auth connected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backend login failed');
    }
  };

  const testConnector = async (key: ConnectorConfig['key']) => {
    setConnectorChecks(prev => ({ ...prev, [key]: 'Checking...' }));
    const result = await pingConnector(key);
    setConnectorChecks(prev => ({ ...prev, [key]: result.message }));
    if (result.ok) toast.success(`${key} connector is live`);
    else toast.error(result.message);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Team, roles, shifts, KPI policy</p>
        </div>
      </div>

      <Tabs defaultValue="team" className="space-y-4">
        <TabsList className="h-8 bg-transparent border-b border-border/30 rounded-none p-0 w-full justify-start gap-0">
          <TabsTrigger value="team" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Team</TabsTrigger>
          <TabsTrigger value="passwords" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Passwords</TabsTrigger>
          <TabsTrigger value="packages" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Packages</TabsTrigger>
          <TabsTrigger value="connectors" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Connectors</TabsTrigger>
          <TabsTrigger value="kpi" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">KPI policy</TabsTrigger>
          <TabsTrigger value="permissions" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Roster</CardTitle>
              <div className="flex items-center gap-2">
                {removedCount > 0 && (
                  <ToggleRow
                    label={`Show removed (${removedCount})`}
                    checked={showRemoved}
                    onChange={setShowRemoved}
                  />
                )}
                {canManageSettings && (
                  <Button size="sm" className="h-7 text-xs" onClick={openAdd}>
                    <Plus className="h-3 w-3 mr-1" /> Add teammate
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <div className="mx-4 mb-3 rounded-md border border-border/35 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                Removing a teammate revokes CRM login, hides them from active dropdowns, and requires reassignment before any owned records move.
              </div>
              <div className="grid grid-cols-12 gap-2 px-4 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium border-b border-border/20">
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Role</div>
                <div className="col-span-2">Manager</div>
                <div className="col-span-2">Market · Shift</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-1 text-right">Edit</div>
              </div>
              {sorted.map(emp => (
                <div key={emp.id} className={cn(
                  'grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-border/15 last:border-0 text-[12px]',
                  !emp.active && 'opacity-50'
                )}>
                  <div className="col-span-3 min-w-0">
                    <div className="font-medium truncate">{emp.fullName}</div>
                    {emp.title && <div className="text-[10px] text-muted-foreground truncate">{emp.title}</div>}
                  </div>
                  <div className="col-span-2 capitalize">{emp.role}</div>
                  <div className="col-span-2 text-muted-foreground truncate">
                    {emp.manager ? (empStore.employees.find(m => m.id === emp.manager)?.fullName || emp.manager) : '—'}
                  </div>
                  <div className="col-span-2 text-muted-foreground text-[11px]">
                    {emp.region || '—'}
                    {emp.shiftStart && <div className="text-[10px]">{emp.shiftStart}–{emp.shiftEnd}</div>}
                  </div>
                  <div className="col-span-2 flex items-center gap-1 flex-wrap">
                    <Badge className={cn('text-[9px] border', EMPLOYMENT_STATUS_COLORS[emp.employmentStatus])}>
                      {EMPLOYMENT_STATUS_LABELS[emp.employmentStatus]}
                    </Badge>
                    {emp.attendanceExempt && <Badge variant="outline" className="text-[9px]">No-att</Badge>}
                    {(emp.kpiAssignments?.length ?? 0) === 0 && <Badge variant="outline" className="text-[9px]">No-KPI</Badge>}
                  </div>
                  <div className="col-span-1 flex items-center justify-end gap-1">
                    {canManageSettings && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={`Edit ${emp.fullName}`} onClick={() => openEdit(emp)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title={emp.active ? `Remove ${emp.fullName} from CRM` : `Restore ${emp.fullName}`}
                          onClick={() => toggleActive(emp)}
                        >
                          {emp.active ? <UserMinus className="h-3 w-3 text-destructive/80" /> : <UserCheck className="h-3 w-3 text-success" />}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="passwords">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5" /> Login Passwords
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadAuthUsers} disabled={authLoading}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {!canManageSettings && (
                <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Operations can view CRM state, but password management is CEO/COO only.
                </div>
              )}
              {canManageSettings && authError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {authError}
                </div>
              )}
              {canManageSettings && authError.toLowerCase().includes('unauthorized') && (
                <div className="rounded-md border border-border/40 bg-muted/20 p-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Connect backend auth once before viewing or changing passwords.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={apiPassword}
                      onChange={e => setApiPassword(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') loginApi(); }}
                      placeholder="Your CRM password"
                      className="h-8 text-xs"
                    />
                    <Button size="sm" className="h-8 text-xs" onClick={loginApi}>
                      Connect
                    </Button>
                  </div>
                </div>
              )}
              {canManageSettings && <p className="text-[11px] text-muted-foreground">
                These are CRM login passwords. Adding a teammate should include a password here.
              </p>}
              {canManageSettings && sorted.map(emp => {
                const auth = findAuthUser(emp.id);
                const visible = !!passwordVisible[emp.id];
                const value = auth?.password || '';
                return (
                  <PasswordRow
                    key={emp.id}
                    employee={emp}
                    password={value}
                    mustChangePassword={Boolean(auth?.mustChangePassword)}
                    updatedAt={auth?.updatedAt}
                    visible={visible}
                    onToggleVisible={() => setPasswordVisible(prev => ({ ...prev, [emp.id]: !visible }))}
                    onSave={password => resetPassword(emp, password)}
                    onGenerate={() => resetPassword(emp, generatePassword())}
                  />
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packages">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Package Pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                These values prefill Client Review. Enterprise and Custom can still be edited per deal.
              </p>
              <div className="overflow-x-auto rounded-md border border-border/40">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-5 gap-2 px-3 py-2 border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    <div>Package name</div>
                    {CURRENCIES.map(c => <div key={c}>{c}</div>)}
                  </div>
                  {PLANS.map(plan => (
                    <div key={plan} className="grid grid-cols-5 gap-2 px-3 py-2 border-b border-border/20 last:border-0 items-center">
                      <Input
                        value={packageLabels[plan]}
                        onChange={e => setPackageLabels({ ...packageLabels, [plan]: e.target.value })}
                        className="h-8 text-xs font-medium"
                      />
                      {CURRENCIES.map(currency => (
                        <Input
                          key={`${plan}-${currency}`}
                          type="number"
                          value={pricing[plan][currency]}
                          onChange={e => setPricing({
                            ...pricing,
                            [plan]: { ...pricing[plan], [currency]: Number(e.target.value) },
                          })}
                          className="h-8 text-xs"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => { savePackagePricing(pricing); savePackageLabels(packageLabels); toast.success('Package settings saved'); }}
              >
                Save packages
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connectors">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <PlugZap className="h-3.5 w-3.5" /> API Connectors
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Live requests go through the Stylique API gateway. Secrets stay on the backend, not in the browser.
              </p>
              <div className="rounded-md border border-border/40 bg-muted/20 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <p className="text-muted-foreground">Backend URL</p>
                    <p className="font-medium truncate">{getApiBaseUrl() || 'Not configured'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Gateway status</p>
                    <p className="font-medium">
                      {backendHealth?.ok ? 'Online' : backendHealth?.ok === false ? backendHealth.error : 'Checking...'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={apiPassword}
                    onChange={e => setApiPassword(e.target.value)}
                    placeholder="Backend admin password"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={loginApi}>
                    Connect auth
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => getBackendHealth().then(setBackendHealth)}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {connectors.map(conn => (
                  <div key={conn.key} className="rounded-md border border-border/40 bg-card px-3 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{conn.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {conn.notes} · {READINESS_LABEL[getConnectorReadiness(conn)]}
                          {connectorChecks[conn.key] ? ` · ${connectorChecks[conn.key]}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => testConnector(conn.key)}
                        >
                          Test
                        </Button>
                        <ToggleRow
                          label={conn.enabled ? 'Enabled' : 'Disabled'}
                          checked={conn.enabled}
                          onChange={enabled => setConnectors(prev => prev.map(c => c.key === conn.key ? { ...c, enabled } : c))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={conn.endpoint}
                        onChange={e => setConnectors(prev => prev.map(c => c.key === conn.key ? { ...c, endpoint: e.target.value } : c))}
                        placeholder="Endpoint URL"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={conn.apiKeyRef}
                        onChange={e => setConnectors(prev => prev.map(c => c.key === conn.key ? { ...c, apiKeyRef: e.target.value } : c))}
                        placeholder="Key reference, not secret value"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => { saveConnectors(connectors); toast.success('Connectors saved'); }}
              >
                Save connectors
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kpi">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Target className="h-3.5 w-3.5" /> Weekly Target Policy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Weekly brand target = brands per working day × effective working days.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Brands per working day</Label>
                  <Input type="number" value={weekly.brandsPerWorkingDay} onChange={e => setWeekly({ ...weekly, brandsPerWorkingDay: Number(e.target.value) })} className="text-sm h-8" />
                </div>
                <div>
                  <Label className="text-[10px]">Approved leave affects target?</Label>
                  <Select value={weekly.leaveProrationMode} onValueChange={v => setWeekly({ ...weekly, leaveProrationMode: v as 'fixed' | 'prorated' })}>
                    <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prorated">Prorated</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => { saveWeeklyKPIConfig(weekly); toast.success('Weekly KPI policy saved'); }}>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Shield className="h-3.5 w-3.5" /> Role Permissions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                { role: 'CEO / COO', perms: 'Command Center · Clients · Settings · Pipeline visibility' },
                { role: 'SDR', perms: 'Own leads · Pipeline · Tasks · Imports · KPI' },
                { role: 'Onboarding', perms: 'Onboarding queue · Credentials · Done & Verified' },
              ].map(r => (
                <div key={r.role} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <span className="font-medium">{r.role}</span>
                  <span className="text-muted-foreground text-[11px]">{r.perms}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Edit / Add Dialog ── */}
      {editing && (
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">{isNew ? 'Add teammate' : `Edit ${editing.fullName}`}</DialogTitle>
              <DialogDescription>Changes apply immediately across the app.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Field label="Full name">
                <Input value={editing.fullName} onChange={e => setEditing({ ...editing, fullName: e.target.value })} className="h-8 text-sm" />
              </Field>

              <Field label={isNew ? 'Login password' : 'Change login password'}>
                <div className="flex gap-2">
                  <Input
                    value={passwordDraft}
                    type={passwordVisible.__editing ? 'text' : 'password'}
                    onChange={e => setPasswordDraft(e.target.value)}
                    placeholder={isNew ? 'Required for login' : 'Leave blank to keep current password'}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setPasswordVisible(prev => ({ ...prev, __editing: !prev.__editing }))}
                  >
                    {passwordVisible.__editing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setPasswordDraft(generatePassword())}
                  >
                    Generate
                  </Button>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Role">
                  <Select
                    value={editing.role}
                    onValueChange={v => {
                      const prevDefault = DEFAULT_TITLE_BY_ROLE[editing.role];
                      const titleIsDefault = !editing.title || editing.title === prevDefault;
                      setEditing({
                        ...editing,
                        role: v,
                        title: titleIsDefault ? (DEFAULT_TITLE_BY_ROLE[v] || editing.title) : editing.title,
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Manager">
                  <Select value={editing.manager || 'none'} onValueChange={v => setEditing({ ...editing, manager: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager</SelectItem>
                      {empStore.employees.filter(m => m.id !== editing.id && (m.role === 'ceo' || m.role === 'coo' || m.role === 'operations')).map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Market">
                  <Select value={editing.region || 'Other'} onValueChange={v => setEditing({ ...editing, region: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{MARKETS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={editing.employmentStatus} onValueChange={v => setEditing({ ...editing, employmentStatus: v as EmploymentStatus })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="probationary">Probationary</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Shift start">
                  <Input type="time" value={editing.shiftStart || ''} onChange={e => setEditing({ ...editing, shiftStart: e.target.value })} className="h-8 text-xs" />
                </Field>
                <Field label="Shift end">
                  <Input type="time" value={editing.shiftEnd || ''} onChange={e => setEditing({ ...editing, shiftEnd: e.target.value })} className="h-8 text-xs" />
                </Field>
              </div>

              <div className="flex items-center gap-5 pt-1">
                <ToggleRow
                  label="Attendance applies"
                  checked={!editing.attendanceExempt}
                  onChange={v => setEditing({ ...editing, attendanceExempt: !v })}
                />
                <ToggleRow
                  label="KPI applies"
                  checked={(editing.kpiAssignments?.length ?? 0) > 0}
                  onChange={v => setEditing({ ...editing, kpiAssignments: v ? ['kpi-brands-day'] : [] })}
                />
                <ToggleRow
                  label="Active"
                  checked={editing.active}
                  onChange={v => setEditing({ ...editing, active: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <ToggleRow
                  label="Can import"
                  checked={!!editing.canImportLeads}
                  onChange={v => setEditing({ ...editing, canImportLeads: v })}
                />
                <ToggleRow
                  label="Can add leads"
                  checked={!!editing.canAddManualLeads}
                  onChange={v => setEditing({ ...editing, canAddManualLeads: v })}
                />
                <ToggleRow
                  label="Can approve"
                  checked={!!editing.canApprove}
                  onChange={v => setEditing({ ...editing, canApprove: v })}
                />
                <ToggleRow
                  label="Inbound access"
                  checked={!!editing.inboundPermission}
                  onChange={v => setEditing({ ...editing, inboundPermission: v })}
                />
              </div>
              <Field label="Data visibility">
                <Select value={editing.dataVisibility || 'own'} onValueChange={v => setEditing({ ...editing, dataVisibility: v as EmployeeProfile['dataVisibility'] })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Own records</SelectItem>
                    <SelectItem value="team">Team records</SelectItem>
                    <SelectItem value="all">All records</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <DialogFooter className="mt-3">
              {!isNew && editing.active && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mr-auto"
                  onClick={() => deactivateEmployee(editing)}
                >
                  <UserMinus className="mr-1.5 h-3.5 w-3.5" /> Remove access
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" onClick={submitEdit}>{isNew ? 'Add teammate' : 'Save changes'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {reassigning && (
        <Dialog open={!!reassigning} onOpenChange={(open) => { if (!open) setReassigning(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Reassign active records</DialogTitle>
              <DialogDescription>
                {reassigning.fullName} owns active CRM records. Choose the new owner before deactivation.
              </DialogDescription>
            </DialogHeader>
            <Field label="New owner">
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose owner" /></SelectTrigger>
                <SelectContent>
                  {empStore.employees.filter(emp => emp.active && emp.id !== reassigning.id).map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setReassigning(null)}>Cancel</Button>
              <Button size="sm" onClick={completeReassignment}>Reassign and deactivate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Switch checked={checked} onCheckedChange={onChange} className="scale-75" />
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
    </div>
  );
}

function PasswordRow({
  employee,
  password,
  mustChangePassword,
  updatedAt,
  visible,
  onToggleVisible,
  onSave,
  onGenerate,
}: {
  employee: EmployeeProfile;
  password: string;
  mustChangePassword?: boolean;
  updatedAt?: string;
  visible: boolean;
  onToggleVisible: () => void;
  onSave: (password: string) => void;
  onGenerate: () => void;
}) {
  const [draft, setDraft] = useState(password);

  useEffect(() => {
    setDraft(password);
  }, [password]);

  return (
    <div className="grid grid-cols-12 gap-2 items-center rounded-md border border-border/35 bg-card px-3 py-2">
      <div className="col-span-3 min-w-0">
        <div className="text-xs font-medium truncate">{employee.fullName}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {employee.id} · {employee.role}{updatedAt ? ` · ${new Date(updatedAt).toLocaleDateString()}` : ''}
        </div>
        {mustChangePassword && (
          <Badge variant="outline" className="mt-1 h-4 border-primary/30 px-1.5 text-[9px] text-primary">
            Change on login
          </Badge>
        )}
      </div>
      <div className="col-span-5">
        <Input
          value={draft}
          type={visible ? 'text' : 'password'}
          onChange={e => setDraft(e.target.value)}
          placeholder="No password allocated"
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="col-span-4 flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onToggleVisible}>
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onGenerate}>
          Generate
        </Button>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </div>
  );
}
