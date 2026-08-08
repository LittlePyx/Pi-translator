import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import {
  aggregateLocalPerformanceSamples,
  findSlowPerformanceWarnings,
  getLocalDiagnosticEvents,
  getLocalPerformanceSamples,
  recordLocalDiagnosticError,
  recordLocalPerformanceSample,
  type LocalPerformanceSampleV1,
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
    const sensitiveMessage =
      'Selected unpublished paper text, data:image/png;base64,private-crop, and sk-private-value';
    await recordLocalDiagnosticError(
      'translate-image-region',
      new TranslationError('AUTH_FAILED', sensitiveMessage, false, undefined, undefined, 401),
    );

    const events = await getLocalDiagnosticEvents();
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'translate-image-region',
        code: 'AUTH_FAILED',
        retryable: false,
        httpStatus: 401,
      }),
    ]);
    expect(JSON.stringify(sessionStorage)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(sessionStorage)).not.toContain('sk-private-value');
    expect(JSON.stringify(sessionStorage)).not.toContain('data:image/');
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

  it('strictly filters malformed legacy error entries', async () => {
    const occurredAt = new Date().toISOString();
    sessionStorage.localDiagnosticEvents = [
      { occurredAt, operation: 'translate', code: 'NETWORK_ERROR', retryable: true },
      { occurredAt, operation: 'not-an-operation', code: 'NETWORK_ERROR', retryable: true },
      { occurredAt, operation: 'translate', code: 'PRIVATE_MESSAGE', retryable: true },
      { occurredAt, operation: 'translate', code: 'NETWORK_ERROR', retryable: 'yes' },
      { occurredAt, operation: 'translate', code: 'NETWORK_ERROR', retryable: true, httpStatus: 999 },
      {
        occurredAt,
        operation: 'translate',
        code: 'NETWORK_ERROR',
        retryable: true,
        message: 'private selected text',
      },
    ];

    await expect(getLocalDiagnosticEvents()).resolves.toEqual([
      { occurredAt, operation: 'translate', code: 'NETWORK_ERROR', retryable: true },
    ]);
  });

  it('serializes concurrent error writes without losing updates', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) =>
      recordLocalDiagnosticError(
        'translate',
        new TranslationError(index % 2 ? 'NETWORK_ERROR' : 'RATE_LIMITED', `private-${index}`),
      )));

    const events = await getLocalDiagnosticEvents();
    expect(events).toHaveLength(20);
    expect(events.filter((event) => event.code === 'NETWORK_ERROR')).toHaveLength(10);
    expect(events.filter((event) => event.code === 'RATE_LIMITED')).toHaveLength(10);
  });
});

describe('local performance samples', () => {
  it('stores only allowlisted numeric timings and an optional error code', async () => {
    await recordLocalPerformanceSample({
      operation: 'translate-image-region',
      timings: {
        totalMs: 1532.6,
        providerFirstOutputMs: -10,
        providerMs: 99_999_999,
      },
      errorCode: 'REQUEST_TIMEOUT',
    });

    await expect(getLocalPerformanceSamples()).resolves.toEqual([{
      schemaVersion: 1,
      operation: 'translate-image-region',
      timings: {
        totalMs: 1533,
        providerFirstOutputMs: 0,
        providerMs: 1_800_000,
      },
      errorCode: 'REQUEST_TIMEOUT',
    }]);
  });

  it('rejects unknown fields, phases, non-finite values, and unknown error codes', async () => {
    await recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: Number.NaN },
    });
    await recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: Number.POSITIVE_INFINITY },
    });
    await recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: 10, secretText: 22 } as never,
    });
    await recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: 10 },
      errorCode: 'PRIVATE_ERROR' as never,
    });

    await expect(getLocalPerformanceSamples()).resolves.toEqual([]);
  });

  it('never persists request identifiers, URLs, models, text, or arbitrary input fields', async () => {
    const sensitive = {
      requestId: 'request-private',
      pageUrl: 'https://private.example/paper.pdf',
      model: 'private-model',
      text: 'unpublished source text',
      apiKey: 'sk-private-key',
    };
    await recordLocalPerformanceSample({
      operation: 'render-result',
      timings: { totalMs: 40, textRenderMs: 8 },
      ...sensitive,
    });

    const serialized = JSON.stringify(sessionStorage);
    expect(serialized).not.toContain('request-private');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('private-model');
    expect(serialized).not.toContain('unpublished source text');
    expect(serialized).not.toContain('sk-private-key');
  });

  it('strictly filters corrupt stored samples and bounds reads to twenty', async () => {
    const valid: LocalPerformanceSampleV1 = {
      schemaVersion: 1,
      operation: 'translate-text',
      timings: { totalMs: 25 },
    };
    sessionStorage.localPerformanceSamplesV1 = [
      ...Array.from({ length: 24 }, () => valid),
      { ...valid, schemaVersion: 2 },
      { ...valid, operation: 'private-operation' },
      { ...valid, timings: { totalMs: 10, sourceLength: 90 } },
      { ...valid, privateText: 'secret' },
    ];

    const samples = await getLocalPerformanceSamples();
    expect(samples).toHaveLength(20);
    expect(samples.every((sample) => sample.operation === 'translate-text')).toBe(true);
  });

  it('serializes concurrent performance writes and keeps only the newest twenty', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) =>
      recordLocalPerformanceSample({
        operation: 'translate-text',
        timings: { totalMs: index },
      })));

    const samples = await getLocalPerformanceSamples();
    expect(samples).toHaveLength(20);
    expect(samples.map((sample) => sample.timings.totalMs)).toEqual(
      Array.from({ length: 20 }, (_, index) => 29 - index),
    );
  });

  it('shares one serial lane between errors and performance storage operations', async () => {
    const writes = Array.from({ length: 10 }, (_, index) => Promise.all([
      recordLocalDiagnosticError(
        'translate',
        new TranslationError('NETWORK_ERROR', `private-${index}`),
      ),
      recordLocalPerformanceSample({
        operation: 'translate-text',
        timings: { totalMs: index },
      }),
    ]));
    await Promise.all(writes);

    await expect(getLocalDiagnosticEvents()).resolves.toHaveLength(10);
    await expect(getLocalPerformanceSamples()).resolves.toHaveLength(10);
  });

  it('swallows storage write failures without poisoning later diagnostics', async () => {
    const set = vi.mocked(browser.storage.session.set);
    set.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: 10 },
    })).resolves.toBeUndefined();
    await expect(recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: { totalMs: 20 },
    })).resolves.toBeUndefined();
    await expect(getLocalPerformanceSamples()).resolves.toEqual([
      expect.objectContaining({ timings: { totalMs: 20 } }),
    ]);
  });
});

