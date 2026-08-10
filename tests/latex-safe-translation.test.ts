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
  it('reports only the provider phase when no LaTeX needs validation', async () => {
    const translate = vi.fn().mockResolvedValue({
      translatedText: 'Translated plain text.',
      warnings: [],
    });
    const onPhase = vi.fn();

    await translateWithLatexRetry(
      { translate } as Pick<Translator, 'translate'>,
      { text: 'Plain text.', placeholderTokens: [] },
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1' },
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      onPhase,
    );

    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual(['provider']);
  });

  it('reports provider then validation for a valid protected translation', async () => {
    const protectedLatex = protectLatex('Use $x > 0$ here.');
    const token = protectedLatex.fragments[0]!.token;
    const translate = vi.fn().mockResolvedValue({
      translatedText: `Use ${token} here.`,
      warnings: [],
    });
    const onPhase = vi.fn();

    await translateWithLatexRetry(
      { translate } as Pick<Translator, 'translate'>,
      { text: protectedLatex.protectedText, placeholderTokens: [token] },
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1' },
      new AbortController().signal,
      protectedLatex,
      undefined,
      undefined,
      onPhase,
    );

    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      'provider',
      'validating-latex',
    ]);
  });

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
    const onPhase = vi.fn();

    const result = await translateWithLatexRetry(
      { translate } as Pick<Translator, 'translate'>,
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1' },
      new AbortController().signal,
      protectedLatex,
      undefined,
      undefined,
      onPhase,
    );

    expect(result.restored.text).toBe('在这里使用 $x > 0$。');
    expect(translate).toHaveBeenCalledTimes(2);
    expect((translate.mock.calls[1]![0] as PreparedTranslationInput)
      .strictPlaceholderPreservation).toBe(true);
    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      'provider',
      'validating-latex',
      'provider',
      'validating-latex',
    ]);
  });

  it('falls back to translating prose segments and reconstructs LaTeX locally', async () => {
    const protectedLatex = protectLatex('See \\cite{paper}.');
    const onPhase = vi.fn();
    const translate = vi.fn()
      .mockResolvedValueOnce({ translatedText: '参见该论文。', warnings: [] })
      .mockResolvedValueOnce({ translatedText: '参见该论文。', warnings: [] })
      .mockImplementationOnce(async (input: PreparedTranslationInput) => ({
        translatedText: 'unused',
        warnings: [],
        alignedSegments: input.segments?.map((segment) => ({
          id: segment.id,
          translatedText: segment.text === 'See' ? '参见' : segment.text,
        })),
      }));

    const result = await translateWithLatexRetry(
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
      undefined,
      onPhase,
    );

    expect(result.restored.text).toBe('参见 \\cite{paper}.');
    expect(result.restored.warnings).toContainEqual(expect.objectContaining({
      code: 'PLAIN_TEXT_FALLBACK',
    }));
    expect(translate).toHaveBeenCalledTimes(3);
    expect((translate.mock.calls[2]![0] as PreparedTranslationInput).placeholderTokens).toEqual([]);
    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      'provider',
      'validating-latex',
      'provider',
      'validating-latex',
      'provider',
    ]);
  });

  it('still blocks the result when the provider omits prose fallback segments', async () => {
    const protectedLatex = protectLatex('See \\cite{paper}.');
    const translate = vi.fn().mockResolvedValue({
      translatedText: '参见该论文。',
      warnings: [],
    });
    const onDiagnostics = vi.fn();

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
      onDiagnostics,
    )).rejects.toMatchObject({ code: 'LATEX_VALIDATION_FAILED' });
    expect(translate).toHaveBeenCalledTimes(3);
    expect(onDiagnostics).toHaveBeenCalledTimes(2);
    expect(onDiagnostics.mock.calls.at(-1)?.[0]).toEqual({
      latexValidationMs: expect.any(Number),
    });
  });
});
