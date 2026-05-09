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

const TOKEN_KEY = 'stylique:apiToken';
const TOKEN_EXP_KEY = 'stylique:apiTokenExpiresAt';

export function getApiBaseUrl(): string {
  return (import.meta.env.VITE_STYLIQUE_API_BASE_URL || '').replace(/\/+$/, '');
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

export async function loginToBackend(userId: string, password: string): Promise<{ ok: true; token: string; expiresAt: number }> {
  const result = await apiFetch<{ ok: true; token: string; expiresAt: number }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId, password }),
  });
  saveApiToken(result.token, result.expiresAt);
  return result;
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
