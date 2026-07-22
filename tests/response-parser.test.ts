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
      }),
    );
    expect(result).toEqual({
      translatedText: '翻译结果',
      detectedLanguage: 'en',
      warnings: [],
    });
  });

  it('accepts a JSON code fence defensively', () => {
    const result = parseStructuredTranslation(
      '```json\n{"translation":"结果","detectedLanguage":"en","warnings":[]}\n```',
    );
    expect(result.translatedText).toBe('结果');
  });

  it('extracts content from the provider envelope', () => {
    const content = parseDeepSeekEnvelope({
      choices: [{ message: { content: '{"translation":"ok"}' } }],
    });
    expect(content).toContain('translation');
  });

  it('rejects empty and malformed content', () => {
    expect(() => parseDeepSeekEnvelope({ choices: [] })).toThrow(TranslationError);
    expect(() => parseStructuredTranslation('not-json')).toThrow(TranslationError);
    expect(() => parseStructuredTranslation('{"translation":""}')).toThrow(
      TranslationError,
    );
  });
});
