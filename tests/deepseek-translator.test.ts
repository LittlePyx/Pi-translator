import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import { DeepSeekTranslator } from '../core/translation/deepseek-translator';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';

const options = {
  model: 'deepseek-v4-flash',
  sourceLanguage: 'auto' as const,
  targetLanguage: 'zh-CN',
  style: 'academic' as const,
};

function stubCapabilityStorage(): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => Object.assign(values, next)),
      },
    },
  });
  return values;
}

afterEach(() => {
  vi.useRealTimers();
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
    expect(body.thinking).toEqual({ type: 'disabled' });
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

  it('tests the configured model with a low-cost chat completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const translator = new DeepSeekTranslator();
    await expect(
      translator.testConnection(
        { model: options.model },
        { apiKey: 'test-key' },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe(options.model);
    expect(body.max_tokens).toBe(8);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('disables thinking for direct Qwen text translation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ translation: '译文', warnings: [] }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenAiCompatibleTranslator().translate(
      { text: 'Source', placeholderTokens: [] },
      { ...options, model: 'qwen3.7-plus' },
      {
        apiKey: 'test-key',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      new AbortController().signal,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.enable_thinking).toBe(false);
  });

  it('remembers an explicit streaming rejection for the same Base URL and model', async () => {
    stubCapabilityStorage();
    const content = JSON.stringify({ translation: '璇戞枃', warnings: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Unknown parameter: stream; streaming is not supported.' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementation(async () => new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const requestOptions = { ...options, model: 'stream-memory-model' };
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await translator.translate(
      { text: 'First', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
      { onPartialText: () => undefined },
    );
    await translator.translate(
      { text: 'Second', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
      { onPartialText: () => undefined },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).stream))
      .toEqual([true, false, false]);
  });

  it('does not remember an ambiguous network failure as no streaming support', async () => {
    stubCapabilityStorage();
    const encoder = new TextEncoder();
    const content = JSON.stringify({ translation: 'streamed', warnings: [] });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const requestOptions = { ...options, model: 'network-memory-model' };
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await expect(translator.translate(
      { text: 'First', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(translator.translate(
      { text: 'Second', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).resolves.toMatchObject({ translatedText: 'streamed' });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).stream).toBe(true);
  });

  it('remembers an explicitly rejected thinking control parameter', async () => {
    stubCapabilityStorage();
    const content = JSON.stringify({ translation: '璇戞枃', warnings: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Unknown parameter: enable_thinking' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementation(async () => new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const requestOptions = { ...options, model: 'thinking-memory-model' };
    const credentials = {
      apiKey: 'test-key',
      apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    };

    await translator.translate(
      { text: 'First', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
    );
    await translator.translate(
      { text: 'Second', placeholderTokens: [] },
      requestOptions,
      credentials,
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]?.enable_thinking).toBe(false);
    expect(bodies[1]?.enable_thinking).toBeUndefined();
    expect(bodies[2]?.enable_thinking).toBeUndefined();
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

  it('does not retry a 429 quota exhaustion response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'insufficient_quota',
        type: 'insufficient_quota',
        message: 'You exceeded your current quota, please check your plan and billing details.',
      },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DeepSeekTranslator().translate(
      { text: 'Text', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      retryable: false,
    } satisfies Partial<TranslationError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not replay an ambiguous generation network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DeepSeekTranslator().translate(
      { text: 'Text', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'NETWORK_ERROR' } satisfies Partial<TranslationError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not replay a timed-out generation request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = new DeepSeekTranslator().translate(
      { text: 'Text', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(outcome).resolves.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: false,
    } satisfies Partial<TranslationError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('allows a healthy SSE response to run beyond the connection timeout', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            if (step === 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [{ delta: { content: '{"translation":"仍在' } }],
              })}\n\n`));
              step += 1;
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [{ delta: { content: '输出","warnings":[]}' } }],
              })}\n\ndata: [DONE]\n\n`));
              controller.close();
            }
            resolve();
          }, 20_000);
        });
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    const outcome = new DeepSeekTranslator().translate(
      { text: 'Keep streaming', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(outcome).resolves.toMatchObject({ translatedText: '仍在输出' });
  });

  it('times out an SSE response only after a full idle interval', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    const outcome = new DeepSeekTranslator().translate(
      { text: 'Stalled stream', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: false,
    } satisfies Partial<TranslationError>);
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

  it('finishes as soon as the provider sends a stop reason without waiting for the stream to close', async () => {
    const encoder = new TextEncoder();
    const content = JSON.stringify({ translation: 'completed', warnings: [] });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          choices: [{ delta: { content }, finish_reason: 'stop' }],
        })}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    await expect(new DeepSeekTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).resolves.toMatchObject({ translatedText: 'completed' });
    expect(cancelled).toBe(true);
  });

  it('rejects a provider error sent after partial SSE content', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"translation":"partial' } }] })}\n\n`,
        ));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          error: { code: 'server_error', message: 'Provider disconnected unexpectedly' },
          choices: [{ delta: { content: '' }, finish_reason: 'error' }],
        })}\n\n`));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DeepSeekTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('classifies an unexpected SSE reader abort as a retryable network recovery', async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1;
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: '{"translation":"partial' } }] })}\n\n`,
          ));
          return;
        }
        controller.error(new DOMException('Remote stream reset.', 'AbortError'));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
    const partials: string[] = [];

    await expect(new DeepSeekTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: (value) => partials.push(value) },
    )).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'The API response stream was interrupted.',
    });
    expect(partials).toContain('partial');
  });

  it('never replays a numeric provider error after an SSE event was received', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"translation":"partial' } }] })}\n\n`,
        ));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          error: { code: '500', message: 'Provider failed after starting generation' },
        })}\n\n`));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DeepSeekTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', httpStatus: 500 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not downgrade a generic 400 response to a second non-streaming request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'The prompt exceeds the maximum context length.' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      { ...options, model: 'generic-400-model' },
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', httpStatus: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true);
  });

  it.each(['length', 'content_filter'] as const)(
    'rejects an SSE response terminated with %s',
    async (finishReason) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            choices: [{
              delta: { content: '{"translation":"truncated"}' },
              finish_reason: finishReason,
            }],
          })}\n\n`));
          controller.close();
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })));

      await expect(new DeepSeekTranslator().translate(
        { text: 'Hello', placeholderTokens: [] },
        options,
        { apiKey: 'test-key' },
        new AbortController().signal,
        { onPartialText: () => undefined },
      )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
    },
  );

  it('processes a final SSE marker left in the tail buffer', async () => {
    const encoder = new TextEncoder();
    const content = JSON.stringify({ translation: 'tail parsed', warnings: [] });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]`,
        ));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    await expect(new DeepSeekTranslator().translate(
      { text: 'Hello', placeholderTokens: [] },
      options,
      { apiKey: 'test-key' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).resolves.toMatchObject({ translatedText: 'tail parsed' });
  });
});
