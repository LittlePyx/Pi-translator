import { toTranslationError, type TranslationErrorCode } from '../messaging/errors';

const DIAGNOSTIC_EVENTS_KEY = 'localDiagnosticEvents';
const PERFORMANCE_SAMPLES_KEY = 'localPerformanceSamplesV1';
const MAX_DIAGNOSTIC_EVENTS = 20;
const MAX_PERFORMANCE_SAMPLES = 20;
const MAX_PERFORMANCE_DURATION_MS = 30 * 60 * 1_000;

const DIAGNOSTIC_OPERATIONS = [
  'translate',
  'translate-finalization',
  'translate-image-region',
  'translate-image-region-finalization',
  'recognize-pdf-page',
  'test-connection',
  'test-vision-capability',
  'list-models',
  'api-diagnosis',
  'open-pdf-side-panel',
  'resolve-pdf-context-tab',
  'translate-context-menu-selection',
] as const;

const TRANSLATION_ERROR_CODES = [
  'EMPTY_SELECTION',
  'SELECTION_TOO_LONG',
  'NO_API_KEY',
  'API_PERMISSION_REQUIRED',
  'API_ENDPOINT_INVALID',
  'AUTH_FAILED',
  'PAYMENT_REQUIRED',
  'MODEL_NOT_FOUND',
  'RATE_LIMITED',
  'REQUEST_TIMEOUT',
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
  'EMPTY_RESPONSE',
  'INVALID_RESPONSE',
  'LATEX_VALIDATION_FAILED',
  'VISION_NOT_CONFIGURED',
  'VISION_MODEL_UNSUPPORTED',
  'OCR_NOT_SUPPORTED',
  'OCR_INVALID_RESPONSE',
  'IMAGE_REGION_INVALID',
  'WEB_CAPTURE_PERMISSION_REQUIRED',
  'UNSUPPORTED_PAGE',
  'REQUEST_ABORTED',
  'UNKNOWN_ERROR',
] as const satisfies readonly TranslationErrorCode[];

export const PERFORMANCE_OPERATIONS = [
  'translate-text',
  'translate-image-region',
  'recognize-pdf-page',
  'render-result',
] as const;

export const PERFORMANCE_PHASES = [
  'totalMs',
  'preflightMs',
  'captureMs',
  'queueMs',
  'providerFirstOutputMs',
  'providerMs',
  'latexValidationMs',
  'commitMs',
  'maintenanceMs',
  'textRenderMs',
  'mathRenderMs',
] as const;

export type DiagnosticOperation = typeof DIAGNOSTIC_OPERATIONS[number];
export type PerformanceOperation = typeof PERFORMANCE_OPERATIONS[number];
export type PerformancePhase = typeof PERFORMANCE_PHASES[number];

export interface LocalDiagnosticEvent {
  occurredAt: string;
  operation: DiagnosticOperation;
  code: TranslationErrorCode;
  retryable: boolean;
  httpStatus?: number;
}

export interface LocalPerformanceSampleV1 {
  schemaVersion: 1;
  operation: PerformanceOperation;
  timings: Partial<Record<PerformancePhase, number>>;
  errorCode?: TranslationErrorCode;
}

export interface LocalPerformanceSampleInput {
  operation: PerformanceOperation;
  timings: Partial<Record<PerformancePhase, number>>;
  errorCode?: TranslationErrorCode;
}

