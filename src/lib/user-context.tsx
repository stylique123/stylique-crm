/**
 * STYLIQUE CRM — User Context
 * Global current-user state with role-aware helpers.
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { TEAM_MEMBERS, isCeoOrCoo, isSDR } from '@/types/crm';
import { getRoleForUser, type CRMRole } from '@/lib/role';

interface UserContextValue {
  currentUser: string;
  setCurrentUser: (id: string) => void;
  role: CRMRole;
  isLeadership: boolean;
  isOnboarding: boolean;
  isSdr: boolean;
  userName: string;
}

const UserContext = createContext<UserContextValue | null>(null);

const ROLE_STORAGE_KEY = 'stylique:currentUser';
const VALID_USER_IDS = TEAM_MEMBERS.map(m => m.id);

function readInitialUser(): string {
  const fallback = 'abdullah';
  if (typeof window === 'undefined') return fallback;
  try {
    // 1. Query param ?as=<id> wins (one-shot override that also persists)
    const params = new URLSearchParams(window.location.search);
    const asParam = params.get('as');
    if (asParam && VALID_USER_IDS.includes(asParam)) {
      window.localStorage.setItem(ROLE_STORAGE_KEY, asParam);
      return asParam;
    }
    // 2. Persisted selection
    const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (stored && VALID_USER_IDS.includes(stored)) return stored;
  } catch {
    /* ignore storage errors (private mode, quota, etc.) */
  }
  return fallback;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<string>(readInitialUser);

  const setCurrentUser = (id: string) => {
    setCurrentUserState(id);
    try {
      if (typeof window !== 'undefined' && VALID_USER_IDS.includes(id)) {
        window.localStorage.setItem(ROLE_STORAGE_KEY, id);
      }
    } catch { /* ignore */ }
  };

  // Cross-tab sync: if another tab changes the role, mirror it here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROLE_STORAGE_KEY && e.newValue && VALID_USER_IDS.includes(e.newValue)) {
        setCurrentUserState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const member = TEAM_MEMBERS.find(m => m.id === currentUser);
  // Single source of role mapping — see src/lib/role.ts.
  const role: CRMRole = getRoleForUser(currentUser);

  return (
    <UserContext.Provider value={{
      currentUser,
      setCurrentUser,
      role,
      isLeadership: isCeoOrCoo(currentUser),
      isOnboarding: currentUser === 'muneeb',
      isSdr: isSDR(currentUser),
      userName: member?.name?.split(' ')[0] || currentUser,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
