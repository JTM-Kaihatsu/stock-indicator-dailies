/**
 * Serializes async work: each call to `run` waits for every previously
 * queued call to settle before starting. Mirrors the inline queue in
 * apps/api/src/pipeline.ts (needed there, and here, because
 * TradingViewChartAgent drives a single browser session against one
 * on-disk profile dir; two concurrent captures would collide), factored
 * out so it's unit-testable independent of the MCP transport.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    // Swallow so one failed run doesn't wedge the chain for whoever's behind it.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
