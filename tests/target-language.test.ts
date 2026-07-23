import { describe, expect, it } from 'vitest';
import { isLikelyTargetLanguage } from '../core/language/target-language';

describe('target language detection', () => {
  it('detects Chinese prose but keeps short and mixed selections visible', () => {
    expect(isLikelyTargetLanguage('这是一段用于测试的中文内容。', 'zh-CN')).toBe(true);
    expect(isLikelyTargetLanguage('中文', 'zh-CN')).toBe(false);
    expect(isLikelyTargetLanguage('中文 translation example', 'zh-CN')).toBe(false);
  });

  it('requires Japanese kana instead of treating all Han text as Japanese', () => {
    expect(
      isLikelyTargetLanguage('これは翻訳済みの日本語テキストです。', 'ja'),
    ).toBe(true);
    expect(isLikelyTargetLanguage('这是中文内容', 'ja')).toBe(false);
  });

  it('distinguishes common English, German, and French prose', () => {
    expect(
      isLikelyTargetLanguage(
        'This is a short example of the text that is already in English.',
        'en',
      ),
    ).toBe(true);
    expect(
      isLikelyTargetLanguage(
        'Das ist ein Beispiel für einen Text, der bereits auf Deutsch ist.',
        'de',
      ),
    ).toBe(true);
    expect(
      isLikelyTargetLanguage(
        'Ceci est un exemple de texte qui est déjà écrit en français.',
        'fr',
      ),
    ).toBe(true);
  });

  it('does not guess unsupported languages or ambiguous short Latin text', () => {
    expect(isLikelyTargetLanguage('Safe code browsing', 'en')).toBe(false);
    expect(isLikelyTargetLanguage('Texto de ejemplo', 'es')).toBe(false);
  });
});
