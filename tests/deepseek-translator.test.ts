import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import { DeepSeekTranslator } from '../core/translation/deepseek-translator';

const options = {
  model: 'deepseek-v4-flash',
  sourceLanguage: 'auto' as const,
  targetLanguage: 'zh-CN',
  style: 'academic' as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeepSeek translator', () => {
  it('sends the expected chat completion request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translation: '证明 ⟦TEX_0001⟧。',
                  detectedLanguage: 'en',
                  warnings: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const translator = new DeepSeekTranslator();
    const result = await translator.translate(
      { text: 'Prove ⟦TEX_0001⟧.', placeholderTokens: ['⟦TEX_0001⟧'] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
    );

    expect(result.translatedText).toContain('⟦TEX_0001⟧');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('maps an authentication failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
    );
    const translator = new DeepSeekTranslator();
    await expect(
      translator.translate(
        { text: 'Text', placeholderTokens: [] },
        options,
        { apiKey: 'bad-key' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' } satisfies Partial<TranslationError>);
  });

  it('checks whether the configured model is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'another-model' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const translator = new DeepSeekTranslator();
    await expect(
      translator.testConnection(
        { model: options.model },
        { apiKey: 'test-key' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' } satisfies Partial<TranslationError>);
  });
});
