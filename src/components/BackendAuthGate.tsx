import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getApiBaseUrl, getApiToken, loginToBackend } from '@/lib/backend-api';
import { useUser } from '@/lib/user-context';
import { TEAM_MEMBERS } from '@/types/crm';

const AUTH_REQUIRED = import.meta.env.VITE_REQUIRE_BACKEND_AUTH === 'true';

export function BackendAuthGate({ children }: { children: ReactNode }) {
  const { currentUser, setCurrentUser } = useUser();
  const [selectedUser, setSelectedUser] = useState(currentUser);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(getApiToken);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        <p className="text-sm font-semibold">Stylique CRM</p>
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
          {TEAM_MEMBERS.map(member => (
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
