import type { Page } from 'playwright';

/**
 * Pixel-level backstop against a pane whose legend *claims* a value but
 * whose plotted lines never actually painted — the failure mode behind a
 * live report where MACD and Slow Stochastic both showed real, finite
 * legend values (so `validateStudies` — studies.ts, DOM-text-based —
 * correctly reported them as "found, rendered") while their panes were
 * visually blank in the captured image. `validateStudies` has no way to
 * catch this: it only ever reads legend *text*, and TradingView had
 * decoupled that text updating from the canvas actually repainting for
 * that one capture. A second recapture came back perfectly rendered, so
 * this is a transient TradingView glitch, not a persistent bug — but with
 * nothing to detect it, a broken capture like that one reaches the VLM (and
 * a real report) undetected.
 *
 * Same tool as pixel-popup.ts (decode the already-captured PNG in-page via
 * a plain `<canvas>`), pointed at the opposite question: instead of "is
 * there unexpected content where there shouldn't be" (a popup), "is the
 * expected content actually there" (the plotted lines). The chart's fixed,
 * one-time-configured layout always renders the BLUE (faster) and ORANGE
 * (slower signal) lines in the same colors — confirmed live across three
 * tickers (AVGO, NVDA, TSLA): a real, painted MACD or Stochastic pane has
 * ~1500-3000+ pixels within a tight tolerance of blue (~45,101,255) or
 * orange (~255,111,4); a blank pane has none. `MIN_PLOT_PIXELS` sits with
 * wide margin below that range.
 */
export const MIN_PLOT_PIXELS = 50;

const BLUE_TARGET: readonly [number, number, number] = [45, 101, 255];
const ORANGE_TARGET: readonly [number, number, number] = [255, 111, 4];
const COLOR_TOLERANCE = 30;

/** Pure and unit-testable: whether a pane's sampled pixel counts indicate
 * its lines never actually painted, despite whatever the legend claims. */
export function isPaneUnpainted(bluePixelCount: number, orangePixelCount: number): boolean {
  return bluePixelCount < MIN_PLOT_PIXELS || orangePixelCount < MIN_PLOT_PIXELS;
}

export interface PaneBounds {
  /** CSS-pixel Y bounds, relative to the chart container's own top edge —
   * the same coordinate space `chart.screenshot()` captures. */
  top: number;
  bottom: number;
}

interface PageGlobals {
  document: {
    querySelector(selector: string): {
      getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number };
      querySelectorAll(selector: string): Iterable<{
        getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number };
      }>;
    } | null;
  };
}

/**
 * The chart's content panes (price, then each indicator sub-pane below it),
 * top to bottom, excluding the trailing time-axis strip. Derived from the
 * chart's own `<canvas>` elements rather than any legend/DOM-text position:
 * confirmed live that those elements only lay out on hover (zero-size
 * otherwise), while canvases are always present and — across every ticker
 * checked — land at identical Y-bounds every time, since pane height is a
 * fixed layout setting, not data-dependent.
 *
 * A canvas pane renders as two co-located elements (the plot itself and its
 * price-scale strip); grouping by (top, bottom) collapses each pane — plot
 * and scale share the same vertical span — to one entry regardless of that
 * duplication, without needing to distinguish them by width.
 */
