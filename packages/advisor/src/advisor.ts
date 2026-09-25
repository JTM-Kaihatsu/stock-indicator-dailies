import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { isValid, parseISO } from 'date-fns';
import { runBacktest, type BacktestOptions, type BacktestResult } from '@stock-indicator-dailies/eval-backtest';
import type { Bar } from '@stock-indicator-dailies/indicators';

import {
  PROPOSE_SETTINGS_TOOL,
  RANGES,
  RUN_BACKTEST_TOOL,
  validateRiskScoredProposal,
  type BacktestCandidate,
  type ProposedSettings,
  type ResearchProposal,
  type ResearchQuote,
  type RiskScoredProposal,
  type RiskTolerance,
} from './tool.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_MAX_TOKENS = 4096;
/** Wall-clock cap on one call; protects against the model simply being
 * slow (or a hung request) regardless of which provider is involved. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** This is a background job, not a synchronous request on the critical
 * path, so it can afford to absorb more of Anthropic's transient
 * 429/5xx/529 responses than the SDK's own default of 2 before giving up.
 * The SDK already applies exponential backoff between attempts. */
export const DEFAULT_MAX_RETRIES = 5;

/** The slice of the Anthropic SDK this depends on; narrow and injectable,
 * same testability pattern as packages/vlm/src/providers/claude.ts. */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      content: Array<{ type: string; [key: string]: unknown }>;
      stop_reason?: string | null;
    }>;
  };
}

interface GeminiGroundingChunk {
  web?: { title?: string; uri?: string };
}

interface GeminiGroundingSupport {
  segment?: { text?: string };
  groundingChunkIndices?: number[];
}

interface GeminiResponse {
  text?: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
      groundingSupports?: GeminiGroundingSupport[];
    };
  }>;
}

/** The slice of the Gemini SDK this depends on; narrow and injectable, same
 * testability pattern as AnthropicLike above. */
export interface GeminiLike {
  models: {
    generateContent(params: Record<string, unknown>): Promise<GeminiResponse>;
  };
}

/** Gemini's grounding chunks give a Google-hosted redirect link
 * (`vertexaisearch.cloud.google.com/grounding-api-redirect/...`), not the
 * source page's own URL; it resolves to the real page when followed, but
 * isn't itself something a user would want to see or copy. Follows the
 * redirect chain and returns the final destination URL, falling back to
 * the original redirect link on any failure (timeout, a site that blocks
 * HEAD, network hiccup) so a resolution failure never breaks the citation,
 * just leaves it pointing at the (still-working) redirect. */
async function resolveSourceUrl(url: string, resolveFetch: typeof fetch): Promise<string> {
  try {
    const res = await resolveFetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
    return res.url || url;
  } catch {
    return url;
  }
}

const SOURCE_METADATA_FETCH_TIMEOUT_MS = 5000;
/** Enough to cover the <head> of essentially any real page; a scrape that
 * hasn't found a usable tag by this many bytes gives up rather than
 * reading an arbitrarily large body. */
const SOURCE_METADATA_MAX_BYTES = 200 * 1024;

/** Finds a meta tag's `content` value by `attr` (property or name),
 * matching either attribute order since real-world markup varies
 * (`<meta property=".." content="..">` vs `<meta content=".." property="..">`). */
function metaContent(html: string, attr: 'property' | 'name', key: string): string | undefined {
  const a = new RegExp(`<meta[^>]*?${attr}=["']${key}["'][^>]*?content=["']([^"']+)["'][^>]*>`, 'i');
  const b = new RegExp(`<meta[^>]*?content=["']([^"']+)["'][^>]*?${attr}=["']${key}["'][^>]*>`, 'i');
  return html.match(a)?.[1] ?? html.match(b)?.[1];
}

function extractMetaImage(html: string): string | undefined {
  return metaContent(html, 'property', 'og:image') ?? metaContent(html, 'name', 'twitter:image');
}

function extractSiteName(html: string): string | undefined {
  return metaContent(html, 'property', 'og:site_name');
}

function extractArticleTitle(html: string): string | undefined {
  return metaContent(html, 'property', 'og:title') ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || undefined);
}

/** Pure fallback (no network) for when a page doesn't set og:site_name, or
 * the scrape fails entirely: strips a leading www., then takes the
 * second-to-last label when there's more than one remaining (the
 * registrable/brand name, e.g. "morningstar" out of
 * "global.morningstar.com", not the "global" subdomain), or the only
 * remaining label otherwise (e.g. "reuters" out of "reuters.com").
 * Capitalized. Used so every freshly-generated source always carries a
 * displayable site name, independent of scrape success. */
function prettifyHostname(url: string): string | undefined {
  try {
    const labels = new URL(url).hostname.split('.');
    const relevant = labels[0] === 'www' ? labels.slice(1) : labels;
    const label = (relevant.length > 2 ? relevant[relevant.length - 2] : relevant[0]) || relevant[0];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
  } catch {
    return undefined;
  }
}

interface ScrapedSourceMetadata {
  thumbnailUrl?: string;
  siteName?: string;
  articleTitle?: string;
}

/** Best-effort og:image/twitter:image/og:site_name/og:title scrape of an
 * already-resolved source page, for the citation drawer's per-source pill
 * and its popout. Kept independent of resolveSourceUrl (a separate GET, not
 * folded into its HEAD) so a bug here can never affect URL resolution,
 * which every citation link already depends on. Streams the body with a
 * byte cap and bails out early once `</head>` is seen, so one slow or huge
 * page can't block the whole citation-resolution step. Returns an object
 * with whichever fields it managed to extract (possibly none) on any
 * failure (timeout, non-2xx, non-HTML content-type, no usable tags); never
 * throws, same graceful-fallback posture as resolveSourceUrl, just "no
 * metadata" instead of "original URL". */
async function scrapeSourceMetadata(url: string, resolveFetch: typeof fetch): Promise<ScrapedSourceMetadata> {
  try {
    const res = await resolveFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(SOURCE_METADATA_FETCH_TIMEOUT_MS) });
    if (!res.ok) return {};
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) return {};
    if (!res.body) return {};

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    try {
      while (html.length < SOURCE_METADATA_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }

    const image = extractMetaImage(html);
    let thumbnailUrl: string | undefined;
    if (image) {
      const absolute = new URL(image, res.url || url);
      if (absolute.protocol === 'http:' || absolute.protocol === 'https:') thumbnailUrl = absolute.toString();
    }
    return { thumbnailUrl, siteName: extractSiteName(html), articleTitle: extractArticleTitle(html) };
  } catch {
    return {};
  }
}

/** Turns Gemini's grounding metadata (which segments of its response text
 * were backed by which web sources) into our own ResearchQuote shape, with
 * every source's URL resolved to its real destination (see
 * resolveSourceUrl). Drops a support with no text, no attributed chunks, or
 * chunks with no usable URI; best-effort, since a quote we can't fully
 * resolve is useless for display anyway. Resolves each distinct redirect
 * URL only once (the same source is often cited by several quotes) and in
 * parallel, so this adds at most one round trip's worth of latency, not
 * one per citation. */
