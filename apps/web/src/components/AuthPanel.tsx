'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { WatchlistDashboard } from './WatchlistDashboard';

/**
 * Not collapsible like SettingsPanel/BacktestPanel: the whole point of
 * logging in is that the watchlist is "ready the moment you log in," so it
 * shouldn't be hidden behind an extra click. Purely additive either way; a
 * logged-out visitor sees a short pitch, nothing else on the page changes.
 */
export function AuthPanel() {
  const { session, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }

  // Avoid flashing the logged-out pitch for a moment before the initial
  // session check resolves.
  if (loading) return null;

  if (!session || !user) {
    return (
      <div className="settings-panel">
        <div className="settings-group-hint" style={{ marginBottom: 10, maxWidth: 480 }}>
          Create a free account to save a personal watchlist; we&apos;ll check it every morning before the market
          opens so your reads are ready the moment you log in.
        </div>
        {sent ? (
          <div className="settings-confirm">Check {email} for a sign-in link.</div>
        ) : (
          <form onSubmit={sendMagicLink} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              className="ticker-input"
              style={{ fontSize: 16, fontWeight: 400, textTransform: 'none', width: 260 }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="analyze-btn" disabled={sending || !email.trim()}>
              {sending ? 'Sending...' : 'Send magic link'}
            </button>
          </form>
        )}
        {error && (
          <div className="error-card" style={{ marginTop: 10 }}>
            <p>{error}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="settings-group-hint" style={{ margin: 0 }}>Signed in as {user.email}</span>
        <button type="button" className="settings-toggle" onClick={signOut}>Sign out</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <WatchlistDashboard accessToken={session.access_token} />
      </div>
    </div>
  );
}
