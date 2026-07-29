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
    expect(body.temperature).toBe(0);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(JSON.parse(messages[1]!.content).requiredPlaceholderTokens).toEqual([
      '⟦TEX_0001⟧',
    ]);
    expect(body.thinking).toBeUndefined();
    expect(body.response_format).toBeUndefined();
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

  it('returns a normalized model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'deepseek-v4-pro' },
              { id: 'deepseek-v4-flash' },
              { id: 'deepseek-v4-pro' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const translator = new DeepSeekTranslator();
    await expect(
      translator.listModels(
        { apiKey: 'test-key' },
        new AbortController().signal,
      ),
    ).resolves.toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('retries a rate-limited request and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"slow down"}}', {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            translation: '成功',
            warnings: [],
            segments: [],
          }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const translator = new DeepSeekTranslator();
    await expect(translator.translate(
      { text: 'Success', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
    )).resolves.toMatchObject({ translatedText: '成功' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('emits clean partial translations from an SSE response', async () => {
    const encoder = new TextEncoder();
    const deltas = [
      '{"translation":"你',
      '好","detectedLanguage":"en","warnings":[],"segments":[]}',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const content of deltas) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          ));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ));
    const partials: string[] = [];
    const translator = new DeepSeekTranslator();
    const result = await translator.translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: (value) => partials.push(value) },
    );
    expect(partials).toContain('你');
    expect(partials.at(-1)).toBe('你好');
    expect(result.translatedText).toBe('你好');
  });
});
