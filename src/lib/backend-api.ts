import type { ConnectorKey } from '@/lib/connectors';

export type BackendHealth =
  | { ok: false; configured: false; error: string }
  | {
      ok: true;
      configured: true;
      service: string;
      authConfigured: boolean;
      connectors: Record<ConnectorKey, { configured: boolean; endpoint: boolean; key: boolean }>;
    };

export interface ConnectorPingResult {
  ok: boolean;
  configured: boolean;
  message: string;
}

export interface AuthUserRecord {
  id: string;
  role: string;
  password: string;
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

const TOKEN_KEY = 'stylique:apiToken';
const TOKEN_EXP_KEY = 'stylique:apiTokenExpiresAt';

export interface AuthSession {
  userId: string;
  role: string;
  mustChangePassword?: boolean;
  expiresAt?: number;
}

export function isBackendAuthRequired(): boolean {
  return import.meta.env.VITE_REQUIRE_BACKEND_AUTH === 'true';
}

export function getApiBaseUrl(): string {
  const configured = String(import.meta.env.VITE_STYLIQUE_API_BASE_URL || '').trim();
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  const base = !configured || configured.includes('CHANGE-ME') ? fallback : configured;
  return base.replace(/\/+$/, '');
}

export function getApiToken(): string {
  if (typeof window === 'undefined') return '';
  const expiresAt = Number(window.localStorage.getItem(TOKEN_EXP_KEY) || 0);
  if (expiresAt && Date.now() / 1000 > expiresAt) {
    saveApiToken('');
    return '';
  }
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

export function saveApiToken(token: string, expiresAt?: number) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
    if (expiresAt) window.localStorage.setItem(TOKEN_EXP_KEY, String(expiresAt));
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_EXP_KEY);
  }
}

export function logoutBackend() {
  saveApiToken('');
}

export function getAuthSession(): AuthSession | null {
  const token = getApiToken();
  if (!token) return null;
  try {
    const [, body] = token.split('.');
    if (!body) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload?.sub) return null;
    return {
      userId: String(payload.sub),
      role: String(payload.role || ''),
      mustChangePassword: Boolean(payload.mustChangePassword),
      expiresAt: Number(payload.exp || 0) || undefined,
    };
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error('Backend URL is not configured');
  const token = getApiToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const base = getApiBaseUrl();
  if (!base) return { ok: false, configured: false, error: 'Backend URL is not configured' };
  try {
    const response = await fetch(`${base}/health`);
    const data = await response.json();
    return { configured: true, ...data } as BackendHealth;
  } catch (error) {
    return { ok: false, configured: false, error: error instanceof Error ? error.message : 'Backend is unreachable' };
  }
}

export async function loginToBackend(userId: string, password: string): Promise<{ ok: true; token: string; expiresAt: number; mustChangePassword?: boolean }> {
  const result = await apiFetch<{ ok: true; token: string; expiresAt: number; mustChangePassword?: boolean }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId, password }),
  });
  saveApiToken(result.token, result.expiresAt);
  return result;
}

export async function changeOwnPassword(oldPassword: string, newPassword: string): Promise<{ ok: true; token: string; expiresAt: number; mustChangePassword?: boolean }> {
  const result = await apiFetch<{ ok: true; token: string; expiresAt: number; mustChangePassword?: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  saveApiToken(result.token, result.expiresAt);
  return result;
}

export async function getAuthUsers(): Promise<AuthUserRecord[]> {
  const result = await apiFetch<{ ok: true; users: AuthUserRecord[] }>('/api/auth-users');
  return result.users || [];
}

export async function saveAuthUser(user: AuthUserRecord): Promise<AuthUserRecord> {
  const result = await apiFetch<{ ok: true; user: AuthUserRecord }>('/api/auth-users', {
    method: 'POST',
    body: JSON.stringify({
      userId: user.id,
      role: user.role,
      password: user.password,
      mustChangePassword: user.mustChangePassword,
    }),
  });
  return result.user;
}

export async function saveAuthUsers(users: AuthUserRecord[]): Promise<AuthUserRecord[]> {
  const result = await apiFetch<{ ok: true; users: AuthUserRecord[] }>('/api/auth-users', {
    method: 'PUT',
    body: JSON.stringify({ users }),
  });
  return result.users || [];
}

export async function getStateBucket<T>(bucket: string): Promise<T[]> {
  const result = await apiFetch<{ ok: true; data: T[] }>(`/api/state/${bucket}`);
  return Array.isArray(result.data) ? result.data : [];
}

export async function saveStateBucket<T>(bucket: string, data: T[]): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/state/${bucket}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  });
}

export async function pingConnector(key: ConnectorKey): Promise<ConnectorPingResult> {
  if (!getApiBaseUrl()) {
    return { ok: false, configured: false, message: 'Backend URL is not configured' };
  }
  try {
    const result = await apiFetch<{ ok: boolean; connector: string; data?: unknown }>(`/api/connectors/${key}/ping`, {
      method: 'POST',
      body: JSON.stringify({ ping: true, source: 'stylique-crm' }),
    });
    return { ok: result.ok, configured: true, message: result.ok ? 'Live' : 'Connector rejected ping' };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Connector ping failed',
    };
  }
}

export async function submitBookDemoLead(payload: Record<string, unknown>): Promise<{ ok: true; leadId: string; merged?: boolean }> {
  return apiFetch<{ ok: true; leadId: string; merged?: boolean }>('/api/book-demo', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
