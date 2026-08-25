import { isSupportedTargetLanguage } from '../language/supported-target-languages';
import type { TranslationErrorCode } from '../messaging/errors';

export type BilingualPagePhase =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'error';

export type BilingualPageAction = 'pause' | 'resume' | 'stop' | 'clear';

export interface BilingualPageState {
  phase: BilingualPagePhase;
  total: number;
  translated: number;
  failed: number;
  targetLanguage?: string;
  message?: string;
  pauseReason?: 'user' | 'interactive';
}

export const EMPTY_BILINGUAL_PAGE_STATE: BilingualPageState = {
  phase: 'idle',
  total: 0,
  translated: 0,
  failed: 0,
};

const ISOLATED_BLOCK_ERROR_CODES = new Set<TranslationErrorCode>([
  'EMPTY_SELECTION',
  'SELECTION_TOO_LONG',
  'EMPTY_RESPONSE',
  'INVALID_RESPONSE',
  'LATEX_VALIDATION_FAILED',
]);

/** Errors attributable to one paragraph may be skipped without retrying the whole page. */
export function isIsolatedBilingualBlockError(code: TranslationErrorCode): boolean {
  return ISOLATED_BLOCK_ERROR_CODES.has(code);
}

export function normalizeBilingualPageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function isBilingualPageTextCandidate(
  value: string,
  tagName: string,
  linkTextLength = 0,
): boolean {
  const text = normalizeBilingualPageText(value);
  if (!text || text.length > 5_000) return false;
  const normalizedTag = tagName.toUpperCase();
  const minimumLength = /^H[1-4]$/u.test(normalizedTag)
    ? 8
    : normalizedTag === 'FIGCAPTION'
      ? 12
      : 20;
  if (text.length < minimumLength) return false;
  if (linkTextLength > text.length * .65) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters >= Math.min(8, Math.ceil(text.length * .18));
}

export function isBilingualPageState(value: unknown): value is BilingualPageState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const validCount = (count: unknown) => Number.isSafeInteger(count) && (count as number) >= 0;
  return (
    ['idle', 'running', 'paused', 'stopped', 'complete', 'error'].includes(
      typeof state.phase === 'string' ? state.phase : '',
    ) &&
    validCount(state.total) &&
    validCount(state.translated) &&
    validCount(state.failed) &&
    (state.translated as number) + (state.failed as number) <= (state.total as number) &&
    (state.targetLanguage === undefined || isSupportedTargetLanguage(state.targetLanguage)) &&
    (state.message === undefined || (
      typeof state.message === 'string' && state.message.length <= 300
    )) &&
    (state.pauseReason === undefined || ['user', 'interactive'].includes(
      typeof state.pauseReason === 'string' ? state.pauseReason : '',
    ))
  );
}
