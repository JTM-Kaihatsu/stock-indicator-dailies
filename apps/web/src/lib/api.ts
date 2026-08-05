import type { DailyResult } from '@/types/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function analyzeDaily(ticker: string): Promise<DailyResult> {
  const url = API_BASE ? `${API_BASE}/api/daily` : '/api/daily';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  return res.json();
}
