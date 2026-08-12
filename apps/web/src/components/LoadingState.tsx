'use client';

import { useEffect, useState } from 'react';

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
      <div className="elapsed">{elapsed}s elapsed</div>
    </div>
  );
}
