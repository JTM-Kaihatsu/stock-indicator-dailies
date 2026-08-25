'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { WatchlistDashboard } from './WatchlistDashboard';

function LoginIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

/**
 * The auth control itself is a small fixed pill in the top-right corner
 * (position: fixed, independent of .wrap's centered column) so it stays out
 * of the way of the main analyzer flow. Everything else (the sign-in pitch,
 * the form, the signed-in email, sign out) lives in a popover behind it,
 * not on the page by default. The watchlist dashboard is the one thing that
 * still renders inline in the page body once signed in, since the whole
 * point of logging in is that it's visible without an extra click.
 */
export function AuthPanel() {
  const { session, user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setSending(false);
    if (authError) setError(authError.message);
    else setSent(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setOpen(false);
  }

  if (loading) return null;

  const signedIn = Boolean(session && user);

  return (
    <>
      <div className="auth-corner" ref={rootRef}>
        <button type="button" className="auth-pill" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {signedIn ? <LogoutIcon /> : <LoginIcon />}
          <span className="auth-pill-label">{signedIn ? user!.email : 'Log in'}</span>
        </button>

        {open && (
          <div className="auth-popover">
            {signedIn ? (
              <>
                <div className="settings-group-hint" style={{ margin: 0 }}>Signed in as {user!.email}</div>
                <button type="button" className="analyze-btn" style={{ marginTop: 12, width: '100%' }} onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <div className="settings-group-hint" style={{ margin: '0 0 10px' }}>
                  Create a free account to save a personal watchlist; we&apos;ll check it every morning before the
                  market opens so your reads are ready the moment you log in.
                </div>
                {sent ? (
                  <div className="settings-confirm">Check {email} for a sign-in link.</div>
                ) : (
                  <form onSubmit={sendMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="email"
                      className="ticker-input"
                      style={{ fontSize: 14, fontWeight: 400, textTransform: 'none', width: '100%', padding: '8px 12px' }}
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={sending}
                      autoFocus
                    />
                    <button type="submit" className="analyze-btn" disabled={sending || !email.trim()}>
                      {sending ? 'Sending...' : 'Send magic link'}
                    </button>
                  </form>
                )}
                {error && (
                  <div className="error-card" style={{ marginTop: 10, padding: '10px 12px' }}>
                    <p>{error}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {signedIn && (
        <div className="settings-panel">
          <WatchlistDashboard accessToken={session!.access_token} />
        </div>
      )}
    </>
  );
}
