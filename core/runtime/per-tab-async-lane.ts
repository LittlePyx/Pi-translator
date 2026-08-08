export type PerTabAsyncOperation<T> = () => Promise<T> | T;

export type PerTabAsyncLane = <T>(
  tabId: number,
  operation: PerTabAsyncOperation<T>,
) => Promise<T>;

/**
 * Creates an independent serial lane for each tab.
 *
 * Callers pass an operation factory rather than an already-created promise so
 * queued work cannot begin before the preceding operation has settled. A
 * failure only rejects that operation; later work for the tab still runs.
 */
export function createPerTabAsyncLane(): PerTabAsyncLane {
  const tails = new Map<number, Promise<void>>();

  return <T>(tabId: number, operation: PerTabAsyncOperation<T>): Promise<T> => {
    const previous = tails.get(tabId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(tabId, settled);
    void settled.then(() => {
      if (tails.get(tabId) === settled) tails.delete(tabId);
    });
    return result;
  };
}
