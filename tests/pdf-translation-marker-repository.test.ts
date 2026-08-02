import { describe, expect, it } from 'vitest';
import {
  normalizePdfTranslationMarkerState,
  normalizePersistedPdfTranslationMarker,
} from '../core/pdf/translation-marker-repository';
import type { PersistedPdfTranslationMarker } from '../core/content/session-translation-markers';

function marker(
  markerId: string,
  pageNumber: number,
  createdAt: number,
): PersistedPdfTranslationMarker {
  return {
    markerId,
    anchor: {
      kind: 'text-quote',
      pageNumber,
      sourceText: `Source ${markerId}`,
      prefix: 'Before ',
      suffix: ' after',
    },
    content: {
      originalText: `Source ${markerId}`,
      translatedText: `译文 ${markerId}`,
      sourceTitle: 'paper.pdf',
      pageNumber,
    },
    createdAt,
  };
}

describe('Pi PDF persistent translation markers', () => {
  it('normalizes, sorts by page, and removes equivalent duplicate notes', () => {
    const older = marker('older', 3, 10);
    const newerDuplicate = {
      ...older,
      markerId: 'newer',
      createdAt: 20,
    };
    const firstPage = marker('first-page', 1, 30);
    const state = normalizePdfTranslationMarkerState({
      enabled: true,
      markers: [older, newerDuplicate, firstPage],
      updatedAt: 40,
    });

    expect(state?.enabled).toBe(true);
    expect(state?.markers.map((item) => item.markerId)).toEqual(['first-page', 'newer']);
  });

  it('limits each document to 100 safe marker records', () => {
    const state = normalizePdfTranslationMarkerState({
      enabled: false,
      markers: Array.from({ length: 120 }, (_, index) => marker(`m-${index}`, index + 1, index)),
    });

    expect(state?.enabled).toBe(false);
    expect(state?.markers).toHaveLength(100);
    expect(state?.markers.at(0)?.markerId).toBe('m-20');
    expect(state?.markers.at(-1)?.markerId).toBe('m-119');
  });

  it('bounds unusually long marker fields before they reach extension storage', () => {
    const normalized = normalizePersistedPdfTranslationMarker({
      ...marker('oversized', 1, 1),
      content: {
        originalText: `source-${'a'.repeat(10_000)}`,
        translatedText: `译文-${'译'.repeat(10_000)}`,
        sourceTitle: 'paper.pdf',
      },
    });

    expect(normalized?.content.originalText.length).toBe(4_000);
    expect(normalized?.content.translatedText.length).toBe(4_000);
  });

  it('rejects invalid regions instead of restoring them at a guessed location', () => {
    expect(normalizePersistedPdfTranslationMarker({
      markerId: 'invalid-region',
      anchor: {
        kind: 'region',
        pageNumber: 2,
        leftRatio: 0.2,
        topRatio: 0.3,
        widthRatio: 0,
        heightRatio: 0.2,
      },
      content: {
        originalText: 'source',
        translatedText: '译文',
        sourceTitle: 'paper.pdf',
      },
      createdAt: 1,
    })).toBeUndefined();
  });

  it('clamps a valid region to the PDF page boundary', () => {
    const normalized = normalizePersistedPdfTranslationMarker({
      markerId: 'region',
      anchor: {
        kind: 'region',
        pageNumber: 2.4,
        leftRatio: 0.8,
        topRatio: 0.85,
        widthRatio: 0.5,
        heightRatio: 0.4,
      },
      content: {
        originalText: 'source',
        translatedText: '译文',
        sourceTitle: 'paper.pdf',
      },
      createdAt: 1,
    });

    expect(normalized?.anchor.kind).toBe('region');
    if (normalized?.anchor.kind !== 'region') return;
    expect(normalized.anchor.pageNumber).toBe(2);
    expect(normalized.anchor.leftRatio).toBe(0.8);
    expect(normalized.anchor.topRatio).toBe(0.85);
    expect(normalized.anchor.widthRatio).toBeCloseTo(0.2);
    expect(normalized.anchor.heightRatio).toBeCloseTo(0.15);
  });
});
