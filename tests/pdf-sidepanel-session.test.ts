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

function correctedSession(overrides: Partial<PdfSidePanelSession> = {}): PdfSidePanelSession {
  return session({
    status: 'complete',
    result: {
      requestId: 'corrected-1',
      originalText: 'Selected PDF text.',
      translatedText: 'Corrected translation.',
      warnings: [],
      revision: {
        rootRequestId: 'request-1',
        kind: 'manual',
        label: 'Manual correction',
        scope: 'document',
      },
    },
    correctionReceipt: {
      baseRequestId: 'request-1',
      correctedRequestId: 'corrected-1',
      scope: 'document',
      previousTranslation: 'Previous translation.',
      correctedTranslation: 'Corrected translation.',
      termChange: {
        scope: 'document',
        source: 'source term',
        appliedTarget: 'corrected term',
        previousTarget: 'previous term',
        documentTermId: 'term-1',
      },
    },
    ...overrides,
  });
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

  it('restores a valid correction receipt with its completed result', async () => {
    await storePdfSidePanelSession(correctedSession());
    vi.resetModules();
    const restartedRepository = await import('../core/pdf/sidepanel-session');

    await expect(restartedRepository.restorePdfSidePanelSessions([{
      id: 7,
      url: 'https://example.com/paper.pdf#page=8',
    }])).resolves.toMatchObject([{
      tabId: 7,
      pageNumber: 8,
      status: 'complete',
      result: {
        requestId: 'corrected-1',
        translatedText: 'Corrected translation.',
      },
      correctionReceipt: {
        baseRequestId: 'request-1',
        correctedRequestId: 'corrected-1',
        scope: 'document',
        previousTranslation: 'Previous translation.',
        correctedTranslation: 'Corrected translation.',
        termChange: {
          scope: 'document',
          source: 'source term',
          appliedTarget: 'corrected term',
          previousTarget: 'previous term',
          documentTermId: 'term-1',
        },
      },
    }]);
  });

  it('keeps the completed PDF result but removes a mismatched correction receipt', async () => {
    await storePdfSidePanelSession(correctedSession({
      correctionReceipt: {
        ...correctedSession().correctionReceipt!,
        correctedTranslation: 'A different translation.',
      },
    }));

    const restored = await restorePdfSidePanelSessions([{
      id: 7,
      url: 'https://example.com/paper.pdf#page=2',
    }]);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.result?.translatedText).toBe('Corrected translation.');
    expect(restored[0]?.correctionReceipt).toBeUndefined();
    expect(JSON.stringify(storage)).not.toContain('A different translation.');
  });

  it('removes a receipt that is attached to a non-complete PDF session', async () => {
    await storePdfSidePanelSession(correctedSession({
      status: 'error',
      error: { code: 'REQUEST_ABORTED', message: 'Interrupted.', retryable: true },
    }));

    const restored = await restorePdfSidePanelSessions([{
      id: 7,
      url: 'https://example.com/paper.pdf#page=2',
    }]);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.status).toBe('error');
    expect(restored[0]?.correctionReceipt).toBeUndefined();
  });

  it('removes a receipt whose rollback scope disagrees with its result', async () => {
    await storePdfSidePanelSession(correctedSession({
      correctionReceipt: {
        ...correctedSession().correctionReceipt!,
        scope: 'current',
        termChange: {
          scope: 'global',
          source: 'source term',
          appliedTarget: 'corrected term',
        },
      },
    }));

    const restored = await restorePdfSidePanelSessions([{
      id: 7,
      url: 'https://example.com/paper.pdf#page=2',
    }]);

    expect(restored[0]?.result?.revision?.scope).toBe('document');
    expect(restored[0]?.correctionReceipt).toBeUndefined();
  });

  it('restores independent native PDF sessions after a service-worker module restart', async () => {
    await Promise.all([
      storePdfSidePanelSession(session({
        tabId: 7,
        requestId: 'request-tab-7',
        pageUrl: 'https://example.com/first.pdf#page=2',
        status: 'translating',
      })),
      storePdfSidePanelSession(session({
        tabId: 8,
        requestId: 'request-tab-8',
        pageUrl: 'https://example.com/second.pdf#page=4',
        pageNumber: 4,
        status: 'error',
        error: { code: 'AUTH_FAILED', message: 'Invalid key.', retryable: false },
        settingsRecoveryConfirmation: {
          failedRequestId: 'request-tab-8',
          hadPartialOutput: false,
        },
      })),
    ]);

    vi.resetModules();
    const restartedRepository = await import('../core/pdf/sidepanel-session');
    const restored = await restartedRepository.restorePdfSidePanelSessions([
      { id: 7, url: 'https://example.com/first.pdf#page=6' },
      { id: 8, url: 'https://example.com/second.pdf#page=9' },
    ]);

    expect(restored).toHaveLength(2);
    expect(restored).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tabId: 7,
        requestId: 'request-tab-7',
        pageNumber: 6,
        status: 'error',
        error: expect.objectContaining({ code: 'REQUEST_ABORTED', retryable: true }),
      }),
      expect.objectContaining({
        tabId: 8,
        requestId: 'request-tab-8',
        pageNumber: 9,
        status: 'error',
        settingsRecoveryConfirmation: {
          failedRequestId: 'request-tab-8',
          hadPartialOutput: false,
        },
      }),
    ]));
    expect(JSON.stringify(storage)).not.toContain('"status":"translating"');
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