async function extractCitations(response: GeminiResponse, resolveFetch: typeof fetch): Promise<ResearchQuote[]> {
  const metadata = response.candidates?.[0]?.groundingMetadata;
  const chunks = metadata?.groundingChunks ?? [];
  const supports = metadata?.groundingSupports ?? [];

  const citations: ResearchQuote[] = [];
  for (const support of supports) {
    const quote = support.segment?.text?.trim();
    if (!quote) continue;
    const sources = (support.groundingChunkIndices ?? [])
      .map((i) => chunks[i]?.web)
      .filter((web): web is { title?: string; uri: string } => typeof web?.uri === 'string')
      .map((web) => ({ title: web.title?.trim() || web.uri, url: web.uri }));
    if (sources.length === 0) continue;
    citations.push({ quote, sources });
  }

  const uniqueUrls = new Set<string>();
  for (const citation of citations) {
    for (const source of citation.sources) uniqueUrls.add(source.url);
  }
  interface ResolvedSource {
    url: string;
    thumbnailUrl?: string;
    siteName?: string;
    articleTitle?: string;
  }
  const resolved = new Map<string, ResolvedSource>(
    await Promise.all(
      Array.from(uniqueUrls, async (url): Promise<[string, ResolvedSource]> => {
        const resolvedUrl = await resolveSourceUrl(url, resolveFetch);
        const meta = await scrapeSourceMetadata(resolvedUrl, resolveFetch);
        const siteName = meta.siteName ?? prettifyHostname(resolvedUrl);
        return [url, { url: resolvedUrl, thumbnailUrl: meta.thumbnailUrl, siteName, articleTitle: meta.articleTitle }];
      }),
    ),
  );
  for (const citation of citations) {
    for (const source of citation.sources) {
      const r = resolved.get(source.url);
      if (!r) continue;
      source.url = r.url;
      if (r.thumbnailUrl) source.thumbnailUrl = r.thumbnailUrl;
      if (r.siteName) source.siteName = r.siteName;
      if (r.articleTitle) source.articleTitle = r.articleTitle;
    }
  }

  return citations;
}

/** researchCompany now runs on Gemini + Grounding with Google Search (see
 * module docs in tool.ts for why); its options are shaped for that
 * provider, not Anthropic's. */
export interface ResearchOptions {
  /** Defaults to `process.env.GEMINI_API_KEY`. */
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  client?: GeminiLike;
  /** Defaults to the global `fetch`; injectable so tests can verify
   * citation-URL resolution (see resolveSourceUrl) without making real
   * network calls, same testability pattern as `client` above. */
  resolveFetch?: typeof fetch;
  /** Options for the handful of small Claude calls this Gemini-primary
   * stage makes on the side: checkForMaterialUpdates's earnings-date
   * fallback parse (see validateEarningsDate) and researchCompany's
   * time-sensitive-claim classification (see verifyTimeSensitiveClaims).
   * Kept separate from this interface's own Gemini-shaped fields
   * (apiKey/model/client above all mean something different for Claude)
   * rather than overloading them. */
  claudeOptions?: ScoreOptions;
}

/** scoreForRiskTolerance stays on Claude: a short backtest-validating tool
 * loop, no search, synthesizing whatever researchCompany (now Gemini-
 * backed) gathered into structured settings + rationale + fit + earnings
 * outlook. */
export interface ScoreOptions {
  /** Defaults to `process.env.VLM_API_KEY`; same key already used for the
   * chart-reading VLM calls, since both are Claude API usage. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Only applies when `client` is not supplied; ignored for an injected
   * test client, which has no retry behavior of its own. */
  maxRetries?: number;
  client?: AnthropicLike;
  /** Fired with a short human-readable status ("Running 1st historical
   * simulation...") each time the backtest-validation loop below advances,
   * so a caller polling a background job (see apps/api/src/jobStore.ts)
   * can surface real progress instead of a single static "please wait".
   * Purely observational: never awaited, never affects the loop itself. */
  onStage?: (stage: string) => void;
  /** Only used by scoreForRiskTolerance's earnings-date validation (see
   * validateEarningsDate): options for the Gemini call that re-searches for
   * a stale date, excluding whatever source domain produced it. Kept
   * separate from this interface's own Claude-shaped fields for the same
   * reason ResearchOptions.claudeOptions is separate from its. */
  earningsDateGeminiOptions?: ResearchOptions;
}

/** Ordinal labels for the loop's own backtest calls (1-indexed,
 * MAX_BACKTEST_CALLS is small so a lookup beats a general ordinal-suffix
 * algorithm); an out-of-range index falls back to a plain "Nth". */
const BACKTEST_CALL_ORDINALS = ['1st', '2nd', '3rd'];
function backtestCallOrdinal(n: number): string {
  return BACKTEST_CALL_ORDINALS[n - 1] ?? `${n}th`;
}

export class AdvisorWallClockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`advisor did not finish within ${timeoutMs}ms`);
    this.name = 'AdvisorWallClockTimeoutError';
  }
}

/** The upstream API (Claude or Gemini) returned a transient error (rate
 * limit, overload, or a 5xx) after any of the provider's own retries were
 * exhausted. Distinct from AdvisorWallClockTimeoutError (the whole call ran
 * too long); this one means the upstream API itself was unavailable, and
 * trying again shortly is likely to work. */
export class AdvisorUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdvisorUpstreamError';
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Duck-typed status extraction so this works against both providers' SDKs
 * (Anthropic's APIError and Gemini's ApiError both carry a numeric
 * `.status`) and any fake client tests throw. */
function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function friendlyClaudeUpstreamMessage(status: number): string {
  if (status === 529) {
    return "Claude's API is temporarily overloaded. This usually clears up within a minute; please try again shortly.";
  }
  if (status === 429) {
    return "Hit Claude's API rate limit. Please wait a moment and try again.";
  }
  return `Claude's API returned an unexpected error (HTTP ${status}). Please try again shortly.`;
}

function friendlyGeminiUpstreamMessage(status: number): string {
  if (status === 503) {
    return "Gemini's API is temporarily overloaded. This usually clears up within a minute; please try again shortly.";
  }
  if (status === 429) {
    return "Hit Gemini's API rate limit. Please wait a moment and try again.";
  }
  return `Gemini's API returned an unexpected error (HTTP ${status}). Please try again shortly.`;
}

/** Wraps a Claude call so scoring translates a transient upstream error
 * (rate limit, overload, 5xx) into AdvisorUpstreamError, instead of letting
 * the SDK's raw error escape. */
async function createClaudeMessage(
  client: AnthropicLike,
  body: Record<string, unknown>,
): Promise<Awaited<ReturnType<AnthropicLike['messages']['create']>>> {
  try {
    return await client.messages.create(body);
  } catch (err) {
    const status = extractStatus(err);
    if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
      throw new AdvisorUpstreamError(status, friendlyClaudeUpstreamMessage(status));
    }
    throw err;
  }
}

/** Same wrapping as createClaudeMessage, for Gemini's client shape. */
async function createGeminiContent(
  client: GeminiLike,
  params: Record<string, unknown>,
): Promise<GeminiResponse> {
  try {
    return await client.models.generateContent(params);
  } catch (err) {
    const status = extractStatus(err);
    if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
      throw new AdvisorUpstreamError(status, friendlyGeminiUpstreamMessage(status));
    }
    throw err;
  }
}

function buildClaudeClient(options: { apiKey?: string; maxRetries?: number; client?: AnthropicLike }): AnthropicLike {
  return (
    options.client ??
    (new Anthropic({
      apiKey: options.apiKey ?? process.env.VLM_API_KEY,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    }) as unknown as AnthropicLike)
  );
}

function buildGeminiClient(options: { apiKey?: string; client?: GeminiLike }): GeminiLike {
  return (
    options.client ??
    (new GoogleGenAI({ apiKey: options.apiKey ?? process.env.GEMINI_API_KEY }) as unknown as GeminiLike)
  );
}

