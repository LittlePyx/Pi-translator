import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import {
  getLocalDiagnosticEvents,
  recordLocalDiagnosticError,
} from '../core/diagnostics/event-log';

const sessionStorage: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(sessionStorage)) delete sessionStorage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionStorage, values)),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('local diagnostic event log', () => {
  it('stores only a bounded error summary and never the sensitive message', async () => {
    const sensitiveMessage = 'Selected unpublished paper text and sk-private-value';
    await recordLocalDiagnosticError(
      'translate',
      new TranslationError('AUTH_FAILED', sensitiveMessage, false, undefined, undefined, 401),
    );

    const events = await getLocalDiagnosticEvents();
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'translate',
        code: 'AUTH_FAILED',
        retryable: false,
        httpStatus: 401,
      }),
    ]);
    expect(JSON.stringify(sessionStorage)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(sessionStorage)).not.toContain('sk-private-value');
  });

  it('keeps only the latest twenty events', async () => {
    for (let index = 0; index < 24; index += 1) {
      await recordLocalDiagnosticError(
        'list-models',
        new TranslationError('RATE_LIMITED', `private-${index}`, true),
      );
    }
    await expect(getLocalDiagnosticEvents()).resolves.toHaveLength(20);
  });
});
