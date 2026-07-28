import { describe, expect, it } from 'vitest';
import { splitTranslationSegments } from '../core/translation/sentence-segmentation';

describe('sentence segmentation', () => {
  it('assigns stable ids without changing the local source text', () => {
    expect(splitTranslationSegments('First sentence. Second sentence!', 'en')).toEqual([
      { id: 'S1', text: 'First sentence.' },
      { id: 'S2', text: 'Second sentence!' },
    ]);
  });

  it('supports Chinese punctuation', () => {
    const segments = splitTranslationSegments('第一句。第二句！', 'zh-CN');
    expect(segments.map((segment) => segment.text)).toEqual(['第一句。', '第二句！']);
  });
});
