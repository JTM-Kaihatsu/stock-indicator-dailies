'use client';

import { useState } from 'react';

export function TickerInput({ onSubmit, disabled }: { onSubmit: (ticker: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ticker = value.trim().toUpperCase();
    if (ticker) onSubmit(ticker);
  }

  return (
    <form className="ticker-form" onSubmit={handleSubmit}>
      <input
        className="ticker-input"
        type="text"
        placeholder="NVDA"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        maxLength={6}
        autoFocus
      />
      <button className="analyze-btn" type="submit" disabled={disabled || !value.trim()}>
        Analyze
      </button>
    </form>
  );
}