describe('performance aggregation', () => {
  it('aggregates count, median, nearest-rank p95, max, phases, and error codes by operation', () => {
    const samples: LocalPerformanceSampleV1[] = Array.from(
      { length: 20 },
      (_, index) => ({
        schemaVersion: 1,
        operation: 'translate-text',
        timings: {
          totalMs: index + 1,
          ...(index % 2 === 0 ? { providerMs: (index + 1) * 10 } : {}),
        },
        ...(index < 2 ? { errorCode: 'REQUEST_TIMEOUT' as const } : {}),
      }),
    );
    samples.push({
      schemaVersion: 1,
      operation: 'render-result',
      timings: { totalMs: 8, textRenderMs: 3 },
    });

    const aggregate = aggregateLocalPerformanceSamples(samples);
    expect(aggregate['translate-text']).toMatchObject({
      count: 20,
      medianMs: 10.5,
      p95Ms: 19,
      maxMs: 20,
      errorCounts: { REQUEST_TIMEOUT: 2 },
      timings: {
        totalMs: { count: 20, medianMs: 10.5, p95Ms: 19, maxMs: 20 },
        providerMs: { count: 10, medianMs: 100, p95Ms: 190, maxMs: 190 },
      },
    });
    expect(aggregate['render-result']).toMatchObject({
      count: 1,
      medianMs: 8,
      p95Ms: 8,
      maxMs: 8,
    });
  });

  it('is pure and ignores malformed samples', () => {
    const samples: LocalPerformanceSampleV1[] = [{
      schemaVersion: 1,
      operation: 'translate-text',
      timings: { totalMs: 10 },
    }];
    const before = structuredClone(samples);

    expect(aggregateLocalPerformanceSamples([
      ...samples,
      { schemaVersion: 1, operation: 'private' as never, timings: { totalMs: 50 } },
    ])).toEqual({
      'translate-text': {
        count: 1,
        medianMs: 10,
        p95Ms: 10,
        maxMs: 10,
        timings: {
          totalMs: { count: 1, medianMs: 10, p95Ms: 10, maxMs: 10 },
        },
        errorCounts: {},
      },
    });
    expect(samples).toEqual(before);
  });

  it('reports only fixed slow stages without exposing sample content', () => {
    const warnings = findSlowPerformanceWarnings([{
      schemaVersion: 1,
      operation: 'translate-image-region',
      timings: {
        captureMs: 1_200,
        queueMs: 20,
        providerMs: 50_000,
      },
    }]);

    expect(warnings).toEqual([
      {
        operation: 'translate-image-region',
        phase: 'captureMs',
        observedP95Ms: 1_200,
        thresholdMs: 1_000,
      },
      {
        operation: 'translate-image-region',
        phase: 'providerMs',
        observedP95Ms: 50_000,
        thresholdMs: 45_000,
      },
    ]);
  });
});
