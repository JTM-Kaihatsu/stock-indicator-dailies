import type { Page } from 'playwright';

/**
 * Pixel-level backstop against a promo pop-up that `hasVisiblePopup`
 * (tradingview-agent.ts) missed because its markup didn't match any known
 * selector — exactly the failure mode behind a live "End of Summer sale"
 * modal that reached a real report. `dismissPopups`/`hasVisiblePopup` are
 * DOM-selector-based, an inherent arms race with TradingView's build-hashed,
 * ever-changing class names; this is a second, independent line of defense
 * that doesn't care what the popup's markup looks like, only what it looks
 * like on screen.
 *
 * The account's saved layout is always the same light TradingView theme, so
 * a clean capture has a very stable signature: mostly white/near-white
 * background (candles, grid lines, and text are a small minority of the
 * pixel area). Measured directly against real, popup-free captures across
 * five tickers (NVDA, MSFT, TSLA, GOOGL, META): average luminance
 * ~244-246/255, and the near-black pixel fraction is effectively zero
 * (0-0.16%). A promo modal is the opposite of that — a large, solid, dark
 * rectangle — and even a modest simulated one covering ~18% of the frame
 * moved the near-black fraction to ~18% and dropped average luminance to
 * ~200; the thresholds below sit with wide margin on both sides of that gap.
 */
export const DARK_PIXEL_FRACTION_THRESHOLD = 0.05; // baseline ~0%, a small popup already hits ~18%
export const AVG_LUMINANCE_THRESHOLD = 220; // baseline ~244-246

export interface PixelProfile {
  avgLuminance: number;
  darkFraction: number;
}

/** Pure decision on already-measured stats; kept separate from the
 * browser-dependent pixel sampling below so it's unit-testable without a
 * real Page (this package's tests never launch a real browser). */
export function isSuspiciousPixelProfile(stats: PixelProfile): boolean {
  return stats.darkFraction > DARK_PIXEL_FRACTION_THRESHOLD || stats.avgLuminance < AVG_LUMINANCE_THRESHOLD;
}

// Same "reach the DOM through globalThis" pattern as readLegendTexts in
// tradingview-agent.ts: this package's tsconfig has no "DOM" lib (its
// sources ship as plain TypeScript with no browser assumption), so
// browser-only types like HTMLImageElement/CanvasRenderingContext2D aren't
// available; a narrow structural type covering just what's used here stands
// in.
interface PageGlobals {
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
}

/**
 * Decodes the already-captured PNG in-page via a plain `<canvas>` (no
 * image-processing dependency needed), downsamples for speed, and samples
 * per-pixel luminance to decide whether the frame looks like it has a large
 * anomalous dark region over it.
 */
export async function looksLikePopupOverlay(page: Page, base64Png: string): Promise<boolean> {
  try {
    const stats = await page.evaluate(async (b64) => {
      const { document: doc, Image } = globalThis as unknown as PageGlobals;
      const img = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image decode failed'));
      });
      img.src = `data:image/png;base64,${b64}`;
      await loaded;

      const canvas = doc.createElement('canvas');
      const width = 160; // downsampled; only aggregate stats are needed, not pixel-perfect detail
      const height = Math.max(1, Math.round((width * img.height) / img.width));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);

      let luminanceSum = 0;
      let darkCount = 0;
      const pixelCount = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        luminanceSum += 0.299 * r + 0.587 * g + 0.114 * b;
        if (r < 40 && g < 40 && b < 40) darkCount++;
      }
      return { avgLuminance: luminanceSum / pixelCount, darkFraction: darkCount / pixelCount };
    }, base64Png);

    return isSuspiciousPixelProfile(stats);
  } catch {
    // Decode/measure failure isn't evidence of a popup either way; don't
    // fail a capture over a diagnostic check that itself broke.
    return false;
  }
}
