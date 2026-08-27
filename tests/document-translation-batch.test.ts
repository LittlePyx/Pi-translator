import { describe, expect, it } from 'vitest';
import {
  takeDocumentTranslationBatch,
  validTranslationBatchItems,
} from '../core/translation/document-batch';

describe('document translation batching', () => {
  it('adapts to both item and text limits without splitting a block', () => {
    const candidates = [
      { value: 'a', text: 'a'.repeat(1_900) },
      { value: 'b', text: 'b'.repeat(1_900) },
      { value: 'c', text: 'c'.repeat(1_900) },
      { value: 'd', text: 'd'.repeat(50) },
    ];
    expect(takeDocumentTranslationBatch(candidates).map((item) => item.value))
      .toEqual(['a', 'b']);
    expect(takeDocumentTranslationBatch(candidates, { maximumItems: 1 }).map((item) => item.value))
      .toEqual(['a']);
  });

  it('keeps urgent retries isolated', () => {
    expect(takeDocumentTranslationBatch([
      { value: 'retry', text: 'retry', urgent: true },
      { value: 'background', text: 'background' },
    ]).map((item) => item.value)).toEqual(['retry']);
  });

  it('rejects duplicate ids, unknown fields, empty text, and oversized batches', () => {
    expect(validTranslationBatchItems([
      { id: 'P1B1', text: 'First block.' },
      { id: 'P1B2', text: 'Second block.' },
    ])).toBe(true);
    expect(validTranslationBatchItems([
      { id: 'same', text: 'First.' },
      { id: 'same', text: 'Second.' },
    ])).toBe(false);
    expect(validTranslationBatchItems([{ id: 'one', text: '', extra: true }])).toBe(false);
    expect(validTranslationBatchItems(Array.from({ length: 7 }, (_, index) => ({
      id: `B${index}`,
      text: 'block',
    })))).toBe(false);
  });
});