/** Races `work` against a wall-clock timeout, translating a timeout into
 * AdvisorWallClockTimeoutError. Shared by both stages. */
async function withWallClock<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AdvisorWallClockTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function findToolUse(content: Array<{ type: string; [key: string]: unknown }>, name: string) {
  return content.find((block) => block.type === 'tool_use' && block.name === name) as
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | undefined;
}

const GEMINI_RESEARCH_PROMPT = `You are researching a public company to build a reusable research brief for a
technical-analysis trading tool. This brief will be used later, in a separate step you are not doing here, to
tune indicator settings for different investor risk tolerances and to judge whether the stock suits each one;
write it to stand on its own, not slanted toward any one risk profile.

Use Google Search to work through these 4 questions IN ORDER. Each answer should build on and, where relevant,
adjust the previous one, not stand independently: this is a chain of reasoning, not 4 unrelated paragraphs.

1. What is the overall company, industry, and political/regulatory climate around this company? Have there been
   recent changes in any of the three?
2. Given that climate, what would merit success for the company in the eyes of analysts and investors by its
   next earnings report, and over the next year? Classify the consensus sentiment as one of: highly positive,
   positive but cautious, negative but optimistic, or highly negative.
3. Given the company's own historical track record, how likely is it to actually achieve that success? If it
   does, what's the likely effect on the stock in rough percent upside; if it doesn't, what's the likely percent
   downside? Only give a percentage when the research actually supports an estimate; say plainly when it
   doesn't rather than inventing a number.
4. What specific factors stand in the way of that success? Is this an ongoing, previously-existing problem, or
   something new? Has anything changed recently (within the company, its supply chain, the broader industry, or
   the political/regulatory climate) that would remedy or worsen it now, as opposed to before? Ground this in
   what you find for THIS company; do not assume any particular kind of catalyst applies just because it's
   common for the sector.

Also note the company's next scheduled earnings report date: the exact date if officially confirmed, or an
estimated date/range if not (many companies' dates can be estimated from their historical reporting pattern
even before official confirmation; report that estimate rather than omitting it, and say plainly whether it's
confirmed or estimated).

Base your findings on what you find via search, not general knowledge alone. Write a single findings summary
that reads as the running synthesis described above (climate, then success criteria, then likelihood and
upside/downside, then obstacles), as prose (6-14 sentences). Respond with only that summary; no preamble, no
headers, no numbered list matching the 4 questions verbatim; write it as connected prose that a reader could
follow question-to-question without needing the numbers.

If the user message includes a previous research summary for this company as reference, treat it only as a
known starting point: check whether what it describes is still accurate, has since been confirmed, or has
changed, and fold in whatever is still relevant. Do not limit your search to just the topics it covers --
independently search for current company, industry, and political/regulatory news the same way you would with
no prior reference at all, since something significant may have emerged that it never mentioned.`;

/** Formats a previous research summary for inclusion in a Gemini call's
 * `contents`, or '' when there isn't one -- shared by researchCompany and
 * checkForMaterialUpdates so both hand it to the model the same way. */
function formatPriorResearch(label: string, priorResearch: string | null): string {
  if (!priorResearch) return '';
  return `\n\n${label}:\n"""\n${priorResearch}\n"""`;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const TIME_SENSITIVE_CLASSIFY_PROMPT =
  'For each numbered research excerpt below, decide whether it asserts a specific, time-sensitive fact -- a ' +
  'date, a recent event, a specific figure or statistic, or an upcoming catalyst -- that could go stale or ' +
  'needs current corroboration, as opposed to general background, structural, or definitional information about ' +
  'the company that does not. Respond with ONLY a comma-separated list of the indices that ARE time-sensitive ' +
  '(e.g. "0,2,5"), or the single word NONE if none are. No other text.';

/** One cheap, ungrounded Claude call classifying which of `quotes` assert a
 * time-sensitive fact worth corroborating (see verifyTimeSensitiveClaims),
 * batched across all of them rather than one call per quote. Malformed or
 * out-of-range indices in the response are dropped rather than thrown on,
 * same defensive posture as this file's other lightweight parsers. */
async function classifyTimeSensitiveQuotes(quotes: readonly ResearchQuote[], options: ScoreOptions): Promise<Set<number>> {
  if (quotes.length === 0) return new Set();
  const client = buildClaudeClient(options);
  const list = quotes.map((q, i) => `[${i}] "${q.quote}"`).join('\n');
  const response = await createClaudeMessage(client, {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 256,
    system: TIME_SENSITIVE_CLASSIFY_PROMPT,
    messages: [{ role: 'user', content: list }],
  });
  const text = extractClaudeText(response.content).trim();
  if (text.length === 0 || text.toUpperCase() === 'NONE') return new Set();
  const indices = text
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < quotes.length);
  return new Set(indices);
}

interface CorroborationSource {
  url: string;
  title: string;
  siteName?: string;
  thumbnailUrl?: string;
  articleTitle?: string;
}

/** Searches for a source, other than `excludeDomains`, that independently
 * confirms `quoteText` about `ticker`. null if Gemini can't find one (or
 * returns something that doesn't even parse as a URL). Reuses
 * resolveSourceUrl/scrapeSourceMetadata for the same resolved-URL and
 * best-effort thumbnail/site-name treatment every other citation source
 * gets, rather than a second, inconsistent metadata path. */
async function corroborateQuote(
  ticker: string,
  quoteText: string,
  excludeDomains: readonly string[],
  options: ResearchOptions,
): Promise<CorroborationSource | null> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const client = buildGeminiClient(options);
  const exclusion =
    excludeDomains.length > 0
      ? ` Do not count a source on ${excludeDomains.join(' or ')} -- that's already the one source backing this claim, and the goal is independent corroboration from elsewhere.`
      : '';
  const response = await createGeminiContent(client, {
    model,
    contents: `Regarding ${ticker}: does an independent source confirm this specific claim? "${quoteText}"${exclusion}`,
    config: {
      systemInstruction:
        'Use Google Search. Respond in exactly this format, nothing else:\n' +
        'Line 1: the URL of a source that independently confirms this specific claim, or the single word NONE ' +
        "if you can't find one.",
      tools: [{ googleSearch: {} }],
      maxOutputTokens: 128,
    },
  });
  const urlLine = (response.text ?? '').trim().split('\n')[0]?.trim() ?? '';
  if (urlLine.length === 0 || urlLine.toUpperCase() === 'NONE' || domainOf(urlLine) === null) return null;

  const resolveFetch = options.resolveFetch ?? fetch;
  const resolvedUrl = await resolveSourceUrl(urlLine, resolveFetch);
  const meta = await scrapeSourceMetadata(resolvedUrl, resolveFetch);
  const siteName = meta.siteName ?? prettifyHostname(resolvedUrl);
  return { url: resolvedUrl, title: siteName ?? resolvedUrl, siteName, thumbnailUrl: meta.thumbnailUrl, articleTitle: meta.articleTitle };
}

/** Caps how many corroboration searches one researchCompany call will make;
 * each is a real, billed Gemini call, so this bounds cost regardless of how
 * many time-sensitive, single-sourced quotes a given research run happens
 * to produce. Whichever come first in the citations list are searched;
 * every eligible quote (searched or not) still gets marked 'single-source'
 * below, so a quote that missed the cap is never silently presented as if
 * it were fully corroborated. */
const MAX_CORROBORATION_SEARCHES = 5;

