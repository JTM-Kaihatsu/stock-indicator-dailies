'use client';

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export interface AuthState {
  session: Session | null;
  user: User | null;
  /** True only until the initial getSession() resolves; distinguishes
   * "haven't checked yet" from "checked, logged out" so the UI doesn't
   * flash the logged-out state on every page load. */
  loading: boolean;
}

/** Session persistence/detection is handled by the Supabase client itself
 * (localStorage, on by default); this hook just surfaces the current state
 * and stays subscribed to changes (sign-in, sign-out, token refresh). */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}
