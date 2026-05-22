import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getApiBaseUrl, getApiToken, getAuthSession, isBackendAuthRequired, loginToBackend } from '@/lib/backend-api';
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

  if (token) {
    return (
      <>
        {children}
      </>
    );
  }

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      setCurrentUser(selectedUser);
      const result = await loginToBackend(selectedUser, password);
      setToken(result.token);
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
          <img src="/stylique-logo.png" alt="Stylique" className="h-8 w-8 object-contain" />
          <p className="text-sm font-semibold">Stylique CRM</p>
        </div>
        <p className="text-xs text-muted-foreground">Choose your account and enter your password.</p>
      </div>
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
        placeholder="Backend password"
        className="h-9 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button className="w-full h-9 text-sm" onClick={submit} disabled={loading || !password}>
        {loading ? 'Connecting...' : 'Enter CRM'}
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
