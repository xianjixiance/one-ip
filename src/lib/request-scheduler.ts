/** Shared, abortable FIFO. The request's timeout starts after admission. */
export function createRequestScheduler(limit = 6) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function schedule<T>(
    run: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const admit = () => {
        signal.removeEventListener("abort", abort);
        active++;
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(admit);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (active < limit) admit();
      else {
        waiting.push(admit);
        signal.addEventListener("abort", abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await run();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
