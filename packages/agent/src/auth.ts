/**
 * Auth detection.
 *
 * We check for the provider's session cookie rather than probing the DOM: a
 * rendered chart proves nothing (TradingView serves charts anonymously), and
 * header markup changes far more often than the auth cookie name.
 *
 * Cookie *values* are secrets — this module only ever inspects names/domains
 * and must never log or return a value.
 */

/** Minimal shape of the cookies we inspect. */
export interface CookieLike {
  name: string;
  domain: string;
}

/** Anything that can hand back cookies (a Playwright BrowserContext does). */
export interface CookieSource {
  cookies(): Promise<CookieLike[]>;
}

/** TradingView marks an authenticated session with `sessionid` / `sessionid_sign`. */
export const AUTH_COOKIE_PATTERN = /^sessionid/;
export const DEFAULT_AUTH_DOMAIN = 'tradingview';

/** True when the cookie jar contains a provider auth cookie. */
export function hasAuthCookie(
  cookies: readonly CookieLike[],
  domainMatch: string = DEFAULT_AUTH_DOMAIN,
): boolean {
  return cookies.some(
    (c) => c.domain.includes(domainMatch) && AUTH_COOKIE_PATTERN.test(c.name),
  );
}

/** Async convenience over a browser context. */
export async function hasAuthSession(
  source: CookieSource,
  domainMatch: string = DEFAULT_AUTH_DOMAIN,
): Promise<boolean> {
  return hasAuthCookie(await source.cookies(), domainMatch);
}