/** After Gemini's own grounding, a research quote can end up backed by
 * only one source (Gemini attributed that segment to a single search
 * result). For a time-sensitive one specifically -- a date, recent event,
 * or specific figure, as opposed to general background -- a single source
 * isn't enough to trust without question. This classifies which quotes
 * are time-sensitive (see classifyTimeSensitiveQuotes), then for each
 * single-domain-sourced one among those, tries once (in parallel, capped
 * at MAX_CORROBORATION_SEARCHES) to find a second, different-domain
 * source corroborating the same specific claim.
 *
 * Found -> appended to that quote's sources; `sourceConfidence` left
 * unset, same as any organically multi-sourced quote. Not found (or over
 * the cap, or that one search itself failed) -> the quote and its one
 * existing source are KEPT, never dropped -- a real, true fact reported by
 * only one credible outlet is still worth showing -- but marked
 * `sourceConfidence: 'single-source'` so the frontend can display it with
 * visibly lower confidence rather than the same weight as a corroborated
 * claim. A single failed search shouldn't cost the others their result
 * (Promise.allSettled, not Promise.all), and a failure in classification
 * itself (no Claude key configured, network hiccup) degrades the whole
 * step to a no-op rather than failing research: this is a best-effort
 * confidence enhancement on top of citations that are already perfectly
 * usable unverified, same posture as resolveSourceUrl/scrapeSourceMetadata
 * elsewhere in this file. */
async function verifyTimeSensitiveClaims(
  ticker: string,
  quotes: readonly ResearchQuote[],
  claudeOptions: ScoreOptions,
  geminiOptions: ResearchOptions,
): Promise<ResearchQuote[]> {
  if (quotes.length === 0) return [];
  try {
    const timeSensitive = await classifyTimeSensitiveQuotes(quotes, claudeOptions);
    if (timeSensitive.size === 0) return quotes.slice();

    const singleSourced = Array.from(timeSensitive)
      .sort((a, b) => a - b)
      .map((i) => {
        const quote = quotes[i]!;
        const existingDomains = new Set(quote.sources.map((s) => domainOf(s.url)).filter((d): d is string => d !== null));
        return { i, quote, existingDomains };
      })
      .filter((e) => e.existingDomains.size < 2);

    const result = quotes.slice();
    for (const e of singleSourced) result[e.i] = { ...e.quote, sourceConfidence: 'single-source' };

    const toSearch = singleSourced.slice(0, MAX_CORROBORATION_SEARCHES);
    const corroborations = await Promise.allSettled(
      toSearch.map((e) => corroborateQuote(ticker, e.quote.quote, Array.from(e.existingDomains), geminiOptions)),
    );
    toSearch.forEach((e, idx) => {
      const settled = corroborations[idx]!;
      const found = settled.status === 'fulfilled' ? settled.value : null;
      const foundDomain = found ? domainOf(found.url) : null;
      if (found && foundDomain && !e.existingDomains.has(foundDomain)) {
        result[e.i] = {
          ...e.quote,
          sources: [
            ...e.quote.sources,
            { title: found.title, url: found.url, siteName: found.siteName, thumbnailUrl: found.thumbnailUrl, articleTitle: found.articleTitle },
          ],
        };
      }
    });

    return result;
  } catch {
    return quotes.slice();
  }
}

/** Wider than DEFAULT_TIMEOUT_MS: the main research call is now followed by
 * a classification call and up to MAX_CORROBORATION_SEARCHES corroboration
 * searches (run in parallel, but still real latency on top). */
const RESEARCH_DEFAULT_TIMEOUT_MS = 150_000;

/** Researches `ticker`'s company via Gemini + Grounding with Google Search
 * and returns a reusable research brief. Stage 1 of 2 (see
 * scoreForRiskTolerance for stage 2); split out so the expensive,
 * search-backed part is cacheable per ticker regardless of which risk
 * tolerance ends up being scored against it. Gemini's grounding tool
 * decides its own search queries within this one call, the same way
 * Claude's hosted web_search tool did when this stage used to run there.
 *
 * `priorResearch` is the previous cached summary for this ticker, if any
 * (even a stale one, past the cache's own freshness window; see
 * apps/api/src/advisorJobs.ts), passed as a starting point so the model
 * knows what was already established rather than researching from
 * nothing every time. The prompt explicitly tells it not to limit its
 * search to just what this covers -- it's a reference to check and
 * update, not a boundary on what gets looked at. */
export async function researchCompany(
  ticker: string,
  priorResearch: string | null = null,
  options: ResearchOptions = {},
): Promise<ResearchProposal> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? RESEARCH_DEFAULT_TIMEOUT_MS;
  const client = buildGeminiClient(options);

  const work = (async () => {
    const response = await createGeminiContent(client, {
      model,
      contents:
        `Research ${ticker} and write the findings summary.` +
        formatPriorResearch(`Previous research summary for ${ticker}, for reference only (may be outdated)`, priorResearch),
      config: {
        systemInstruction: GEMINI_RESEARCH_PROMPT,
        tools: [{ googleSearch: {} }],
        maxOutputTokens,
      },
    });
    const research = (response.text ?? '').trim();
    if (research.length === 0) {
      throw new Error('Gemini research call returned no usable text');
    }
    const citations = await extractCitations(response, options.resolveFetch ?? fetch);
    const verifiedCitations = await verifyTimeSensitiveClaims(ticker, citations, options.claudeOptions ?? {}, options);
    return { research, citations: verifiedCitations };
  })();

  return withWallClock(work, timeoutMs);
}

const MATERIAL_UPDATE_CHECK_PROMPT = `You are checking whether anything materially significant has happened for a
public company since a given date, for someone deciding whether their existing investment research is still
current. Use Google Search to check for major company-specific news, significant industry trends or news, and
related political or regulatory news since that date. Only report something if it is significant enough that it
would change an investment research brief; ignore routine, minor, or already-expected news.

Also confirm the company's next scheduled earnings report date: the exact date if officially confirmed, or your
best current estimate if not (resolve an estimated range to its earlier end). If the user message gives a
currently-tracked earnings date, treat it as a starting point to confirm or correct, not to accept blindly --
search turning up a now-confirmed exact date replacing an old estimate, or a postponement, counts as confirming
or correcting it, not as new information you should second-guess.

If the user message includes the existing research summary this check is being run against, use it to see what
was already known and specifically check whether any of it is now outdated, confirmed, or contradicted. Do not
limit your search to just what it covers -- independently check for any other significant news since the given
date the same way you would with no reference summary at all.

Respond in exactly this format, nothing else:
Line 1: YES or NO (whether anything materially significant has happened)
Line 2: the confirmed or estimated next earnings date, ISO 8601 (e.g. "2026-10-22"), or the single word UNKNOWN
if you genuinely find no timing indication at all.
Line 3: the domain of the source you drew that date from (e.g. "investor.apple.com"), or the single word NONE if
line 2 is UNKNOWN or you can't attribute it to a specific source.
Remaining lines (only if line 1 is YES): a 1-2 sentence summary of what changed.`;

export interface MaterialUpdateCheck {
  hasUpdates: boolean;
  summary: string | null;
  /** The next earnings date this check confirmed or found, refined from
   * whatever was passed in as context.priorNextEarningsDate, and validated
   * (see validateEarningsDate: rejects a stale or unparseable date rather
   * than passing one straight through); null only when the check genuinely
   * found no usable date at all. Callers should use this to keep a cached
   * suggestion's earnings date current even when hasUpdates is false and no
   * full regeneration happens (see apps/api/src/advisorJobs.ts). */
  nextEarningsDate: string | null;
}

