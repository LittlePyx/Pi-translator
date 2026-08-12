import type { TranslationHistoryEntry } from '../core/translation/types';

type SearchableHistoryEntry = Pick<
  TranslationHistoryEntry,
  'originalText' | 'translatedText' | 'sourceHost' | 'alignedSegments'
>;

function normalizeHistorySearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function translationHistorySearchTerms(query: string): string[] {
  return normalizeHistorySearchText(query).split(' ').filter(Boolean);
}

export function searchTranslationHistory<T extends SearchableHistoryEntry>(
  entries: readonly T[],
  query: string,
): T[] {
  const terms = translationHistorySearchTerms(query);
  if (!terms.length) return [...entries];
  return entries.filter((entry) => {
    const searchable = normalizeHistorySearchText([
      entry.originalText,
      entry.translatedText,
      entry.sourceHost ?? '',
      ...(entry.alignedSegments?.flatMap((segment) => [
        segment.originalText,
        segment.translatedText,
      ]) ?? []),
    ].join(' '));
    return terms.every((term) => searchable.includes(term));
  });
}
