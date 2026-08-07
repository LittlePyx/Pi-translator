import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLatestRequestGate,
  isSamePdfSidePanelSession,
  reopenExistingPdfSidePanelFromUserGesture,
  restorePdfSidePanelSessions,
  storePdfSidePanelSession,
} from '../core/pdf/sidepanel-session';
import type { PdfSidePanelSession } from '../core/messaging/messages';

const storage: Record<string, unknown> = {};

function session(overrides: Partial<PdfSidePanelSession> = {}): PdfSidePanelSession {
  return {
    tabId: 7,
    requestId: 'request-1',
    sourceText: 'Selected PDF text.',
    pageUrl: 'https://example.com/paper.pdf#page=2',
    pageNumber: 2,
    sourceLabel: 'paper.pdf',
    status: 'translating',
    startedAt: 123,
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('native PDF side-panel sessions', () => {
  it('restores a matching tab and converts interrupted work into a retryable error', async () => {
    await storePdfSidePanelSession(session());
    const restored = await restorePdfSidePanelSessions([
      { id: 7, url: 'https://example.com/paper.pdf#page=5' },
    ]);

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      tabId: 7,
      pageNumber: 5,
      status: 'error',
      error: { code: 'REQUEST_ABORTED', retryable: true },
    });
    expect(JSON.stringify(storage)).not.toContain('"status":"translating"');
  });

  it('drops sessions whose tab disappeared or navigated to another document', async () => {
    await storePdfSidePanelSession(session());
    await expect(restorePdfSidePanelSessions([
      { id: 7, url: 'https://example.com/other.pdf' },
    ])).resolves.toEqual([]);
    expect(JSON.stringify(storage)).not.toContain('request-1');
  });

  it('restores a settings-recovery confirmation after the side panel is reopened', async () => {
    await storePdfSidePanelSession(session({
      status: 'error',
      error: { code: 'AUTH_FAILED', message: 'Invalid key.', retryable: false },
      settingsRecoveryConfirmation: {
        failedRequestId: 'request-1',
        hadPartialOutput: true,
      },
    }));

    await expect(restorePdfSidePanelSessions([
      { id: 7, url: 'https://example.com/paper.pdf#page=2' },
    ])).resolves.toMatchObject([{
      requestId: 'request-1',
      settingsRecoveryConfirmation: {
        failedRequestId: 'request-1',
        hadPartialOutput: true,
      },
    }]);
  });

  it('invalidates out-of-order side-panel loads', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    gate.invalidate();
    expect(second()).toBe(false);
  });

  it('identifies a session by tab and request instead of object identity', () => {
    const expected = session();
    const streamed = { ...expected, partialText: 'stream update' };
    expect(isSamePdfSidePanelSession(streamed, expected))
      .toBe(true);
    expect(isSamePdfSidePanelSession(
      { ...expected, requestId: 'newer-request' },
      expected,
    )).toBe(false);
    expect(isSamePdfSidePanelSession(
      { ...expected, tabId: expected.tabId + 1 },
      expected,
    )).toBe(false);
  });

  it('reopens an existing PDF session synchronously from a user gesture', async () => {
    let insideGesture = true;
    const open = vi.fn(() => {
      expect(insideGesture).toBe(true);
      return Promise.resolve();
    });

    const recovery = reopenExistingPdfSidePanelFromUserGesture(
      { id: 7, windowId: 3 },
      (tabId) => tabId === 7,
      open,
    );
    insideGesture = false;

    expect(recovery.matchedSession).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ id: 7, windowId: 3 });
    await expect(recovery.openPromise).resolves.toBeUndefined();
  });

  it('leaves the normal selection shortcut untouched without a PDF session', () => {
    const open = vi.fn(() => Promise.resolve());
    const recovery = reopenExistingPdfSidePanelFromUserGesture(
      { id: 8, windowId: 3 },
      () => false,
      open,
    );

    expect(recovery).toEqual({ matchedSession: false });
    expect(open).not.toHaveBeenCalled();
  });

  it('claims an existing PDF shortcut even when the side-panel API is unavailable', () => {
    const recovery = reopenExistingPdfSidePanelFromUserGesture(
      { id: 7, windowId: 3 },
      () => true,
      () => undefined,
    );

    expect(recovery).toEqual({ matchedSession: true, openPromise: undefined });
  });

});
