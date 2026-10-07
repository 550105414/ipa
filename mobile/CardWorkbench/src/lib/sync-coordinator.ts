/**
 * Coalesce concurrent requests without losing a request made during an active
 * pass. Every extra request causes a fresh pass over the latest local data.
 * A failed pass is retried only when another request was already queued; a
 * persistent outage never creates an automatic, unbounded retry loop.
 */
export function createSyncCoordinator<T>(perform: () => Promise<T>) {
  let requestedRevision = 0;
  let running: Promise<T> | null = null;

  return function requestSync(): Promise<T> {
    requestedRevision += 1;
    if (running) return running;

    const drain = async (): Promise<T> => {
      while (true) {
        const revision = requestedRevision;
        try {
          const result = await perform();
          if (revision === requestedRevision) {
            // Release in this same continuation, before resolving the shared
            // promise. A request in the next microtask must start a new pass.
            running = null;
            return result;
          }
        } catch (error) {
          if (revision === requestedRevision) {
            running = null;
            throw error;
          }
        }
      }
    };

    // Defer starting the pass until running is assigned, even if perform
    // throws synchronously before returning its first promise.
    const operation = Promise.resolve().then(drain);
    running = operation;
    return operation;
  };
}
