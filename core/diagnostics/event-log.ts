import { toTranslationError, type TranslationErrorCode } from '../messaging/errors';

const DIAGNOSTIC_EVENTS_KEY = 'localDiagnosticEvents';
const MAX_DIAGNOSTIC_EVENTS = 20;

export type DiagnosticOperation =
  | 'translate'
  | 'translate-finalization'
  | 'translate-image-region'
  | 'translate-image-region-finalization'
  | 'test-connection'
  | 'test-vision-capability'
  | 'list-models'
  | 'api-diagnosis'
  | 'open-pdf-side-panel'
  | 'resolve-pdf-context-tab'
  | 'translate-context-menu-selection';

export interface LocalDiagnosticEvent {
  occurredAt: string;
  operation: DiagnosticOperation;
  code: TranslationErrorCode;
  retryable: boolean;
  httpStatus?: number;
}

function validEvents(value: unknown): LocalDiagnosticEvent[] {
  return Array.isArray(value)
    ? value.filter((event): event is LocalDiagnosticEvent =>
        Boolean(
          event &&
            typeof event === 'object' &&
            'occurredAt' in event &&
            typeof event.occurredAt === 'string' &&
            'operation' in event &&
            typeof event.operation === 'string' &&
            'code' in event &&
            typeof event.code === 'string',
        ),
      )
    : [];
}

export async function getLocalDiagnosticEvents(): Promise<LocalDiagnosticEvent[]> {
  const stored = await browser.storage.session.get(DIAGNOSTIC_EVENTS_KEY);
  return validEvents(stored[DIAGNOSTIC_EVENTS_KEY]);
}

export async function recordLocalDiagnosticError(
  operation: DiagnosticOperation,
  error: unknown,
): Promise<void> {
  try {
    const normalized = toTranslationError(error);
    const previous = await getLocalDiagnosticEvents();
    const event: LocalDiagnosticEvent = {
      occurredAt: new Date().toISOString(),
      operation,
      code: normalized.code,
      retryable: normalized.retryable,
      ...(normalized.httpStatus ? { httpStatus: normalized.httpStatus } : {}),
    };
    await browser.storage.session.set({
      [DIAGNOSTIC_EVENTS_KEY]: [event, ...previous].slice(0, MAX_DIAGNOSTIC_EVENTS),
    });
  } catch {
    // Diagnostics must never interfere with the original user-facing error.
  }
}
