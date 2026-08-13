import { describe, expect, it } from 'vitest';
import type { DocumentMemorySnapshot } from '../core/document/document-memory-repository';
import {
  documentReviewButtonLabel,
  documentReviewDescription,
  summarizeDocumentReviews,
} from '../ui/document-review-summary';

function memory(
  recentTranslations: DocumentMemorySnapshot['recentTranslations'],
): DocumentMemorySnapshot {
  return {
    documentId: 'document-1',
    label: 'paper.pdf',
    updatedAt: 1,
    confirmedTerms: [],
    candidateTerms: [],
    recentTranslations,
  };
}

describe('document review summary', () => {
  it('keeps image and terminology review reasons separate while combining their count', () => {
    const summary = summarizeDocumentReviews(memory([
      {
        id: 'translation-1',
        requestId: 'request-1',
        originalText: 'The technical term appears in this image.',
        translatedText: '这张图像中出现了一个技术术语。',
        completedAt: 10,
        glossaryTermsNeedingReview: [
          { source: 'technical term', target: '固定技术译法', scope: 'global' },
          { source: 'image', target: '图像', scope: 'document' },
        ],
        review: {
          id: 'review-1',
          formulaNeedsReview: false,
          uncertainSpans: ['technical term'],
          updatedAt: 10,
        },
      },
      {
        id: 'translation-2',
        requestId: 'request-2',
        originalText: 'Already reviewed image.',
        translatedText: '已核对图像。',
        completedAt: 9,
        review: {
          id: 'review-2',
          formulaNeedsReview: true,
          uncertainSpans: [],
          updatedAt: 9,
          reviewedAt: 11,
        },
      },
    ]));

    expect(summary.imageTranslations.map((entry) => entry.requestId)).toEqual(['request-1']);
    expect(summary.terminologyTranslations).toHaveLength(1);
    expect(summary).toMatchObject({ imageCount: 1, terminologyCount: 2, totalCount: 3 });
    expect(documentReviewButtonLabel(summary)).toBe('本文 · 待核对 3');
    expect(documentReviewDescription(summary)).toBe('待核对：图像识别 1 条，术语 2 个');
  });

  it('uses a quiet default and concise single-category descriptions', () => {
    const empty = summarizeDocumentReviews();
    expect(documentReviewButtonLabel(empty)).toBe('本文');
    expect(documentReviewDescription(empty)).toBe('查看本文术语和最近翻译');

    const terminology = summarizeDocumentReviews(memory([{
      id: 'translation-1',
      requestId: 'request-1',
      originalText: 'A term.',
      translatedText: '一个术语。',
      completedAt: 1,
      glossaryTermsNeedingReview: [
        { source: 'term', target: '术语', scope: 'global' },
      ],
    }]));
    expect(documentReviewDescription(terminology)).toBe('有 1 个术语待核对');
  });
});