export async function getContentPaneBounds(page: Page, chartSelector: string): Promise<PaneBounds[]> {
  const bands = await page.evaluate((selector) => {
    const { document: doc } = globalThis as unknown as PageGlobals;
    const chart = doc.querySelector(selector);
    if (!chart) return [];
    const chartRect = chart.getBoundingClientRect();

    const seen = new Set<string>();
    const result: PaneBounds[] = [];
    for (const canvas of chart.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect();
      const top = Math.round(rect.top - chartRect.top);
      const bottom = Math.round(rect.bottom - chartRect.top);
      const key = `${top},${bottom}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ top, bottom });
    }
    result.sort((a, b) => a.top - b.top);
    return result;
  }, chartSelector);

  if (bands.length < 2) return bands;
  // The trailing time-axis strip is always the shortest band by a wide
  // margin (a label row, not a plot); drop it rather than treating it as a
  // content pane.
  const heights = bands.map((b) => b.bottom - b.top);
  const maxHeight = Math.max(...heights);
  return bands.filter((b) => b.bottom - b.top > maxHeight * 0.4);
}

interface CanvasGlobals {
  document: {
    createElement(tag: 'canvas'): {
      width: number;
      height: number;
      getContext(kind: '2d'): {
        drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
        getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
      };
    };
  };
  Image: new () => {
    onload: (() => void) | null;
    onerror: (() => void) | null;
    src: string;
    width: number;
    height: number;
  };
  setTimeout(fn: () => void, ms: number): unknown;
}

/**
 * For each given pane's CSS-pixel bounds, counts how many pixels within it
 * are near-blue or near-orange, and reports whether that pane looks
 * unpainted. `chartCssHeight` scales the CSS-pixel pane bounds to the
 * decoded image's own pixel dimensions (equal 1:1 at the default
 * `deviceScaleFactor`, but this stays correct if that's ever raised).
 *
 * Excludes the top ~15% of each pane (the hover-icon row sits there; empty
 * of plot pixels even when painted, so including it would just dilute the
 * count, not change the pass/fail call either way) and a small right-edge
 * margin (defense-in-depth against a stray colored badge, even though pane
 * bounds are already the plot-only canvas, not the price-scale strip).
 */
export async function findUnpaintedPanes(
  page: Page,
  base64Png: string,
  panes: readonly PaneBounds[],
  chartCssHeight: number,
): Promise<boolean[]> {
  if (panes.length === 0) return [];

  try {
    return await page.evaluate(
      async ({ b64, panes, chartCssHeight, blueTarget, orangeTarget, tolerance, minPlotPixels }) => {
        const { document: doc, Image, setTimeout: pageSetTimeout } = globalThis as unknown as CanvasGlobals;
        const img = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image decode failed'));
        });
        img.src = `data:image/png;base64,${b64}`;
        // Same hard ceiling as pixel-popup.ts's looksLikePopupOverlay, and
        // for the same reason: page.evaluate has no timeout of its own.
        const timedOut = new Promise<void>((_, reject) => {
          pageSetTimeout(() => reject(new Error('image decode timed out')), 5000);
        });
        await Promise.race([loaded, timedOut]);

        const canvas = doc.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, img.width, img.height);

        const scale = img.height / chartCssHeight;
        const nearColor = (r: number, g: number, b: number, target: [number, number, number]) =>
          Math.abs(r - target[0]) < tolerance && Math.abs(g - target[1]) < tolerance && Math.abs(b - target[2]) < tolerance;

        return panes.map(({ top, bottom }) => {
          const height = bottom - top;
          const y0 = Math.round((top + height * 0.15) * scale);
          const y1 = Math.round(bottom * scale);
          const x0 = 0;
          const x1 = Math.round(img.width * 0.92);
          if (y1 <= y0 || x1 <= x0) return false; // degenerate bounds; not evidence either way

          const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
          let blueCount = 0;
          let orangeCount = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]!;
            const g = data[i + 1]!;
            const b = data[i + 2]!;
            if (nearColor(r, g, b, blueTarget)) blueCount++;
            else if (nearColor(r, g, b, orangeTarget)) orangeCount++;
          }
          return blueCount < minPlotPixels || orangeCount < minPlotPixels;
        });
      },
      {
        b64: base64Png,
        panes: panes as PaneBounds[],
        chartCssHeight,
        blueTarget: BLUE_TARGET as [number, number, number],
        orangeTarget: ORANGE_TARGET as [number, number, number],
        tolerance: COLOR_TOLERANCE,
        minPlotPixels: MIN_PLOT_PIXELS,
      },
    );
  } catch {
    // Decode/measure failure isn't evidence either way; don't fail a
    // capture over a diagnostic check that itself broke.
    return panes.map(() => false);
  }
}
