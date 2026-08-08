const tokenOwner = Symbol('per-tab-lifecycle-owner');

export interface TabLifecycleToken {
  readonly tabId: number;
  readonly lifecycle: number;
  readonly generation: number;
  readonly [tokenOwner]: symbol;
}

interface TabLifecycleState {
  lifecycle: number;
  generation: number;
  closed: boolean;
}

export interface PerTabLifecycle {
  /**
   * Captures the current generation for work that may cross an async barrier.
   * A closed tab returns undefined until an explicit reopen.
   */
  capture(tabId: number): TabLifecycleToken | undefined;

  /**
   * Invalidates work captured before a navigation without closing the tab.
   */
  invalidate(tabId: number): void;

  /**
   * Tombstones a closed tab. Invalidation alone cannot reopen it.
   */
  close(tabId: number): void;

  /**
   * Starts a distinct lifecycle, for example when a browser reuses a tab ID.
   */
  reopen(tabId: number): void;

  /**
   * Returns true only while the token still names the live tab generation.
   */
  isCurrent(token: TabLifecycleToken | undefined): token is TabLifecycleToken;
}

/**
 * Creates a lightweight generation guard for work scoped to browser tabs.
 *
 * Capture a token before entering an async lane/barrier and check it after the
 * barrier, before creating controllers, sessions, or other observable state.
 * Navigation rotates the generation while close leaves a tombstone. Reopen
 * rotates the lifecycle as well, so tokens from a previously reused tab ID can
 * never become current again.
 */
export function createPerTabLifecycle(): PerTabLifecycle {
  const owner = Symbol('per-tab-lifecycle-instance');
  const states = new Map<number, TabLifecycleState>();
  let nextLifecycle = 1;

  const createOpenState = (): TabLifecycleState => ({
    lifecycle: nextLifecycle++,
    generation: 0,
    closed: false,
  });

  const createClosedState = (): TabLifecycleState => ({
    lifecycle: nextLifecycle++,
    generation: 0,
    closed: true,
  });

  return {
    capture(tabId) {
      let state = states.get(tabId);
      if (!state) {
        state = createOpenState();
        states.set(tabId, state);
      }
      if (state.closed) return undefined;

      return Object.freeze({
        tabId,
        lifecycle: state.lifecycle,
        generation: state.generation,
        [tokenOwner]: owner,
      });
    },

    invalidate(tabId) {
      const state = states.get(tabId);
      if (!state) {
        const next = createOpenState();
        next.generation = 1;
        states.set(tabId, next);
        return;
      }
      if (!state.closed) state.generation += 1;
    },

    close(tabId) {
      const state = states.get(tabId);
      if (!state) {
        states.set(tabId, createClosedState());
        return;
      }
      state.generation += 1;
      state.closed = true;
    },

    reopen(tabId) {
      states.set(tabId, createOpenState());
    },

    isCurrent(token: TabLifecycleToken | undefined): token is TabLifecycleToken {
      if (!token || token[tokenOwner] !== owner) return false;
      const state = states.get(token.tabId);
      return Boolean(
        state
        && !state.closed
        && state.lifecycle === token.lifecycle
        && state.generation === token.generation,
      );
    },
  };
}
