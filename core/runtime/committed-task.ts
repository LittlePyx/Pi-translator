export interface CommittedTask<T> {
  /** Resolves as soon as the authoritative commit succeeds. */
  committed: Promise<void>;
  /** Resolves after best-effort maintenance following the commit settles. */
  finished: Promise<T>;
}

export type CommittedTaskScheduler = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * Runs an authoritative commit and its follow-up maintenance in one scheduler
 * lane, while exposing a barrier that does not wait for slow maintenance.
 *
 * This lets callers publish a completed UI state immediately after durable
 * state is committed, without publishing it before the commit can fail.
 */
export function startCommittedTask<T>(
  schedule: CommittedTaskScheduler,
  commit: () => Promise<void>,
  maintenance: () => Promise<T>,
): CommittedTask<T> {
  let resolveCommitted!: () => void;
  let rejectCommitted!: (reason?: unknown) => void;
  const committed = new Promise<void>((resolve, reject) => {
    resolveCommitted = resolve;
    rejectCommitted = reject;
  });

  const finished = Promise.resolve().then(() => schedule(async () => {
    try {
      await commit();
      resolveCommitted();
    } catch (error) {
      rejectCommitted(error);
      throw error;
    }
    return maintenance();
  }));

  // A scheduler failure before the operation begins must also release the
  // commit barrier. Attaching handlers here prevents delayed callers from
  // producing transient unhandled-rejection reports.
  void finished.catch(rejectCommitted);
  void committed.catch(() => undefined);
  void finished.catch(() => undefined);

  return { committed, finished };
}
