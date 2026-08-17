import { describe, expect, it } from 'vitest';
import {
  isLexicalLookupCandidate,
  sanitizeLexicalLookup,
} from '../core/translation/lexical-lookup';

const request = (text: string) => ({
  text,
  contentMode: 'auto' as const,
});

describe('lexical lookup', () => {
  it('limits lookup mode to words and short phrases', () => {
    expect(isLexicalLookupCandidate(request('continuity'))).toBe(true);
    expect(isLexicalLookupCandidate(request('gradient descent method'))).toBe(true);
    expect(isLexicalLookupCandidate(request('日常网页翻译'))).toBe(true);
    expect(isLexicalLookupCandidate(request('This is already a complete sentence.'))).toBe(false);
    expect(isLexicalLookupCandidate(request('first, second'))).toBe(false);
    expect(isLexicalLookupCandidate(request(String.raw`\operatorname{argmin}`))).toBe(false);
    expect(isLexicalLookupCandidate({ ...request('continuity'), contentMode: 'latex' })).toBe(false);
    expect(isLexicalLookupCandidate({
      ...request('continuity'),
      revision: {
        rootRequestId: 'root',
        kind: 'custom',
        label: '调整',
        instruction: 'Use another wording.',
      },
    })).toBe(false);
  });

  it('sanitizes compact provider lookup metadata', () => {
    expect(sanitizeLexicalLookup({
      pronunciation: ' /ˌkɒntɪˈnjuːəti/ ',
      partOfSpeech: ' noun ',
      senses: [
        { partOfSpeech: ' noun ', meaning: ' 连续性 ' },
        { partOfSpeech: 'noun', meaning: '连续性' },
        { meaning: '连贯性' },
        { meaning: '延续状态' },
        { meaning: '第四条会被裁剪' },
      ],
    })).toEqual({
      pronunciation: '/ˌkɒntɪˈnjuːəti/',
      partOfSpeech: 'noun',
      senses: [
        { partOfSpeech: 'noun', meaning: '连续性' },
        { meaning: '连贯性' },
        { meaning: '延续状态' },
      ],
    });
    expect(sanitizeLexicalLookup({ senses: [{ meaning: '' }] })).toBeUndefined();
  });
});
