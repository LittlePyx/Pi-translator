import { describe, expect, it, vi } from 'vitest';
import { protectLatex } from '../core/latex/protector';
import { translateWithLatexRetry } from '../core/translation/latex-safe-translation';
import type {
  PreparedTranslationInput,
  Translator,
  TranslationOptions,
} from '../core/translation/types';

const options: TranslationOptions = {
  model: 'test-model',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
};

describe('LaTeX-safe translation retry', () => {
  it('retries once with strict preservation and restores valid LaTeX', async () => {
    const protectedLatex = protectLatex('Use $x > 0$ here.');
    const token = protectedLatex.fragments[0]!.token;
    const translate = vi.fn()
      .mockResolvedValueOnce({ translatedText: '在这里使用 x。', warnings: [] })
      .mockResolvedValueOnce({ translatedText: `在这里使用 ${token}。`, warnings: [] });
    const input: PreparedTranslationInput = {
      text: protectedLatex.protectedText,
      placeholderTokens: [token],
    };

    const result = await translateWithLatexRetry(
      { translate } as Pick<Translator, 'translate'>,
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1' },
      new AbortController().signal,
      protectedLatex,
      undefined,
    );

    expect(result.restored.text).toBe('在这里使用 $x > 0$。');
    expect(translate).toHaveBeenCalledTimes(2);
    expect((translate.mock.calls[1]![0] as PreparedTranslationInput)
      .strictPlaceholderPreservation).toBe(true);
  });

  it('still blocks the result when the corrective retry is invalid', async () => {
    const protectedLatex = protectLatex('See \\cite{paper}.');
    const translate = vi.fn().mockResolvedValue({
      translatedText: '参见该论文。',
      warnings: [],
    });

    await expect(translateWithLatexRetry(
      { translate } as Pick<Translator, 'translate'>,
      {
        text: protectedLatex.protectedText,
        placeholderTokens: protectedLatex.fragments.map((fragment) => fragment.token),
      },
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1' },
      new AbortController().signal,
      protectedLatex,
      undefined,
    )).rejects.toMatchObject({ code: 'LATEX_VALIDATION_FAILED' });
    expect(translate).toHaveBeenCalledTimes(2);
  });
});
