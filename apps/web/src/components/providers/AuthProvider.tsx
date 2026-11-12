'use client';

import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import { resetUserScopedCache } from '@/lib/query-cache';

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  refresh: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  // `undefined` = not resolved yet, so the first `/auth/me` on a normal page
  // load is not mistaken for an identity change.
  const userIdRef = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await apiGet<{ user: User | null; session: Session | null }>('/api/v1/auth/me');

      const nextUser = data.user;

      // Drop the previous identity's cache (including any anonymous-phase 401)
      // before the next render, so consumers never read it under the new user.
      resetUserScopedCache(queryClient, userIdRef.current, nextUser?.id ?? null);
      userIdRef.current = nextUser?.id ?? null;

      if (nextUser) {
        setUser(nextUser);
        setSession(data.session);
      } else {
        setUser(null);
        setSession(null);
      }
    } catch {
      // Fail closed: the catch treats `/auth/me` as unauthenticated, so keeping
      // the previous identity's cached rows would be the worse outcome.
      resetUserScopedCache(queryClient, userIdRef.current, null);
      userIdRef.current = null;
      setUser(null);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, session, isLoading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
