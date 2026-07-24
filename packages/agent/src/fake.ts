import type { ChartImage } from '@stock-indicator-dailies/shared';

import { ChartAcquisitionError, type ChartAcquisitionFailure, type ChartAgent } from './agent.ts';

/** A 1x1 PNG — enough to stand in for a chart in tests. */
export const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export interface FakeChartAgentOptions {
  image?: ChartImage;
  /** When set, `acquire` rejects with this failure instead of returning. */
  failWith?: ChartAcquisitionFailure;
}

/**
 * In-memory {@link ChartAgent} for tests and for wiring the pipeline without a
 * browser. Records every ticker it was asked for.
 */
export class FakeChartAgent implements ChartAgent {
  readonly name = 'fake';
  readonly requested: string[] = [];
  readonly #image: ChartImage;
  readonly #failWith: ChartAcquisitionFailure | undefined;

  constructor(options: FakeChartAgentOptions = {}) {
    this.#image = options.image ?? { base64: PLACEHOLDER_PNG_BASE64, mediaType: 'image/png' };
    this.#failWith = options.failWith;
  }

  async acquire(ticker: string): Promise<ChartImage> {
    this.requested.push(ticker);
    if (this.#failWith) {
      throw new ChartAcquisitionError(this.#failWith, `fake agent configured to fail: ${this.#failWith}`);
    }
    return this.#image;
  }
}
