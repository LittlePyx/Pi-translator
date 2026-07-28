import { describe, expect, it } from 'vitest';
import { sentenceContext } from '../core/selection/selection-context';

describe('selection context', () => {
  it('returns only the sentence containing the selected phrase', () => {
    expect(
      sentenceContext(
        'The estimator converges. It is stable under perturbations. This concludes the proof.',
        'stable under perturbations',
      ),
    ).toBe('It is stable under perturbations.');
  });

  it('returns undefined when the selection is not present', () => {
    expect(sentenceContext('A paragraph.', 'missing')).toBeUndefined();
  });
});