export interface PerformanceTimingAggregate {
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface PerformanceOperationAggregate {
  count: number;
  medianMs?: number;
  p95Ms?: number;
  maxMs?: number;
  timings: Partial<Record<PerformancePhase, PerformanceTimingAggregate>>;
  errorCounts: Partial<Record<TranslationErrorCode, number>>;
}

export type PerformanceAggregates = Partial<
  Record<PerformanceOperation, PerformanceOperationAggregate>
>;

export interface SlowPerformanceWarning {
  operation: PerformanceOperation;
  phase: PerformancePhase;
  observedP95Ms: number;
  thresholdMs: number;
}

const SLOW_PHASE_THRESHOLDS_MS: Partial<Record<PerformancePhase, number>> = {
  totalMs: 60_000,
  preflightMs: 2_500,
  captureMs: 1_000,
  queueMs: 1_500,
  providerFirstOutputMs: 8_000,
  providerMs: 45_000,
  latexValidationMs: 750,
  commitMs: 1_000,
  maintenanceMs: 1_500,
  textRenderMs: 150,
  mathRenderMs: 1_200,
};

type UnknownRecord = Record<string, unknown>;

const diagnosticOperationSet = new Set<string>(DIAGNOSTIC_OPERATIONS);
const translationErrorCodeSet = new Set<string>(TRANSLATION_ERROR_CODES);
const performanceOperationSet = new Set<string>(PERFORMANCE_OPERATIONS);
const performancePhaseSet = new Set<string>(PERFORMANCE_PHASES);

let diagnosticStorageTail: Promise<void> = Promise.resolve();

function queueDiagnosticStorage<T>(task: () => Promise<T>): Promise<T> {
  const result = diagnosticStorageTail.catch(() => undefined).then(task);
  diagnosticStorageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isDiagnosticOperation(value: unknown): value is DiagnosticOperation {
  return typeof value === 'string' && diagnosticOperationSet.has(value);
}

function isTranslationErrorCode(value: unknown): value is TranslationErrorCode {
  return typeof value === 'string' && translationErrorCodeSet.has(value);
}

function isPerformanceOperation(value: unknown): value is PerformanceOperation {
  return typeof value === 'string' && performanceOperationSet.has(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}

function validDiagnosticEvent(value: unknown): LocalDiagnosticEvent | undefined {
  if (!isRecord(value)) return undefined;
  const allowedKeys = new Set(['occurredAt', 'operation', 'code', 'retryable', 'httpStatus']);
  if (
    !hasOnlyKeys(value, allowedKeys) ||
    !isIsoTimestamp(value.occurredAt) ||
    !isDiagnosticOperation(value.operation) ||
    !isTranslationErrorCode(value.code) ||
    typeof value.retryable !== 'boolean' ||
    ('httpStatus' in value && !isHttpStatus(value.httpStatus))
  ) {
    return undefined;
  }
  return {
    occurredAt: value.occurredAt,
    operation: value.operation,
    code: value.code,
    retryable: value.retryable,
    ...(value.httpStatus !== undefined ? { httpStatus: value.httpStatus as number } : {}),
  };
}

function validEvents(value: unknown): LocalDiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(validDiagnosticEvent)
    .filter((event): event is LocalDiagnosticEvent => Boolean(event))
    .slice(0, MAX_DIAGNOSTIC_EVENTS);
}

function normalizedDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(MAX_PERFORMANCE_DURATION_MS, Math.max(0, value)));
}

function normalizedTimings(value: unknown): LocalPerformanceSampleV1['timings'] | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, performancePhaseSet)) return undefined;
  const timings: LocalPerformanceSampleV1['timings'] = {};
  for (const phase of PERFORMANCE_PHASES) {
    if (!(phase in value)) continue;
    const duration = normalizedDuration(value[phase]);
    if (duration === undefined) return undefined;
    timings[phase] = duration;
  }
  return Object.keys(timings).length > 0 ? timings : undefined;
}

function normalizedPerformanceSample(
  value: unknown,
  requireSchemaVersion: boolean,
): LocalPerformanceSampleV1 | undefined {
  if (!isRecord(value)) return undefined;
  const allowedKeys = new Set(['schemaVersion', 'operation', 'timings', 'errorCode']);
  if (
    !hasOnlyKeys(value, allowedKeys) ||
    (requireSchemaVersion && value.schemaVersion !== 1) ||
    (!requireSchemaVersion && 'schemaVersion' in value && value.schemaVersion !== 1) ||
    !isPerformanceOperation(value.operation) ||
    ('errorCode' in value && !isTranslationErrorCode(value.errorCode))
  ) {
    return undefined;
  }
  const timings = normalizedTimings(value.timings);
  if (!timings) return undefined;
  return {
    schemaVersion: 1,
    operation: value.operation,
    timings,
    ...(value.errorCode !== undefined ? { errorCode: value.errorCode as TranslationErrorCode } : {}),
  };
}

function validPerformanceSamples(
  value: unknown,
  maximum = MAX_PERFORMANCE_SAMPLES,
): LocalPerformanceSampleV1[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((sample) => normalizedPerformanceSample(sample, true))
    .filter((sample): sample is LocalPerformanceSampleV1 => Boolean(sample))
    .slice(0, maximum);
}

async function readDiagnosticEvents(): Promise<LocalDiagnosticEvent[]> {
  const stored = await browser.storage.session.get(DIAGNOSTIC_EVENTS_KEY);
  return validEvents(stored[DIAGNOSTIC_EVENTS_KEY]);
}

async function readPerformanceSamples(): Promise<LocalPerformanceSampleV1[]> {
  const stored = await browser.storage.session.get(PERFORMANCE_SAMPLES_KEY);
  return validPerformanceSamples(stored[PERFORMANCE_SAMPLES_KEY]);
}

