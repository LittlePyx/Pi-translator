import { describe, expect, it } from 'vitest';
import {
  findAppliedGlossaryTerms,
  findGlossaryTermEvidence,
} from '../core/translation/applied-glossary';

describe('applied glossary evidence', () => {
  const glossary = [
    { source: 'attention', target: '注意力', scope: 'document' as const },
    { source: 'large language model', target: '大语言模型', scope: 'global' as const },
  ];

  it('reports a mapping only when both source and configured target are present', () => {
    expect(findAppliedGlossaryTerms(
      'An attention layer improves the large language model.',
      '注意力层改善了语言模型。',
      glossary,
    )).toEqual([
      { source: 'attention', target: '注意力', scope: 'document' },
    ]);
  });

  it('separates source matches whose configured target needs review', () => {
    expect(findGlossaryTermEvidence(
      'An attention layer improves the large language model.',
      '注意机制层改善了语言模型。',
      glossary,
    )).toEqual({
      applied: [],
      needsReview: [
        { source: 'attention', target: '注意力', scope: 'document' },
        { source: 'large language model', target: '大语言模型', scope: 'global' },
      ],
    });
  });

  it('matches case and flexible whitespace while keeping latin word boundaries', () => {
    expect(findAppliedGlossaryTerms(
      'A LARGE\nLANGUAGE MODEL uses this pattern; inattentional does not count.',
      '该大语言模型使用这一模式。',
      glossary,
    )).toEqual([
      { source: 'large language model', target: '大语言模型', scope: 'global' },
    ]);
    expect(findAppliedGlossaryTerms(
      'The inattentional response differs.',
      '注意力反应不同。',
      glossary,
    )).toEqual([]);
  });

  it('deduplicates source mappings and respects the display limit', () => {
    expect(findAppliedGlossaryTerms(
      'attention and model',
      '注意力和模型',
      [
        { source: 'attention', target: '注意力', scope: 'document' },
        { source: 'Attention', target: '注意力', scope: 'global' },
        { source: 'model', target: '模型', scope: 'global' },
      ],
      1,
    )).toEqual([
      { source: 'attention', target: '注意力', scope: 'document' },
    ]);
  });

  it('limits applied and review evidence independently', () => {
    expect(findGlossaryTermEvidence(
      'attention model',
      '注意力系统',
      [
        { source: 'attention', target: '注意力', scope: 'document' },
        { source: 'model', target: '模型', scope: 'global' },
      ],
      1,
    )).toEqual({
      applied: [{ source: 'attention', target: '注意力', scope: 'document' }],
      needsReview: [{ source: 'model', target: '模型', scope: 'global' }],
    });
  });
});
