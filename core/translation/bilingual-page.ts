import {
  isSupportedTargetLanguage,
  supportedTargetLanguageLabel,
  type SupportedTargetLanguage,
} from '../language/supported-target-languages';
import type { TranslationErrorCode } from '../messaging/errors';

export type BilingualPagePhase =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'error';

export type BilingualPageAction =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'clear'
  | 'toggle-translations';

export interface BilingualPageState {
  phase: BilingualPagePhase;
  total: number;
  translated: number;
  failed: number;
  /** Completed paragraphs restored from the current browser session. */
  restored?: number;
  translationsHidden: boolean;
  targetLanguage?: string;
  message?: string;
  pauseReason?: 'user' | 'interactive';
}

export const EMPTY_BILINGUAL_PAGE_STATE: BilingualPageState = {
  phase: 'idle',
  total: 0,
  translated: 0,
  failed: 0,
  translationsHidden: false,
};

/** Only completed paragraphs carry a user-visible replacement cost. */
export function bilingualPageLanguageSwitchConfirmation(
  state: BilingualPageState,
  targetLanguage: SupportedTargetLanguage,
): string | undefined {
  if (
    !isSupportedTargetLanguage(state.targetLanguage) ||
    state.targetLanguage === targetLanguage ||
    state.translated === 0
  ) return undefined;
  return `切换为${supportedTargetLanguageLabel(targetLanguage)}将清除已译 ${state.translated} 段，并重新调用翻译接口。`;
}

export interface BilingualPageReferenceContextInput {
  currentText: string;
  articleTitle?: string;
  previousSource?: string;
  previousTranslation?: string;
}

export interface BilingualPageViewportBounds {
  top: number;
  bottom: number;
}

export interface BilingualPageViewportPriority {
  tier: 0 | 1 | 2 | 3;
  distance: number;
}

const MAX_BILINGUAL_REFERENCE_CONTEXT = 800;
const MAX_BILINGUAL_TITLE_CONTEXT = 160;
const MAX_BILINGUAL_PREVIOUS_SOURCE_CONTEXT = 220;
const MAX_BILINGUAL_PREVIOUS_TRANSLATION_CONTEXT = 260;

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

/** Current reading position first, upcoming content second, and content already passed last. */
export function bilingualPageViewportPriority(
  bounds: BilingualPageViewportBounds,
  viewportHeight: number,
): BilingualPageViewportPriority {
  const height = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1);
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)) {
    return { tier: 3, distance: Number.MAX_SAFE_INTEGER };
  }
  if (bounds.bottom >= 0 && bounds.top <= height) {
    return { tier: 0, distance: Math.max(0, bounds.top) };
  }
  if (bounds.top > height) {
    return { tier: 1, distance: bounds.top - height };
  }
  return { tier: 2, distance: Math.max(0, -bounds.bottom) };
}

export function buildBilingualPageReferenceContext(
  input: BilingualPageReferenceContextInput,
  maximum = MAX_BILINGUAL_REFERENCE_CONTEXT,
): string | undefined {
  const limit = Math.max(0, Math.min(MAX_BILINGUAL_REFERENCE_CONTEXT, Math.floor(maximum)));
  if (!limit) return undefined;
  const currentText = normalizeBilingualPageText(input.currentText);
  const articleTitle = normalizeBilingualPageText(input.articleTitle ?? '');
  const previousSource = normalizeBilingualPageText(input.previousSource ?? '');
  const previousTranslation = normalizeBilingualPageText(input.previousTranslation ?? '');
  const sections: Array<{ label: string; value: string; maximum: number }> = [];
  if (articleTitle && articleTitle !== currentText) {
    sections.push({
      label: 'Article title',
      value: articleTitle,
      maximum: MAX_BILINGUAL_TITLE_CONTEXT,
    });
  }
  if (
    previousSource &&
    previousSource !== currentText &&
    previousSource !== articleTitle
  ) {
    sections.push({
      label: 'Immediately preceding source paragraph',
      value: previousSource,
      maximum: MAX_BILINGUAL_PREVIOUS_SOURCE_CONTEXT,
    });
  }
  if (previousSource && previousTranslation) {
    sections.push({
      label: previousSource === articleTitle
        ? 'Translation of the article title'
        : 'Translation of the immediately preceding paragraph',
      value: previousTranslation,
      maximum: MAX_BILINGUAL_PREVIOUS_TRANSLATION_CONTEXT,
    });
  }

  let result = '';
  for (const section of sections) {
    const prefix = `${result ? '\n\n' : ''}${section.label}:\n`;
    const available = limit - result.length - prefix.length;
    if (available <= 0) break;
    const value = section.value.slice(0, Math.min(section.maximum, available)).trim();
    if (!value) continue;
    result += `${prefix}${value}`;
  }
  return result || undefined;
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
    (state.restored === undefined || validCount(state.restored)) &&
    (state.translated as number) + (state.failed as number) <= (state.total as number) &&
    (state.restored === undefined || (state.restored as number) <= (state.translated as number)) &&
    typeof state.translationsHidden === 'boolean' &&
    (state.targetLanguage === undefined || isSupportedTargetLanguage(state.targetLanguage)) &&
    (state.message === undefined || (
      typeof state.message === 'string' && state.message.length <= 300
    )) &&
    (state.pauseReason === undefined || ['user', 'interactive'].includes(
      typeof state.pauseReason === 'string' ? state.pauseReason : '',
    ))
  );
}
