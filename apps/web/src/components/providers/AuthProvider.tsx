'use client';

import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
      const res = await fetch('/api/v1/auth/me');
      const json = await res.json();

      const nextUser: User | null = json.success && json.data ? json.data.user : null;

      // Drop the previous identity's cache (including any anonymous-phase 401)
      // before the next render, so consumers never read it under the new user.
      resetUserScopedCache(queryClient, userIdRef.current, nextUser?.id ?? null);
      userIdRef.current = nextUser?.id ?? null;

      if (nextUser) {
        setUser(nextUser);
        setSession(json.data.session);
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
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, session, isLoading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
