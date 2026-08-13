import type {
  DocumentMemorySnapshot,
  DocumentMemoryTranslation,
} from '../core/document/document-memory-repository';
import type { ScopedGlossaryTerm } from '../core/translation/types';

export interface DocumentTerminologyReview {
  translation: DocumentMemoryTranslation;
  terms: ScopedGlossaryTerm[];
}

export interface DocumentReviewSummary {
  imageTranslations: DocumentMemoryTranslation[];
  terminologyTranslations: DocumentTerminologyReview[];
  imageCount: number;
  terminologyCount: number;
  totalCount: number;
}

export function summarizeDocumentReviews(
  memory?: DocumentMemorySnapshot,
): DocumentReviewSummary {
  const recentTranslations = memory?.recentTranslations ?? [];
  const imageTranslations = recentTranslations.filter(
    (entry) => entry.review && !entry.review.reviewedAt,
  );
  const terminologyTranslations = recentTranslations.flatMap((translation) => {
    const terms = translation.glossaryTermsNeedingReview ?? [];
    return terms.length ? [{ translation, terms }] : [];
  });
  const terminologyCount = terminologyTranslations.reduce(
    (count, review) => count + review.terms.length,
    0,
  );

  return {
    imageTranslations,
    terminologyTranslations,
    imageCount: imageTranslations.length,
    terminologyCount,
    totalCount: imageTranslations.length + terminologyCount,
  };
}

export function documentReviewButtonLabel(summary: DocumentReviewSummary): string {
  return summary.totalCount ? `本文 · 待核对 ${summary.totalCount}` : '本文';
}

export function documentReviewDescription(summary: DocumentReviewSummary): string {
  if (!summary.totalCount) return '查看本文术语和最近翻译';
  if (summary.imageCount && summary.terminologyCount) {
    return `待核对：图像识别 ${summary.imageCount} 条，术语 ${summary.terminologyCount} 个`;
  }
  if (summary.imageCount) return `有 ${summary.imageCount} 条图像识别结果待核对`;
  return `有 ${summary.terminologyCount} 个术语待核对`;
}
