import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ChartImage } from '@stock-indicator-dailies/shared';
import type { DailyReport, DailyResult } from '@stock-indicator-dailies/daily';

/** A cached row is fresh for this long from `retrieved_at`; older is a miss. */
const CACHE_WINDOW_HOURS = 24;
const BUCKET = 'chart-cache';

let client: SupabaseClient | undefined;

/** Lazily construct the Supabase client. Undefined when unconfigured, so the
 * cache degrades to a no-op rather than crashing the pipeline. */
function getClient(): SupabaseClient | undefined {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  client = createClient(url, key);
  return client;
}

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

/** Persist a successful report, overwriting any prior row for the ticker.
 * Best-effort, like {@link logFailure}: caching is an optimization, not part
 * of the actual result, so a Supabase hiccup here must never turn an
 * already-successful analysis into a reported failure for the caller. */
export async function cacheReport(report: DailyReport): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    const imagePath = `${report.ticker}.png`;
    const uploaded = await uploadImage(db, imagePath, report.image);
    if (!uploaded) return;

    const { image: _image, ...rest } = report;
    await db.from('chart_cache').upsert({
      ticker: report.ticker,
      retrieved_at: new Date().toISOString(),
      report: rest,
      image_path: imagePath,
    });
  } catch {
    // Best-effort; never let caching itself fail an otherwise-successful request.
  }
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
      const uploaded = await uploadImage(db, imagePath, failure.image);
      if (!uploaded) imagePath = null;
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

async function uploadImage(db: SupabaseClient, path: string, image: ChartImage): Promise<boolean> {
  const bytes = Buffer.from(image.base64, 'base64');
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: image.mediaType,
    upsert: true,
  });
  return !error;
}

async function downloadImage(db: SupabaseClient, path: string): Promise<ChartImage | undefined> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return undefined;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { base64: buffer.toString('base64'), mediaType: data.type || 'image/png' };
}
