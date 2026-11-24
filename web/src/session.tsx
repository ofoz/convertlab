import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, request, setCsrfToken } from './api';
import type { MeResponse, Quotas, Usage, User } from './types';

export type AuthPayload = { user: User; csrf?: string; usage?: Usage; quotas?: Quotas };

type SessionValue = {
  ready: boolean;
  user: User | null;
  usage: Usage | null;
  quotas: Quotas | null;
  registrationOpen: boolean;
  refresh: () => Promise<void>;
  applyAuth: (payload: AuthPayload) => void;
  setUsage: (usage: Usage) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsageState] = useState<Usage | null>(null);
  const [quotas, setQuotas] = useState<Quotas | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await request<MeResponse>('/api/auth/me');
      setCsrfToken(me.csrf);
      setUser(me.user);
      setUsageState(me.usage ?? null);
      setQuotas(me.quotas ?? null);
      setRegistrationOpen(me.registrationOpen);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
      setCsrfToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setCsrfToken(null);
      setUser(null);
    };
    window.addEventListener('convertlab:unauthorized', onUnauthorized);
    return () => window.removeEventListener('convertlab:unauthorized', onUnauthorized);
  }, []);

  const applyAuth = useCallback((payload: AuthPayload) => {
    setCsrfToken(payload.csrf);
    setUser(payload.user);
    if (payload.usage) setUsageState(payload.usage);
    if (payload.quotas) setQuotas(payload.quotas);
  }, []);

  const setUsage = useCallback((next: Usage) => setUsageState(next), []);

  const signOut = useCallback(async () => {
    try {
      await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore: session may already be gone */
    }
    setCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ ready, user, usage, quotas, registrationOpen, refresh, applyAuth, setUsage, signOut }),
    [ready, user, usage, quotas, registrationOpen, refresh, applyAuth, setUsage, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用');
  return value;
}
