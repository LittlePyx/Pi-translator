import { describe, expect, it, vi } from 'vitest';
import { bilingualSessionMessageHandlers } from '../core/background/bilingual-session-message-handlers';
import { createPdfSessionMessageHandlers } from '../core/background/pdf-session-message-handlers';
import {
  routeRuntimeMessage,
  type RuntimeMessageHandlers,
  type RuntimeMessageSender,
} from '../core/background/runtime-message-router';
import { createUtilityMessageHandlers } from '../core/background/utility-message-handlers';
import type { PublicSettings, RuntimeMessage } from '../core/messaging/messages';

const sender = {} as RuntimeMessageSender;

const publicSettings: PublicSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  showFloatingButtonOnOverleaf: true,
  hideFloatingButtonForTargetLanguage: true,
  generalPageMode: 'on-demand',
  siteAllowlist: [],
  pausedSiteHosts: [],
  sentenceAlignmentDefault: true,
  autoRenderLatex: true,
  historyLimit: 5,
  sidebarMode: 'floating',
  sidebarSide: 'right',
  sidebarWidth: 420,
  contextMode: 'off',
  enableStreaming: true,
  protectSensitiveFields: true,
  pdfKeyboardShortcutsEnabled: true,
  pdfRegionShortcutKey: 'r',
  activeApiProfileId: 'default',
  apiProfiles: [{ id: 'default', name: 'Default', model: 'test-model' }],
};

describe('background runtime message router', () => {
  it('dispatches a matched message with its sender', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, data: {} }));
    const handlers = { GET_PUBLIC_SETTINGS: handler } satisfies RuntimeMessageHandlers;
    const message = { type: 'GET_PUBLIC_SETTINGS' } satisfies RuntimeMessage;

    await expect(routeRuntimeMessage(handlers, message, sender)).resolves.toEqual({
      ok: true,
      data: {},
    });
    expect(handler).toHaveBeenCalledWith(message, sender);
  });

  it('returns undefined for messages owned by the legacy listener', () => {
    const handlers = {} satisfies RuntimeMessageHandlers;
    expect(routeRuntimeMessage(handlers, { type: 'TRIGGER_TRANSLATE' }, sender)).toBeUndefined();
  });
});

describe('background utility message handlers', () => {
  it('uses injected dependencies for public settings and performance records', async () => {
    const getPublicSettings = vi.fn(async () => publicSettings);
    const recordLocalPerformance = vi.fn(async () => undefined);
    const handlers = createUtilityMessageHandlers({
      getPublicSettings,
      recordLocalPerformance,
      getLocalDiagnosticReport: async () => 'diagnostic report',
    });

    await expect(routeRuntimeMessage(
      handlers,
      { type: 'GET_PUBLIC_SETTINGS' },
      sender,
    )).resolves.toEqual({ ok: true, data: publicSettings });

    const performanceMessage = {
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'render-result',
        timings: { totalMs: 12, textRenderMs: 8, mathRenderMs: 4 },
      },
    } satisfies RuntimeMessage;
    await expect(routeRuntimeMessage(handlers, performanceMessage, sender)).resolves.toEqual({
      ok: true,
      data: { recorded: true },
    });
    expect(getPublicSettings).toHaveBeenCalledOnce();
    expect(recordLocalPerformance).toHaveBeenCalledWith(performanceMessage.payload);
  });

  it('keeps LaTeX input limits and batch limits at the routing boundary', async () => {
    const handlers = createUtilityMessageHandlers({
      getPublicSettings: async () => publicSettings,
      recordLocalPerformance: async () => undefined,
      getLocalDiagnosticReport: async () => 'diagnostic report',
    });

    await expect(routeRuntimeMessage(handlers, {
      type: 'RENDER_LATEX_MATHML',
      payload: { tex: 'x'.repeat(10_001), displayMode: false },
    }, sender)).resolves.toEqual({ ok: true, data: {} });

    const batchResponse = await routeRuntimeMessage(handlers, {
      type: 'RENDER_LATEX_MATHML_BATCH',
      payload: {
        items: Array.from({ length: 65 }, () => ({ tex: '', displayMode: false })),
      },
    }, sender);
    expect(batchResponse).toEqual({
      ok: true,
      data: { html: Array.from({ length: 64 }, () => null) },
    });
  });

  it('normalizes diagnostic failures into runtime errors', async () => {
    const handlers = createUtilityMessageHandlers({
      getPublicSettings: async () => publicSettings,
      recordLocalPerformance: async () => undefined,
      getLocalDiagnosticReport: async () => {
        throw new Error('private diagnostic failure');
      },
    });

    await expect(routeRuntimeMessage(
      handlers,
      { type: 'GET_LOCAL_DIAGNOSTIC_REPORT' },
      sender,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected translation error occurred.',
        retryable: false,
      },
    });
  });
});

describe('background PDF session message handler', () => {
  it('queries the injected session registry with the requested tab', async () => {
    const getSession = vi.fn(async () => null);
    const handlers = createPdfSessionMessageHandlers({ getSession });

    await expect(routeRuntimeMessage(handlers, {
      type: 'GET_PDF_SIDE_PANEL_SESSION',
      payload: { tabId: 27 },
    }, sender)).resolves.toEqual({ ok: true, data: { session: null } });
    expect(getSession).toHaveBeenCalledWith(27);
  });
});

describe('background bilingual session message handlers', () => {
  it('rejects session access outside a top-frame ordinary webpage', async () => {
    await expect(routeRuntimeMessage(bilingualSessionMessageHandlers, {
      type: 'GET_BILINGUAL_PAGE_SESSION',
      payload: {
        descriptor: {
          pageKey: 'page-test',
          targetLanguage: 'zh-CN',
          sourceLanguage: 'auto',
          style: 'general',
          contentMode: 'auto',
        },
      },
    }, sender)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_PAGE',
        message: '正文会话只能由当前普通网页恢复。',
        retryable: false,
      },
    });
  });
});
