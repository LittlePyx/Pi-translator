export function createSerialTaskRunner(
  task: () => Promise<void>,
): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return () => {
    const next = tail.catch(() => undefined).then(task);
    tail = next;
    return next;
  };
}
