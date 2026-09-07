import type { ChartImage as ChartImageType } from '@stock-indicator-dailies/shared';

export function ChartImage({ image, ticker }: { image: ChartImageType; ticker: string }) {
  return (
    <section>
      <div className="section-label">Source chart</div>
      <div style={{ color: 'var(--faint)', fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        The charts displayed are in the following order: SMA (10-day), MACD (8, 17, 9), and Slow
        Stochastic (14, 5, 3).
      </div>
      <figure>
        <img
          className="chart-img"
          alt={`${ticker} daily chart`}
          src={`data:${image.mediaType};base64,${image.base64}`}
        />
        <figcaption style={{ color: 'var(--faint)', fontSize: 12, marginTop: 8 }}>
          Captured from TradingView, cropped to the chart region. Verify the reads against it.
        </figcaption>
      </figure>
    </section>
  );
}
