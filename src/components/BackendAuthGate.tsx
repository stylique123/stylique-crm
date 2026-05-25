import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { changeOwnPassword, getApiBaseUrl, getApiToken, getAuthSession, isBackendAuthRequired, loginToBackend } from '@/lib/backend-api';
import { useUser } from '@/lib/user-context';
import { TEAM_MEMBERS } from '@/types/crm';

const AUTH_REQUIRED = isBackendAuthRequired();

function getActiveLoginMembers() {
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('stylique-employees');
      const employees = raw ? JSON.parse(raw) : null;
      if (Array.isArray(employees) && employees.length) {
        const knownEmployeeIds = new Set(employees.map(emp => String(emp.id)));
        const active = employees
          .filter(emp => emp.active !== false)
          .map(emp => ({ id: String(emp.id), name: String(emp.fullName || emp.name || emp.id) }));
        const merged = [...active];
        for (const member of TEAM_MEMBERS) {
          if (!knownEmployeeIds.has(member.id) && !merged.some(emp => emp.id === member.id)) merged.push(member);
        }
        if (merged.length) return merged;
      }
    }
  } catch {
    /* fall back to static team */
  }
  return TEAM_MEMBERS;
}

export function BackendAuthGate({ children }: { children: ReactNode }) {
  const { currentUser, setCurrentUser } = useUser();
  const loginMembers = useMemo(getActiveLoginMembers, []);
  const [selectedUser, setSelectedUser] = useState(currentUser);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(getApiToken);
  const [mustChangePassword, setMustChangePassword] = useState(() => Boolean(getAuthSession()?.mustChangePassword));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (AUTH_REQUIRED && session?.userId && session.userId !== currentUser) {
      setCurrentUser(session.userId);
      setSelectedUser(session.userId);
    }
  }, [currentUser, setCurrentUser]);

  useEffect(() => {
    if (!loginMembers.some(member => member.id === selectedUser) && loginMembers[0]) {
      setSelectedUser(loginMembers[0].id);
      setCurrentUser(loginMembers[0].id);
    }
  }, [loginMembers, selectedUser, setCurrentUser]);

  if (!AUTH_REQUIRED) return <>{children}</>;

  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    return (
      <AuthShell>
        <p className="text-sm font-medium">Backend auth is required, but the API URL is missing.</p>
        <p className="text-xs text-muted-foreground mt-1">Set VITE_STYLIQUE_API_BASE_URL for production.</p>
      </AuthShell>
    );
  }

  if (token && !mustChangePassword) {
    return (
      <>
        {children}
      </>
    );
  }

  const submitPasswordChange = async () => {
    setLoading(true);
    setError('');
    try {
      if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');
      if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
      const result = await changeOwnPassword(password, newPassword);
      setToken(result.token);
      setMustChangePassword(false);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      setCurrentUser(selectedUser);
      const result = await loginToBackend(selectedUser, password);
      setToken(result.token);
      setMustChangePassword(Boolean(result.mustChangePassword));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <img src="/stylique-logo.png" alt="Stylique" className="stylique-logo-mark h-8 w-8 object-contain" />
          <p className="text-sm font-semibold">Stylique CRM</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {mustChangePassword ? 'Set your own password to continue.' : 'Choose your account and enter your password.'}
        </p>
      </div>
      {!mustChangePassword ? (
        <>
          <Select
            value={selectedUser}
            onValueChange={value => {
              setSelectedUser(value);
              setCurrentUser(value);
            }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {loginMembers.map(member => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Current password"
            className="h-9 text-sm"
          />
        </>
      ) : (
        <>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Temporary password"
            className="h-9 text-sm"
          />
          <Input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password"
            className="h-9 text-sm"
          />
          <Input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPasswordChange(); }}
            placeholder="Confirm new password"
            className="h-9 text-sm"
          />
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        className="w-full h-9 text-sm"
        onClick={mustChangePassword ? submitPasswordChange : submit}
        disabled={loading || !password || (mustChangePassword && (!newPassword || !confirmPassword))}
      >
        {loading ? 'Saving...' : mustChangePassword ? 'Update Password' : 'Enter CRM'}
      </Button>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4">
      <div className="w-full max-w-sm rounded-md border border-border/50 bg-card p-5 shadow-sm space-y-4">
        {children}
      </div>
    </div>
  );
}
