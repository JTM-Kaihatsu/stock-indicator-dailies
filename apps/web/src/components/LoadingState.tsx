'use client';

import { useEffect, useState } from 'react';

/** Chart capture is a real headless-browser session against TradingView, not
 * an API call; on a slow instance it can legitimately take over a minute.
 * These thresholds exist so a long wait reads as "working" rather than
 * "hung" — the elapsed counter alone doesn't communicate that distinction. */
function statusFor(elapsed: number): string {
  if (elapsed < 15) return 'Capturing the chart...';
  if (elapsed < 45) return 'Still capturing the chart; this can take a little while.';
  return 'Still working; chart capture can take a couple of minutes on a slow connection.';
}

export function LoadingState({ ticker }: { ticker: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="loading-wrap">
      <div className="spinner" />
      <div className="loading-text">Analyzing {ticker}...</div>
      <div className="loading-status">{statusFor(elapsed)}</div>
      <div className="elapsed">{elapsed}s elapsed</div>
    </div>
  );
}
