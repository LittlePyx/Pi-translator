import type { TranslationBatchItem } from './types';

export const MAX_DOCUMENT_TRANSLATION_BATCH_ITEMS = 6;
export const MAX_DOCUMENT_TRANSLATION_BATCH_TEXT = 5_200;

export interface DocumentTranslationBatchCandidate<T> {
  value: T;
  text: string;
  urgent?: boolean;
}

/**
 * Builds a provider-sized batch without splitting a semantic block. Urgent
 * work stays isolated so an explicit retry never waits behind background work.
 */
export function takeDocumentTranslationBatch<T>(
  candidates: readonly DocumentTranslationBatchCandidate<T>[],
  options: {
    maximumItems?: number;
    maximumTextLength?: number;
  } = {},
): DocumentTranslationBatchCandidate<T>[] {
  const maximumItems = Math.max(
    1,
    Math.min(MAX_DOCUMENT_TRANSLATION_BATCH_ITEMS, options.maximumItems ?? MAX_DOCUMENT_TRANSLATION_BATCH_ITEMS),
  );
  const maximumTextLength = Math.max(
    1,
    Math.min(MAX_DOCUMENT_TRANSLATION_BATCH_TEXT, options.maximumTextLength ?? MAX_DOCUMENT_TRANSLATION_BATCH_TEXT),
  );
  const first = candidates[0];
  if (!first) return [];
  if (first.urgent) return [first];

  const batch: DocumentTranslationBatchCandidate<T>[] = [];
  let textLength = 0;
  for (const candidate of candidates) {
    if (candidate.urgent || batch.length >= maximumItems) break;
    const nextLength = textLength + candidate.text.trim().length;
    if (batch.length && nextLength > maximumTextLength) break;
    batch.push(candidate);
    textLength = nextLength;
    if (textLength >= maximumTextLength) break;
  }
  return batch;
}

/** Estimates normal provider calls using the same item and text limits as live batching. */
export function estimateDocumentTranslationBatchCount(texts: readonly string[]): number {
  let remaining = texts
    .map((text, index) => ({ value: index, text }))
    .filter((candidate) => candidate.text.trim());
  let count = 0;
  while (remaining.length) {
    const batch = takeDocumentTranslationBatch(remaining);
    if (!batch.length) break;
    remaining = remaining.slice(batch.length);
    count += 1;
  }
  return count;
}

export function validTranslationBatchItems(
  value: unknown,
): value is TranslationBatchItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DOCUMENT_TRANSLATION_BATCH_ITEMS) {
    return false;
  }
  const ids = new Set<string>();
  let totalLength = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => key !== 'id' && key !== 'text') ||
      typeof record.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(record.id) ||
      ids.has(record.id) ||
      typeof record.text !== 'string' ||
      !record.text.trim()
    ) return false;
    ids.add(record.id);
    totalLength += record.text.trim().length;
    if (totalLength > MAX_DOCUMENT_TRANSLATION_BATCH_TEXT) return false;
  }
  return true;
}
