import { describe, expect, it } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import {
  parseDeepSeekEnvelope,
  parseStructuredTranslation,
} from '../core/translation/response-parser';

describe('DeepSeek response parsing', () => {
  it('parses a structured translation', () => {
    const result = parseStructuredTranslation(
      JSON.stringify({
        translation: '翻译结果',
        detectedLanguage: 'en',
        warnings: [],
        segments: [{ id: 'S1', translation: '第一句' }],
      }),
    );
    expect(result).toEqual({
      translatedText: '翻译结果',
      detectedLanguage: 'en',
      warnings: [],
      alignedSegments: [{ id: 'S1', translatedText: '第一句' }],
      structuredResponse: true,
    });
  });

  it('accepts a JSON code fence defensively', () => {
    const result = parseStructuredTranslation(
      '```json\n{"translation":"结果","detectedLanguage":"en","warnings":[]}\n```',
    );
    expect(result.translatedText).toBe('结果');
  });

  it('sanitizes a small set of document-specific term candidates', () => {
    const result = parseStructuredTranslation(JSON.stringify({
      translation: '译文',
      warnings: [],
      termCandidates: [
        { source: ' adaptive   sensing ', target: ' 自适应感知 ' },
        { source: 'same', target: 'same' },
        { source: '', target: 'empty' },
      ],
    }));
    expect(result.termCandidates).toEqual([
      { source: 'adaptive sensing', target: '自适应感知' },
    ]);
  });

  it('extracts content from the provider envelope', () => {
    const content = parseDeepSeekEnvelope({
      choices: [{ message: { content: '{"translation":"ok"}' } }],
    });
    expect(content).toContain('translation');
  });

  it('falls back to plain text but rejects empty structured translations', () => {
    expect(() => parseDeepSeekEnvelope({ choices: [] })).toThrow(TranslationError);
    expect(parseStructuredTranslation('plain translated text')).toEqual({
      translatedText: 'plain translated text',
      warnings: [],
      structuredResponse: false,
    });
    expect(() => parseStructuredTranslation('{"translation":""}')).toThrow(
      TranslationError,
    );
  });
});