/** Everything checkForMaterialUpdates needs to know about the existing,
 * cached state it's checking against, grouped together since it's grown
 * past a couple of loose positional strings. */
export interface MaterialUpdateCheckContext {
  /** ISO date (YYYY-MM-DD) the existing research/suggestion was last
   * confirmed current as of. */
  sinceDate: string;
  /** ISO date (YYYY-MM-DD), today, per the real server clock (never the
   * model's own sense of the date, so this can't drift from what the
   * cache's own freshness/earnings-date checks are using). */
  now: string;
  /** The earnings date currently on file for this ticker, if any
   * (confirmed or estimated); passed as a starting point to confirm or
   * correct, not re-derived from nothing every time. */
  priorNextEarningsDate: string | null;
  /** The existing research summary to check against, if any (see
   * researchCompany's own doc comment for the same "starting point, not a
   * boundary" framing); giving the model the actual prior findings, not
   * just a date, lets it check whether something specific it already
   * flagged has since changed, on top of scanning broadly for anything
   * new. */
  priorResearch: string | null;
}

/** A cheap alternative to a full re-research: checks whether anything
 * material has happened for `ticker` since `context.sinceDate` (company,
 * industry, or political/regulatory news), and separately confirms the
 * next earnings date, for the "refresh" flow in apps/api/src/advisorJobs.ts
 * -- which no longer forces a full regeneration on a fixed calendar
 * schedule, so this check (not a timer) is what keeps a long-lived cached
 * suggestion's earnings date from drifting stale between full regens. */
export async function checkForMaterialUpdates(
  ticker: string,
  context: MaterialUpdateCheckContext,
  options: ResearchOptions = {},
): Promise<MaterialUpdateCheck> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const maxOutputTokens = options.maxOutputTokens ?? 512;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildGeminiClient(options);

  const work = (async () => {
    const response = await createGeminiContent(client, {
      model,
      contents:
        `Ticker: ${ticker}. Today's date is ${context.now}. Check for material news since ${context.sinceDate}.\n\n` +
        `Currently tracked next earnings date: ${context.priorNextEarningsDate ?? 'not known'}.` +
        formatPriorResearch('Existing research summary to check against (most recently known state)', context.priorResearch),
      config: {
        systemInstruction: MATERIAL_UPDATE_CHECK_PROMPT,
        tools: [{ googleSearch: {} }],
        maxOutputTokens,
      },
    });
    const text = (response.text ?? '').trim();
    const lines = text.split('\n');
    const firstLine = (lines[0] ?? '').trim().toUpperCase();
    const hasUpdates = firstLine.startsWith('YES');
    const earningsLine = (lines[1] ?? '').trim();
    const domainLine = (lines[2] ?? '').trim();
    const rawEarningsDate = earningsLine.length > 0 && earningsLine.toUpperCase() !== 'UNKNOWN' ? earningsLine : null;
    const rawSourceDomain = domainLine.length > 0 && domainLine.toUpperCase() !== 'NONE' ? domainLine : null;
    const summary = hasUpdates ? lines.slice(3).join('\n').trim() || null : null;
    const nextEarningsDate = await validateEarningsDate(
      ticker,
      { date: rawEarningsDate, sourceDomain: rawSourceDomain },
      new Date(context.now),
      options.claudeOptions ?? {},
      options,
    );
    return { hasUpdates, summary, nextEarningsDate };
  })();

  return withWallClock(work, timeoutMs);
}

// --- Earnings-date validation, shared by checkForMaterialUpdates above and
// scoreForRiskTolerance below: neither trusts a raw model-reported date
// straight through. ---

