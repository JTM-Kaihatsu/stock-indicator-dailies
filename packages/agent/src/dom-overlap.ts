import type { Page } from 'playwright';

/**
 * Geometry-based backstop against an undetected popup, independent of both
 * `hasVisiblePopup`'s DOM-selector matching (tradingview-agent.ts) and
 * `looksLikePopupOverlay`'s pixel-color heuristic (pixel-popup.ts).
 *
 * Neither of those two catches everything: selectors are an inherent arms
 * race with TradingView's build-hashed, ever-changing class names (a real
 * "End of Summer sale" toast got through because its markup didn't match
 * any known one), and the pixel check only works for a *dark* overlay — a
 * white-background modal (TradingView shows those too, e.g. an "upgrade
 * your plan" dialog) blends into the chart's own light theme and moves
 * neither the average luminance nor the near-black pixel fraction.
 *
 * This one doesn't care what a popup looks like, what it's classed as, or
 * what color it is — only whether *some element outside the chart* is
 * geometrically sitting on top of it. Verified live: a real capture across
 * ten tickers finds zero qualifying elements (perfectly clean baseline); a
 * `<div>` injected over the chart to simulate a large centered modal *or* a
 * small corner toast is both correctly the only thing flagged, at 28% and
 * 5% overlap respectively.
 */
const OVERLAP_FRACTION_THRESHOLD = 0.02; // baseline is exactly 0; a small corner toast alone already measures ~5%

/**
 * Always-present TradingView layout/chrome elements that legitimately span
 * (part of) the chart's own bounding box — wrappers, panel borders, the
 * always-in-the-DOM (but usually empty) toast layer, a sidebar's scroll
 * container. Confirmed live: present with these exact class-name fragments
 * on every single capture, popup or not, so they're excluded by name rather
 * than by trying to out-guess every legitimate chrome element by geometry.
 * `toastLayerChart`/`toastList` in particular is deliberately excluded here
 * even though it's the class the earlier toast-hiding fix targets — it's
 * always in the DOM (empty div, zero visible content, matching this
 * function's own visibility check would already exclude it when empty) but
 * kept in the denylist for defense-in-depth, since that layer already has
 * its own dedicated, more scoped check.
 */
const STRUCTURAL_CLASS_DENYLIST = ['js-rootresizer', 'panel-', 'layout__area', 'toastLayerChart', 'toastList', 'scrollWrap'];

/** Pure and unit-testable: whether a className string matches one of the
 * known-safe structural chrome patterns above. */
export function isKnownStructuralElement(className: string): boolean {
  return STRUCTURAL_CLASS_DENYLIST.some((pattern) => className.includes(pattern));
}

interface PageGlobals {
  document: {
    querySelectorAll(selector: string): Iterable<{
      className: string;
      tagName: string;
      getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number };
      contains(other: unknown): boolean;
    }>;
    querySelector(selector: string): {
      getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number };
      contains(other: unknown): boolean;
    } | null;
  };
  getComputedStyle(el: unknown): { display: string; visibility: string; opacity: string };
}

/** Whether any element outside the chart container is currently sitting
 * visibly on top of a meaningful fraction of it, and isn't one of the
 * always-present structural elements above. */
export async function hasForeignOverlayOverChart(page: Page, chartSelector: string): Promise<boolean> {
  try {
    return await page.evaluate(
      ({ selector, threshold, denylist }) => {
        const { document: doc, getComputedStyle } = globalThis as unknown as PageGlobals;
        const chart = doc.querySelector(selector);
        if (!chart) return false;
        const chartRect = chart.getBoundingClientRect();
        const chartArea = chartRect.width * chartRect.height;
        if (chartArea <= 0) return false;

        for (const el of doc.querySelectorAll('body *')) {
          if (chart.contains(el) || el === (chart as unknown)) continue;
          const className = typeof el.className === 'string' ? el.className : '';
          if (denylist.some((pattern) => className.includes(pattern))) continue;

          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const ix = Math.max(0, Math.min(rect.right, chartRect.right) - Math.max(rect.left, chartRect.left));
          const iy = Math.max(0, Math.min(rect.bottom, chartRect.bottom) - Math.max(rect.top, chartRect.top));
          if ((ix * iy) / chartArea > threshold) return true;
        }
        return false;
      },
      { selector: chartSelector, threshold: OVERLAP_FRACTION_THRESHOLD, denylist: STRUCTURAL_CLASS_DENYLIST },
    );
  } catch {
    // Same posture as looksLikePopupOverlay: a broken diagnostic check isn't
    // evidence of a popup either way.
    return false;
  }
}
