import { describe, expect, it } from 'vitest';
import { startCommittedTask } from '../core/runtime/committed-task';

const immediateScheduler = <T>(operation: () => Promise<T>): Promise<T> => operation();

describe('committed task', () => {
  it('keeps the committed barrier pending until the commit succeeds', async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let committed = false;
    let maintenanceStarted = false;
    const task = startCommittedTask(
      immediateScheduler,
      () => commitGate,
      async () => {
        maintenanceStarted = true;
        return 'done';
      },
    );
    void task.committed.then(() => { committed = true; });

    await Promise.resolve();
    await Promise.resolve();
    expect(committed).toBe(false);
    expect(maintenanceStarted).toBe(false);

    releaseCommit();
    await task.committed;
    expect(committed).toBe(true);
    await expect(task.finished).resolves.toBe('done');
  });

  it('rejects the barrier and skips maintenance when the commit fails', async () => {
    let maintenanceStarted = false;
    const task = startCommittedTask(
      immediateScheduler,
      async () => { throw new Error('commit failed'); },
      async () => {
        maintenanceStarted = true;
        return 'unreachable';
      },
    );

    await expect(task.committed).rejects.toThrow('commit failed');
    await expect(task.finished).rejects.toThrow('commit failed');
    expect(maintenanceStarted).toBe(false);
  });

  it('releases the barrier before slow maintenance finishes', async () => {
    let releaseMaintenance!: () => void;
    const maintenanceGate = new Promise<void>((resolve) => { releaseMaintenance = resolve; });
    let finished = false;
    const task = startCommittedTask(
      immediateScheduler,
      async () => undefined,
      async () => {
        await maintenanceGate;
        return 42;
      },
    );
    void task.finished.then(() => { finished = true; });

    await task.committed;
    expect(finished).toBe(false);
    releaseMaintenance();
    await expect(task.finished).resolves.toBe(42);
  });
});