export function aggregateLocalPerformanceSamples(
  samples: readonly LocalPerformanceSampleV1[],
): PerformanceAggregates {
  const valid = validPerformanceSamples(samples, Number.POSITIVE_INFINITY);
  const aggregates: PerformanceAggregates = {};

  for (const operation of PERFORMANCE_OPERATIONS) {
    const operationSamples = valid.filter((sample) => sample.operation === operation);
    if (!operationSamples.length) continue;
    const timings: PerformanceOperationAggregate['timings'] = {};
    for (const phase of PERFORMANCE_PHASES) {
      const values = operationSamples
        .map((sample) => sample.timings[phase])
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right);
      if (!values.length) continue;
      const middle = Math.floor(values.length / 2);
      const medianMs = values.length % 2 === 0
        ? (values[middle - 1]! + values[middle]!) / 2
        : values[middle]!;
      timings[phase] = {
        count: values.length,
        medianMs,
        p95Ms: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)]!,
        maxMs: values[values.length - 1]!,
      };
    }
    const total = timings.totalMs;
    const errorCounts: PerformanceOperationAggregate['errorCounts'] = {};
    for (const sample of operationSamples) {
      if (!sample.errorCode) continue;
      errorCounts[sample.errorCode] = (errorCounts[sample.errorCode] ?? 0) + 1;
    }
    aggregates[operation] = {
      count: operationSamples.length,
      ...(total
        ? { medianMs: total.medianMs, p95Ms: total.p95Ms, maxMs: total.maxMs }
        : {}),
      timings,
      errorCounts,
    };
  }

  return aggregates;
}

export function findSlowPerformanceWarnings(
  samples: readonly LocalPerformanceSampleV1[],
): SlowPerformanceWarning[] {
  const aggregates = aggregateLocalPerformanceSamples(samples);
  const warnings: SlowPerformanceWarning[] = [];
  for (const operation of PERFORMANCE_OPERATIONS) {
    const aggregate = aggregates[operation];
    if (!aggregate) continue;
    for (const phase of PERFORMANCE_PHASES) {
      const timing = aggregate.timings[phase];
      const thresholdMs = SLOW_PHASE_THRESHOLDS_MS[phase];
      if (!timing || thresholdMs === undefined || timing.p95Ms <= thresholdMs) continue;
      warnings.push({
        operation,
        phase,
        observedP95Ms: timing.p95Ms,
        thresholdMs,
      });
    }
  }
  return warnings
    .sort((left, right) =>
      (right.observedP95Ms / right.thresholdMs) -
      (left.observedP95Ms / left.thresholdMs))
    .slice(0, 8);
}

export function getLocalDiagnosticEvents(): Promise<LocalDiagnosticEvent[]> {
  return queueDiagnosticStorage(readDiagnosticEvents);
}

export function getLocalPerformanceSamples(): Promise<LocalPerformanceSampleV1[]> {
  return queueDiagnosticStorage(readPerformanceSamples);
}

export async function recordLocalDiagnosticError(
  operation: DiagnosticOperation,
  error: unknown,
): Promise<void> {
  if (!isDiagnosticOperation(operation)) return;
  try {
    const normalized = toTranslationError(error);
    await queueDiagnosticStorage(async () => {
      const previous = await readDiagnosticEvents();
      const event: LocalDiagnosticEvent = {
        occurredAt: new Date().toISOString(),
        operation,
        code: normalized.code,
        retryable: normalized.retryable,
        ...(isHttpStatus(normalized.httpStatus) ? { httpStatus: normalized.httpStatus } : {}),
      };
      await browser.storage.session.set({
        [DIAGNOSTIC_EVENTS_KEY]: [event, ...previous].slice(0, MAX_DIAGNOSTIC_EVENTS),
      });
    });
  } catch {
    // Diagnostics must never interfere with the original user-facing error.
  }
}

export async function recordLocalPerformanceSample(
  sample: LocalPerformanceSampleInput,
): Promise<void> {
  const normalized = normalizedPerformanceSample(sample, false);
  if (!normalized) return;
  try {
    await queueDiagnosticStorage(async () => {
      const previous = await readPerformanceSamples();
      await browser.storage.session.set({
        [PERFORMANCE_SAMPLES_KEY]: [normalized, ...previous].slice(0, MAX_PERFORMANCE_SAMPLES),
      });
    });
  } catch {
    // Performance diagnostics are best effort and must not slow or break translation.
  }
}
