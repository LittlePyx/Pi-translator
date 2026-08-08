import { describe, expect, it } from 'vitest';
import { createPerTabAsyncLane } from '../core/runtime/per-tab-async-lane';

describe('per-tab async lane', () => {
  it('does not create queued operations until their turn begins', async () => {
    const run = createPerTabAsyncLane();
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    let firstCreated = false;
    let secondCreated = false;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

    const first = run(7, async () => {
      firstCreated = true;
      markFirstStarted?.();
      await firstGate;
      return 'first';
    });
    const second = run(7, async () => {
      secondCreated = true;
      return 2;
    });

    expect(firstCreated).toBe(false);
    expect(secondCreated).toBe(false);
    await firstStarted;
    expect(firstCreated).toBe(true);
    expect(secondCreated).toBe(false);
    releaseFirst?.();

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe(2);
    expect(secondCreated).toBe(true);
  });

  it('lets different tabs proceed independently', async () => {
    const run = createPerTabAsyncLane();
    let releaseTabOne: (() => void) | undefined;
    let markTabOneStarted: (() => void) | undefined;
    const tabOneGate = new Promise<void>((resolve) => { releaseTabOne = resolve; });
    const tabOneStarted = new Promise<void>((resolve) => { markTabOneStarted = resolve; });

    const tabOne = run(1, async () => {
      markTabOneStarted?.();
      await tabOneGate;
      return 'one';
    });
    await tabOneStarted;

    await expect(run(2, async () => 'two')).resolves.toBe('two');
    releaseTabOne?.();
    await expect(tabOne).resolves.toBe('one');
  });

  it('continues a tab lane after an operation fails', async () => {
    const run = createPerTabAsyncLane();
    await expect(run(3, async () => {
      throw new Error('first failure');
    })).rejects.toThrow('first failure');
    await expect(run(3, async () => 'recovered')).resolves.toBe('recovered');
  });
});
