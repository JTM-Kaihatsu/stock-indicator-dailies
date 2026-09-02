import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChartImage } from '@stock-indicator-dailies/shared';
import type { DailyReport, DailyResult } from '@stock-indicator-dailies/daily';

import { getSupabaseClient as getClient } from './supabaseClient.ts';

/** A cached row is fresh for this long from `retrieved_at`; older is a miss. */
const CACHE_WINDOW_HOURS = 24;
const BUCKET = 'chart-cache';

interface ChartCacheRow {
  ticker: string;
  retrieved_at: string;
  report: Omit<DailyReport, 'image'>;
  image_path: string;
}

/** Look up a fresh cached report for `ticker`. `null` on a miss, an expired
 * row, or when Supabase isn't configured; all treated the same by the
 * caller. Also `null` on a Supabase-side failure (network blip, transient
 * error): this is called both directly in the /daily/start route and
 * inside runExclusive, neither of which wraps it, so an unguarded throw
 * here used to bypass every well-behaved error path in runDaily entirely
 * and surface as an opaque "capture: unknown" with nothing logged to
 * capture_failures. A cache lookup failing should degrade to "treat it as
 * a miss and capture fresh," never crash the whole request. */
export async function getCachedReport(ticker: string): Promise<DailyReport | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('chart_cache')
      .select('ticker, retrieved_at, report, image_path')
      .eq('ticker', ticker)
      .maybeSingle<ChartCacheRow>();
    if (error || !data) return null;

    const ageMs = Date.now() - new Date(data.retrieved_at).getTime();
    if (ageMs > CACHE_WINDOW_HOURS * 60 * 60 * 1000) return null;

    const image = await downloadImage(db, data.image_path);
    if (!image) return null;

    return { ...data.report, image };
  } catch {
    return null;
  }
}

/**
 * Persist a successful report, overwriting any prior row for the ticker.
 * Best-effort in the sense that a Supabase hiccup here must never turn an
 * already-successful analysis into a reported failure for the caller (the
 * pipeline already logged "ok" and the daily scheduler moves on to the next
 * ticker regardless) — but "best-effort" must not mean "silent." It used to:
 * a failed image upload returned early with no log at all, and the upsert's
 * own result was never even inspected. Live evidence of exactly this: a
 * real sweep logged "ok" for all 10 watchlisted tickers, yet only 1 of 10
 * actually landed in chart_cache — the other 9 had already been fully,
 * expensively computed (a real capture + VLM analysis each) and then
 * silently discarded on the write, with nothing anywhere — not even Render's
 * own logs — to show it had happened.
 *
 * Retries the write itself (not the whole analysis) a couple of times with
 * a short backoff before giving up: the analysis is the expensive, already-
 * sunk part, so a transient storage/DB error is worth a cheap second and
 * third attempt rather than discarding a correct, fully-computed report
 * over it. Logs loudly (console.error, so it's visible the same way the
 * "ok"/"failed" lines already are) if every attempt fails.
 */
export async function cacheReport(report: DailyReport): Promise<void> {
  const db = getClient();
  if (!db) return;

  const imagePath = `${report.ticker}.png`;
  const { image: _image, ...rest } = report;
  const row = { ticker: report.ticker, retrieved_at: new Date().toISOString(), report: rest, image_path: imagePath };

  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const uploadError = await uploadImage(db, imagePath, report.image);
      if (uploadError) {
        lastError = uploadError;
      } else {
        const { error: upsertError } = await db.from('chart_cache').upsert(row);
        if (!upsertError) return; // success
        lastError = upsertError;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await sleep(attempt * 1000); // 1s, then 2s
  }

  console.error(`[cacheReport] ${report.ticker}: failed to persist after ${attempts} attempts`, lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Log a failed run for later review. Never throws; a logging failure must
 * not take down the response to the caller. */
export async function logFailure(
  ticker: string,
  failure: Extract<DailyResult, { ok: false }>,
): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    let imagePath: string | null = null;
    if (failure.image) {
      imagePath = `failures/${ticker}-${Date.now()}.png`;
      const uploadError = await uploadImage(db, imagePath, failure.image);
      if (uploadError) imagePath = null;
    }

    await db.from('capture_failures').insert({
      ticker,
      stage: failure.stage,
      reason: failure.reason,
      errors: failure.errors,
      image_path: imagePath,
    });
  } catch {
    // Best-effort; never let failure logging itself fail the request.
  }
}

export interface LatestFailure {
  stage: string;
  reason: string;
  occurredAt: string;
}

/** The most recent logged failure for `ticker`, for the watchlist retry UI
 * to explain what went wrong. `null` on no failure on record, or any
 * Supabase-side issue — same degrade-to-noop posture as everything else
 * here; a missing failure detail just means a plainer message gets shown. */
export async function getLatestFailure(ticker: string): Promise<LatestFailure | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('capture_failures')
      .select('stage, reason, occurred_at')
      .eq('ticker', ticker)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ stage: string; reason: string; occurred_at: string }>();
    if (error || !data) return null;
    return { stage: data.stage, reason: data.reason, occurredAt: data.occurred_at };
  } catch {
    return null;
  }
}

/** Returns the Supabase error on failure, `undefined` on success — not a
 * boolean, so callers that need to know *why* (cacheReport, for logging)
 * can, while callers that only need yes/no (logFailure) just check
 * truthiness the same way. */
async function uploadImage(db: SupabaseClient, path: string, image: ChartImage): Promise<unknown> {
  const bytes = Buffer.from(image.base64, 'base64');
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: image.mediaType,
    upsert: true,
  });
  return error ?? undefined;
}

async function downloadImage(db: SupabaseClient, path: string): Promise<ChartImage | undefined> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return undefined;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { base64: buffer.toString('base64'), mediaType: data.type || 'image/png' };
}
