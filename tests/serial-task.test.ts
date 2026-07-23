import { describe, expect, it } from 'vitest';
import { createSerialTaskRunner } from '../core/runtime/serial-task';

describe('serial task runner', () => {
  it('runs overlapping requests one at a time', async () => {
    const order: string[] = [];
    let call = 0;
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const run = createSerialTaskRunner(async () => {
      call += 1;
      const current = call;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(`start-${current}`);
      if (current === 1) {
        markFirstStarted?.();
        await firstGate;
      }
      order.push(`end-${current}`);
      active -= 1;
    });

    const first = run();
    const second = run();
    await firstStarted;
    expect(order).toEqual(['start-1']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('continues after a previous task fails', async () => {
    let calls = 0;
    const run = createSerialTaskRunner(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first failure');
    });

    await expect(run()).rejects.toThrow('first failure');
    await expect(run()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