const ISO_DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict ISO-8601 calendar-date check via date-fns (not the bare `Date`
 * constructor's own lenient, inconsistent-across-engines parsing): the
 * shape regex first (rejects a partial date like "2026-10" that parseISO
 * would otherwise happily accept as the 1st of the month), then parseISO +
 * isValid to reject a shape-valid but impossible calendar date like
 * "2026-02-30". This is "a known library" doing the typecheck, not
 * hand-rolled date-math. */
function isStrictIsoDate(raw: string): boolean {
  return ISO_DATE_SHAPE_RE.test(raw.trim()) && isValid(parseISO(raw.trim()));
}

/** Mirrors apps/api/src/advisorJobs.ts's isPastEarningsDate exactly (through
 * the end of the calendar day in UTC, not the instant it starts); duplicated
 * here since packages/advisor can't depend on apps/api, and this is the only
 * other place that needs the same "is this earnings date stale" check. */
function isPastEarningsDay(isoDate: string, now: Date): boolean {
  return now.getTime() > new Date(`${isoDate}T23:59:59Z`).getTime();
}

function extractClaudeText(content: Array<{ type: string; [key: string]: unknown }>): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** Cheap Claude call (no tools, no search, tiny output) that tries to
 * salvage a date a strict typecheck rejected -- e.g. "late October 2026" or
 * "Q4 2026" -- into a clean ISO date, resolving an estimated range to its
 * earlier end. null if Claude itself can't extract anything specific
 * enough; this function never throws that as an error, since an
 * unparseable date degrading to "missing" is expected, normal behavior
 * here, not a failure. */
async function fallbackParseEarningsDate(raw: string, options: ScoreOptions): Promise<string | null> {
  const client = buildClaudeClient(options);
  const response = await createClaudeMessage(client, {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 32,
    system:
      'Extract a single earnings-report date from the given text and respond with ONLY that date in ISO 8601 ' +
      '(YYYY-MM-DD) format, resolving an estimated range to its earlier end. If the text does not contain a ' +
      'specific enough date to extract one, respond with exactly UNKNOWN and nothing else.',
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractClaudeText(response.content);
  return text.length > 0 && text.toUpperCase() !== 'UNKNOWN' ? text : null;
}

interface EarningsDateSearchResult {
  date: string | null;
  sourceDomain: string | null;
}

/** The "second search" step: re-searches for `ticker`'s next earnings date,
 * explicitly excluding whatever domain produced a stale date the first
 * time, since that domain is presumably serving outdated information for
 * this specific fact. A fresh, single-purpose Gemini call, not a recursive
 * call back into researchCompany/checkForMaterialUpdates. `excludeDomain`
 * is null when the original source couldn't be attributed to a domain at
 * all; still worth one plain search in that case, just without an
 * exclusion clause. */
async function searchEarningsDateExcludingDomain(
  ticker: string,
  excludeDomain: string | null,
  options: ResearchOptions,
): Promise<EarningsDateSearchResult> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const client = buildGeminiClient(options);
  const exclusion = excludeDomain
    ? ` Do not use ${excludeDomain} as a source for this date -- it previously reported one that turned out to be ` +
      "stale, so treat it as unreliable for this specific fact even if it's otherwise a legitimate site."
    : '';
  const response = await createGeminiContent(client, {
    model,
    contents: `Find ${ticker}'s next scheduled earnings report date.${exclusion}`,
    config: {
      systemInstruction:
        'Use Google Search. Respond in exactly this format, nothing else:\n' +
        'Line 1: the earnings date, ISO 8601 (e.g. "2026-10-22"), resolving an estimated range to its earlier ' +
        `end, or the single word UNKNOWN if you can't find one${excludeDomain ? ' from any other source' : ''}.\n` +
        'Line 2: the domain of the source you found it from, or the single word NONE if line 1 is UNKNOWN.',
      tools: [{ googleSearch: {} }],
      maxOutputTokens: 128,
    },
  });
  const lines = (response.text ?? '').trim().split('\n');
  const dateLine = (lines[0] ?? '').trim();
  const domainLine = (lines[1] ?? '').trim();
  return {
    date: dateLine.length > 0 && dateLine.toUpperCase() !== 'UNKNOWN' ? dateLine : null,
    sourceDomain: domainLine.length > 0 && domainLine.toUpperCase() !== 'NONE' ? domainLine : null,
  };
}

interface EarningsDateCandidate {
  date: string | null;
  sourceDomain: string | null;
}

/** Deterministic validation for an earnings date extracted by either
 * checkForMaterialUpdates above or scoreForRiskTolerance below: never
 * trusts a raw model-reported date straight through. Two independent
 * failure modes, handled differently:
 *
 * - STALE (a real, parseable date that's already in the past): the source
 *   that reported it is presumably out of date, so this re-searches once,
 *   excluding that source's domain, and validates whatever comes back the
 *   same way (typecheck + staleness), without a further LLM fallback or a
 *   third search. Still stale, or still unparseable -> report missing.
 * - UNPARSEABLE (fails a strict ISO-8601 typecheck): tries once to salvage
 *   it with a cheap Claude parse (e.g. "late October 2026" -> a clean
 *   date). If that also fails the typecheck, there's no reliable date (or
 *   attributable source domain) to build a targeted second search around,
 *   so this reports missing directly rather than searching blind. If the
 *   Claude-parsed date passes the typecheck but is itself stale, that DOES
 *   get the one re-search-excluding-domain attempt above.
 *
 * `null` in, `null` out: a candidate with no date at all (the model itself
 * reported none) skips all of this and is simply missing already. Callers
 * should store whatever comes back here directly, including null -- the
 * earnings-date field must stay nullable end to end (persisted as
 * next_earnings_date, surfaced on the frontend as "not found in research"
 * when null) rather than ever falling back to a guessed or partial value. */
async function validateEarningsDate(
  ticker: string,
  candidate: EarningsDateCandidate,
  now: Date,
  claudeOptions: ScoreOptions,
  geminiOptions: ResearchOptions,
): Promise<string | null> {
  if (!candidate.date) return null;

  let workingDate = candidate.date;
  const workingDomain = candidate.sourceDomain;

  if (!isStrictIsoDate(workingDate)) {
    const salvaged = await fallbackParseEarningsDate(workingDate, claudeOptions);
    if (!salvaged || !isStrictIsoDate(salvaged)) return null;
    workingDate = salvaged;
  }

  if (!isPastEarningsDay(workingDate, now)) return workingDate;

  const second = await searchEarningsDateExcludingDomain(ticker, workingDomain, geminiOptions);
  if (!second.date || !isStrictIsoDate(second.date) || isPastEarningsDay(second.date, now)) return null;
  return second.date;
}

/** Mirrors DEFAULT_SETTINGS in apps/web/src/lib/settings.ts (buyConsensus/
 * sellConsensus/recencyDays match packages/shared/src/signal.ts's own
 * defaults; persistenceBars/minHoldingDays match evals/backtest/src/
 * simulate.ts's off-by-default values); hardcoded here the same documented
 * way RANGES/the tool schemas already mirror bounds across layers, since
 * packages/advisor can't depend on the web app's settings module. Used as
 * scoreForRiskTolerance's fixed reference point ("beat this or explain why
 * not"), computed once per call and given to the model in the prompt, not
 * something it can tune itself. */
const DEFAULT_BACKTEST_SETTINGS: BacktestOptions = {
  buyConsensus: 2,
  sellConsensus: 3,
  recencyDays: 3,
  persistenceBars: 1,
  minHoldingDays: 0,
};

/** Caps how many candidate backtests the model can run per
 * scoreForRiskTolerance call before it's forced to finalize with
 * propose_settings; bounds latency/cost (each extra candidate costs one
 * more Claude turn, though the backtest itself is a free local
 * computation, no LLM involved) while still giving real room to iterate. */
const MAX_BACKTEST_CALLS = 3;

/** Wider than DEFAULT_TIMEOUT_MS: up to MAX_BACKTEST_CALLS + 1 sequential
 * Claude turns can now happen in one call instead of 1. Already a
 * background job (see scoreForRiskTolerance's own doc comment), not a
 * request-path call, so the extra headroom is affordable. */
const SCORE_DEFAULT_TIMEOUT_MS = 120_000;

/** Clamps a run_backtest tool call's raw input into a valid BacktestOptions
 * against the same RANGES propose_settings validates against (see
 * tool.ts). Defensive, not authoritative like validateRiskScoredProposal's
 * throwing checks: this is an internal tool-loop input, so a slightly out-
 * of-range or malformed field from the model should degrade to a clamped
 * or defaulted value and let the loop continue, not abort the whole
 * generation over one bad candidate. ATR/ADX are only enabled when the
 * model actually supplied a finite number for the multiplier/threshold
 * (matching how the real settings form treats "unset" vs. "set to a
 * value"), not merely because it echoed a period. */
function clampCandidate(input: unknown): BacktestOptions {
  const obj = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const num = (key: keyof ProposedSettings, fallback: number): number => {
    const [min, max] = RANGES[key];
    const value = obj[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const options: BacktestOptions = {
    buyConsensus: num('buyConsensus', 2),
    sellConsensus: num('sellConsensus', 3),
    recencyDays: num('recencyDays', 3),
    persistenceBars: num('persistenceBars', 1),
    minHoldingDays: num('minHoldingDays', 0),
  };
  if (typeof obj.atrMultiplier === 'number' && Number.isFinite(obj.atrMultiplier)) {
    options.atrMultiplier = num('atrMultiplier', 2);
    options.atrPeriod = num('atrPeriod', 14);
  }
  if (typeof obj.adxThreshold === 'number' && Number.isFinite(obj.adxThreshold)) {
    options.adxThreshold = num('adxThreshold', 20);
    options.adxPeriod = num('adxPeriod', 14);
  }
  return options;
}

interface BacktestSummary {
  strategyReturnPct: number;
  buyAndHoldReturnPct: number;
  tradeCount: number;
  stillHolding: boolean;
}

/** One candidate the loop actually tried via run_backtest, kept around (not
 * just the compact summary sent back to the model) so a later candidate
 * can be substituted in wholesale, settings and result together, without
 * re-running the backtest. */
interface LoopCandidate {
  options: BacktestOptions;
  result: BacktestResult;
}

/** Minimum improvement in strategyReturnPct (percentage points) an earlier
 * candidate must show over the model's own final proposal before
 * substituteBetterCandidate below will swap it in; guards against
 * substituting over noise between two roughly-equivalent runs. Real gaps
 * this is meant to catch, per this file's investigation notes, have run
 * from tens to (in the zero-trade paralysis case) 1000+ points, so this is
 * a conservative floor, not a hair-trigger. */
const MEANINGFUL_IMPROVEMENT_PCT = 10;

/** Reshapes an already-clamped BacktestOptions (as actually run against
 * `bars`) into the same ProposedSettings shape propose_settings' own
 * `settings` field uses, so a run_backtest candidate can stand in for the
 * model's final proposal directly. Falls back to the same defaults
 * clampCandidate itself uses for an omitted field. */
function candidateAsProposedSettings(options: BacktestOptions): ProposedSettings {
  return {
    buyConsensus: options.buyConsensus ?? 2,
    sellConsensus: options.sellConsensus ?? 3,
    recencyDays: options.recencyDays ?? 3,
    persistenceBars: options.persistenceBars ?? 1,
    minHoldingDays: options.minHoldingDays ?? 0,
    atrMultiplier: options.atrMultiplier ?? null,
    atrPeriod: options.atrPeriod ?? 14,
    adxThreshold: options.adxThreshold ?? null,
    adxPeriod: options.adxPeriod ?? 14,
  };
}

const formatReturnPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Deterministic safety net, not a second opinion from the model: every
 * earlier run_backtest result is already in the conversation by the time
 * the model calls propose_settings, but nothing forces it to actually
 * prefer its own best-performing attempt over a worse later one. This
 * only ever looks at candidates from THIS SAME call -- same ticker, same
 * stated risk tolerance, same system prompt as the final proposal itself
 * -- so it can't cross into a different risk tolerance's settings; a
 * candidate here was generated under exactly the same risk-tolerance
 * framing the final proposal was, not a lesser-trusted one (see this
 * file's system prompt for the risk-tolerance heuristics every candidate
 * is already tuned against). A candidate with zero trades is excluded
 * regardless of its raw return, since sitting in cash the whole window is
 * the paralysis failure mode this loop exists to catch, not a genuine
 * result to prefer. Swaps in silently on the numbers but not on the
 * rationale text: appends a plain note explaining the swap so the
 * displayed rationale never describes settings other than the ones
 * actually shown. */
function substituteBetterCandidate(
  input: unknown,
  finalResult: BacktestResult | null,
  candidates: readonly LoopCandidate[],
): { input: unknown; backtestResult: BacktestResult | null } {
  const usable = candidates.filter((c) => c.result.trades.length > 0);
  if (usable.length === 0) return { input, backtestResult: finalResult };

  const best = usable.reduce((a, b) => (b.result.strategyReturnPct > a.result.strategyReturnPct ? b : a));
  const meaningfullyBetter =
    finalResult === null || best.result.strategyReturnPct >= finalResult.strategyReturnPct + MEANINGFUL_IMPROVEMENT_PCT;
  if (!meaningfullyBetter) return { input, backtestResult: finalResult };

  const obj = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const originalRationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  const previousDescription =
    finalResult === null ? 'the finalized settings, whose own validation run failed' : formatReturnPct(finalResult.strategyReturnPct);
  const note =
    `[Automatic adjustment] An earlier settings combination tested during this analysis performed meaningfully ` +
    `better in backtesting (${formatReturnPct(best.result.strategyReturnPct)} vs. ${previousDescription}) and has ` +
    'been used instead of the settings above.';

  return {
    input: {
      ...obj,
      settings: candidateAsProposedSettings(best.options),
      rationale: originalRationale.length > 0 ? `${originalRationale}\n\n${note}` : note,
    },
    backtestResult: best.result,
  };
}

/** The compact result handed back to the model as a run_backtest tool
 * result: rounded to 1 decimal and without the trade list, since the model
 * only needs enough to decide "keep this or try again," not a full ledger,
 * and every extra field is tokens spent on every remaining turn. */
function summarizeBacktest(result: BacktestResult): BacktestSummary {
  return {
    strategyReturnPct: Math.round(result.strategyReturnPct * 10) / 10,
    buyAndHoldReturnPct: Math.round(result.buyAndHoldReturnPct * 10) / 10,
    tradeCount: result.trades.length,
    stillHolding: result.stillHolding,
  };
}

function buildScoreSystemPrompt(defaultReturnPct: number, buyAndHoldReturnPct: number): string {
  return `You are tuning a technical-analysis trading tool's indicator settings for one
stock, for an investor with a specific, stated risk tolerance. You are given a research brief gathered
separately in an earlier step (itself built as a chain of reasoning: company/industry/political climate and
recent changes, then what would merit success and the consensus sentiment, then the likelihood of success and
the rough upside/downside, then the obstacles in the way and what's changed), and a numbered list of specific
quotes from that research with their sources; no search tool is available here, so work only from what you're
given.

You also have access to run_backtest, which replays a candidate settings combination against this ticker's
actual daily price history over the last 2 years and reports strategyReturnPct, buyAndHoldReturnPct,
tradeCount, and stillHolding. For reference, over this exact window: the tool's plain default policy
(buyConsensus 2, sellConsensus 3, a 3-day recency window, no persistence/minimum-holding/ATR/ADX filters)
returned ${defaultReturnPct}%, and simply buying and holding the whole period returned ${buyAndHoldReturnPct}%.
You must call run_backtest and review its result at least once before finalizing settings with
propose_settings (you may call it up to ${MAX_BACKTEST_CALLS} times total). If a candidate loses money,
produces very few or zero trades, or badly lags the two reference numbers above, that is a sign the settings
are miscalibrated for THIS ticker's actual price history; revise them and check again rather than finalizing
on a losing or non-functional candidate. It is fine, and expected, for your final settings to reasonably
underperform buy-and-hold on a stock the research itself shows is genuinely difficult to time, but they
should not trail the plain default policy above for no good reason.

Investor risk tolerance definitions:
- risk-averse: prefers certainty and will choose the lower-risk option. Protect against losses primarily with
  a TIGHTER ATR multiplier (a closer stop, exits a losing move sooner), with reasonable but not maximal
  confirmation elsewhere. Do not stack buyConsensus=3 with a high persistenceBars (4+) AND a high
  adxThreshold (25+) all at once: verified on real tickers, that combination can jointly prevent the strategy
  from ever entering a position at all over 2 years of real history, which is not "safe," it is non-
  functional. If a candidate produces zero or very few trades, loosen one of those three dials and check
  again.
- risk-neutral: ignores the element of danger and operates only by mathematical payoff. Use moderate, balanced
  settings across all 9 levers, validated the same way as the other two stances.
- risk-seeking: intends fast bets and is comfortable with larger swings for a chance at bigger, quicker gains.
  Express this primarily through a WIDER ATR multiplier (a farther stop, survives more day-to-day noise
  without exiting a real move early) and a SHORTER minHoldingDays, not by dropping buyConsensus/sellConsensus/
  persistenceBars toward their floor. This tool's indicators are a lagging 3-way vote (SMA/MACD/Slow-
  Stochastic), not a tick-level momentum trigger, so loosening confirmation does not make it "catch momentum
  faster"; it mainly means acting on more noise. Verified on real tickers: on a volatile, strongly trending
  stock, minimal consensus/persistence tends to produce frequent small whipsaw trades that erode returns even
  while the stock trends strongly in one direction. Check with run_backtest rather than assuming low
  consensus helps.

Using the research and whichever one of these is stated in the request, you must:
1. Propose specific settings tuned for that risk tolerance, checked with run_backtest as described above.
2. Judge the "fit": whether the STOCK ITSELF, per the research, actually suits that risk tolerance. This is the
   final step of the research's own chain of reasoning (climate → success criteria → likelihood/upside/downside
   → obstacles → overall risk level), independent of how you tuned the settings. Tuning settings defensively
   does not make an unsuitable stock "within-bounds"; judge the company, not the knobs. Reserve
   "caution"/"not-recommended" for a genuine mismatch the research supports (e.g. a risk-averse investor and a
   stock the research shows is unusually volatile, speculative, or driven by frequent, hard-to-predict
   catalysts), not routine market movement.
3. Extract the earnings outlook from the research: the next earnings date if the research gives one, confirmed
   or estimated (resolve an estimated range to its earlier end; null only if the research gives no timing
   indication at all), what would merit success by the next report and over the next year, the consensus
   sentiment, rough upside/downside percentages when the research supports them, and a likelihood assessment
   (low/moderate/high) for whether those expectations will be met, reasoned from the company's historical
   earnings pattern, current industry trends, and any political/regulatory factors the research covers. If the
   date is an estimate rather than officially confirmed, say so in earningsOutlook. If the research doesn't
   cover earnings specifics for this company at all, say so honestly in earningsOutlook rather than inventing
   detail, and reason earningsLikelihood from whatever general volatility/predictability information the
   research does contain.
4. For each of rationale, fitReason, earningsOutlook, and earningsLikelihoodReason, break out 0 or more distinct
   synthesized claims it relies on, in the matching *Claims field (e.g. rationaleClaims for rationale). Each
   claim is your own short takeaway sentence tied to a discrete part of the research's chain (a climate change,
   a success criterion, a likelihood/upside factor, an obstacle), not a restatement of the field's own text,
   paired with which of the numbered research quotes (if any) support it, as citationIndices. A claim can have
   an empty citationIndices array when it's your own reasoning/synthesis rather than something a specific quote
   backs. Only attach a quote to a claim it actually supports; never cite one to pad out a claim, and never
   invent a claim just to have something to cite.

You MUST end by calling propose_settings exactly once, as your final action, with a rationale, the settings,
the fit verdict + its reason, the earnings outlook fields, and the claims fields. Do not give your answer as
plain text.`;
}

const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
  averse: 'risk-averse',
  neutral: 'risk-neutral',
  seeking: 'risk-seeking',
};

/** Formats research quotes as a numbered list for the scoring prompt, e.g.
 * `[0] "Google Cloud grew 34% YoY..." (sources: Reuters, Bloomberg)`.
 * Claude references these back by index in its own claims' citationIndices;
 * it never needs to reproduce the URL itself, so this stays compact. Empty
 * string (not an empty list rendering) when there are no quotes, so the
 * prompt doesn't dangle an empty header. */
function formatCitationsList(citations: readonly ResearchQuote[]): string {
  if (citations.length === 0) return '(no specific sourced quotes available)';
  return citations
    .map((c, i) => `[${i}] "${c.quote}" (sources: ${c.sources.map((s) => s.title).join(', ')})`)
    .join('\n');
}

/** Scores an already-researched company against one investor risk
 * tolerance: proposes tuned settings, judges whether the stock itself
 * suits that stance, and extracts an earnings outlook. Stage 2 of 2 (see
 * researchCompany); no search. Unlike stage 1, this now IS a short
 * agentic loop, not a single forced call: the model must validate its own
 * candidate settings against `bars` via the run_backtest tool at least
 * once (and up to MAX_BACKTEST_CALLS times) before finalizing with
 * propose_settings, so a settings combination that would have lost money
 * or never traded at all gets caught before it's ever shown to a user,
 * not after (see this file's investigation-driven prompt additions in
 * buildScoreSystemPrompt). `bars` is fetched once by the caller (the same
 * 2-year daily history Historical Testing itself uses) and passed in
 * rather than fetched here, so a caller scoring the same ticker across
 * multiple risk tolerances only pays for one fetch. */
export async function scoreForRiskTolerance(
  ticker: string,
  research: ResearchProposal,
  riskTolerance: RiskTolerance,
  bars: readonly Bar[],
  options: ScoreOptions = {},
): Promise<RiskScoredProposal> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? SCORE_DEFAULT_TIMEOUT_MS;
  const client = buildClaudeClient(options);
  const onStage = options.onStage;

  const work = (async () => {
    onStage?.(`Consolidating research and price history for ${ticker}…`);
    const reference = runBacktest(ticker, bars, DEFAULT_BACKTEST_SETTINGS);
    const systemPrompt = buildScoreSystemPrompt(
      Math.round(reference.strategyReturnPct * 10) / 10,
      Math.round(reference.buyAndHoldReturnPct * 10) / 10,
    );

    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      {
        role: 'user',
        content:
          `Research on ${ticker}:\n${research.research}\n\n` +
          `Numbered source citations for the research above:\n${formatCitationsList(research.citations)}\n\n` +
          `Investor risk tolerance: ${RISK_TOLERANCE_LABELS[riskTolerance]}\n\n` +
          'Propose settings and judge fit. Remember to validate with run_backtest before finalizing.',
      },
    ];

    let backtestCallsUsed = 0;
    let proposal: { id: string; input: unknown } | undefined;
    const candidates: LoopCandidate[] = [];

    while (!proposal) {
      const atCap = backtestCallsUsed >= MAX_BACKTEST_CALLS;
      const mustBacktestFirst = backtestCallsUsed === 0;
      const response = await createClaudeMessage(client, {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: atCap ? [PROPOSE_SETTINGS_TOOL] : [PROPOSE_SETTINGS_TOOL, RUN_BACKTEST_TOOL],
        tool_choice: atCap
          ? { type: 'tool', name: 'propose_settings' }
          : mustBacktestFirst
            ? { type: 'tool', name: 'run_backtest' }
            : { type: 'auto' },
        messages,
      });

      // propose_settings is only ever honored once at least one real
      // backtest validation has happened; on the first turn tool_choice is
      // forced to run_backtest specifically so this shouldn't come up, but
      // checking it here too means a proposal offered before any
      // validation is defense-in-depth, not something this function trusts
      // the API to have enforced on its own.
      if (!mustBacktestFirst) {
        const finalCall = findToolUse(response.content, 'propose_settings');
        if (finalCall) {
          proposal = finalCall;
          break;
        }
      }

      const backtestCall = findToolUse(response.content, 'run_backtest');
      if (!backtestCall) {
        // Neither tool was forced here (tool_choice: 'auto'), so this would
        // mean the model responded with plain text instead of a tool call;
        // reaching this with a forced tool_choice would mean the API
        // itself misbehaved.
        throw new Error('scoreForRiskTolerance: model response contained neither run_backtest nor propose_settings');
      }

      backtestCallsUsed++;
      onStage?.(`Running ${backtestCallOrdinal(backtestCallsUsed)} historical simulation to test candidate parameters…`);
      const clampedOptions = clampCandidate(backtestCall.input);
      const candidateResult = runBacktest(ticker, bars, clampedOptions);
      candidates.push({ options: clampedOptions, result: candidateResult });
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: backtestCall.id,
            content: JSON.stringify(summarizeBacktest(candidateResult)),
          },
        ],
      });
    }

    onStage?.(`Finalizing the suggestion for ${ticker}…`);
    let finalBacktestResult: BacktestResult | null;
    try {
      const settingsInput = (proposal.input as { settings?: unknown }).settings;
      finalBacktestResult = runBacktest(ticker, bars, clampCandidate(settingsInput));
    } catch {
      finalBacktestResult = null;
    }

    const finalized = substituteBetterCandidate(proposal.input, finalBacktestResult, candidates);
    const finalizedInput = finalized.input as Record<string, unknown>;
    const validatedEarningsDate = await validateEarningsDate(
      ticker,
      {
        date: typeof finalizedInput.nextEarningsDate === 'string' ? finalizedInput.nextEarningsDate : null,
        sourceDomain: typeof finalizedInput.nextEarningsDateSource === 'string' ? finalizedInput.nextEarningsDateSource : null,
      },
      new Date(),
      options,
      options.earningsDateGeminiOptions ?? {},
    );
    const inputWithValidatedEarningsDate = { ...finalizedInput, nextEarningsDate: validatedEarningsDate };

    return validateRiskScoredProposal(inputWithValidatedEarningsDate, research.citations, finalized.backtestResult);
  })();

  return withWallClock(work, timeoutMs);
}
