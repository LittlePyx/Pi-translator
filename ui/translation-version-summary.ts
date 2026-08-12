import type {
  TranslateResult,
  TranslationRevisionScope,
} from '../core/translation/types';

export type TranslationVersionChangeKind = 'same' | 'segments' | 'full';

export interface TranslationVersionChangeSummary {
  kind: TranslationVersionChangeKind;
  changedSegmentIds: string[];
  changedCount: number;
}

function normalizedVersionText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function translationVersionLabel(result: TranslateResult): string {
  return result.revision?.label.trim() || '初始译文';
}

export function translationVersionScopeLabel(
  scope: TranslationRevisionScope | undefined,
): string | undefined {
  if (scope === 'current') return '仅当前选择';
  if (scope === 'document') return '本文记忆';
  if (scope === 'global') return '全局偏好';
  return undefined;
}

export function summarizeTranslationVersionChange(
  current: TranslateResult,
  comparison: TranslateResult,
): TranslationVersionChangeSummary {
  const currentSegments = current.alignedSegments;
  const comparisonSegments = comparison.alignedSegments;
  if (currentSegments?.length && comparisonSegments?.length) {
    const currentById = new Map(currentSegments.map((segment) => [segment.id, segment]));
    const comparisonById = new Map(comparisonSegments.map((segment) => [segment.id, segment]));
    const orderedIds = [
      ...currentSegments.map((segment) => segment.id),
      ...comparisonSegments
        .map((segment) => segment.id)
        .filter((id) => !currentById.has(id)),
    ];
    const changedSegmentIds = orderedIds.filter((id) => {
      const left = currentById.get(id);
      const right = comparisonById.get(id);
      return !left || !right ||
        normalizedVersionText(left.originalText) !== normalizedVersionText(right.originalText) ||
        normalizedVersionText(left.translatedText) !== normalizedVersionText(right.translatedText);
    });
    return {
      kind: changedSegmentIds.length ? 'segments' : 'same',
      changedSegmentIds,
      changedCount: changedSegmentIds.length,
    };
  }
  const same = normalizedVersionText(current.originalText) ===
      normalizedVersionText(comparison.originalText) &&
    normalizedVersionText(current.translatedText) ===
      normalizedVersionText(comparison.translatedText);
  return {
    kind: same ? 'same' : 'full',
    changedSegmentIds: [],
    changedCount: same ? 0 : 1,
  };
}
