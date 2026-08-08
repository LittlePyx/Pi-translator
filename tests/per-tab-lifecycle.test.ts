import { describe, expect, it } from 'vitest';
import { createPerTabLifecycle } from '../core/runtime/per-tab-lifecycle';

describe('per-tab lifecycle', () => {
  it('prevents work closed before its controller is created', async () => {
    const lifecycle = createPerTabLifecycle();
    const token = lifecycle.capture(7);
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    let controllersCreated = 0;

    const beginAfterBarrier = (async () => {
      await barrier;
      if (!lifecycle.isCurrent(token)) return false;
      controllersCreated += 1;
      return true;
    })();

    lifecycle.close(7);
    releaseBarrier?.();

    await expect(beginAfterBarrier).resolves.toBe(false);
    expect(controllersCreated).toBe(0);
  });

  it('invalidates an old navigation token while allowing a new generation', () => {
    const lifecycle = createPerTabLifecycle();
    const beforeNavigation = lifecycle.capture(4);

    lifecycle.invalidate(4);
    const afterNavigation = lifecycle.capture(4);

    expect(lifecycle.isCurrent(beforeNavigation)).toBe(false);
    expect(lifecycle.isCurrent(afterNavigation)).toBe(true);

    lifecycle.invalidate(4);
    const afterLaterNavigation = lifecycle.capture(4);
    expect(lifecycle.isCurrent(afterNavigation)).toBe(false);
    expect(lifecycle.isCurrent(afterLaterNavigation)).toBe(true);
  });

  it('keeps a closed tab tombstoned until an explicit reopen', () => {
    const lifecycle = createPerTabLifecycle();
    const oldToken = lifecycle.capture(11);

    lifecycle.close(11);
    lifecycle.invalidate(11);

    expect(lifecycle.isCurrent(oldToken)).toBe(false);
    expect(lifecycle.capture(11)).toBeUndefined();

    lifecycle.reopen(11);
    const reusedTabToken = lifecycle.capture(11);
    expect(lifecycle.isCurrent(oldToken)).toBe(false);
    expect(lifecycle.isCurrent(reusedTabToken)).toBe(true);

    lifecycle.invalidate(11);
    const navigatedReusedTabToken = lifecycle.capture(11);
    expect(lifecycle.isCurrent(reusedTabToken)).toBe(false);
    expect(lifecycle.isCurrent(navigatedReusedTabToken)).toBe(true);
  });

  it('isolates invalidation and close state between tabs', () => {
    const lifecycle = createPerTabLifecycle();
    const tabOne = lifecycle.capture(1);
    const tabTwo = lifecycle.capture(2);

    lifecycle.invalidate(1);
    expect(lifecycle.isCurrent(tabOne)).toBe(false);
    expect(lifecycle.isCurrent(tabTwo)).toBe(true);

    lifecycle.close(2);
    const nextTabOne = lifecycle.capture(1);
    expect(lifecycle.isCurrent(nextTabOne)).toBe(true);
    expect(lifecycle.isCurrent(tabTwo)).toBe(false);
    expect(lifecycle.capture(2)).toBeUndefined();
  });

  it('does not accept tokens captured by another lifecycle guard', () => {
    const first = createPerTabLifecycle();
    const second = createPerTabLifecycle();
    const firstToken = first.capture(9);
    const secondToken = second.capture(9);

    expect(first.isCurrent(firstToken)).toBe(true);
    expect(second.isCurrent(secondToken)).toBe(true);
    expect(first.isCurrent(secondToken)).toBe(false);
    expect(second.isCurrent(firstToken)).toBe(false);
  });
});
