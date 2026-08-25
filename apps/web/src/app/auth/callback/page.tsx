'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

/**
 * Magic-link redirect target. Supabase's client SDK auto-exchanges the
 * token in the URL on load (detectSessionInUrl is on by default), so this
 * page only needs to wait for useAuth() to report the resulting session,
 * then bounce back to the single-page app.
 */
export default function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && session) {
      router.replace('/');
    }
  }, [loading, session, router]);

  return (
    <div className="wrap" style={{ textAlign: 'center', paddingTop: 80 }}>
      <div className="loading-text">Signing you in...</div>
    </div>
  );
}
