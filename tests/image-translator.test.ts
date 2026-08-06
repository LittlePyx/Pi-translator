import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapHttpError,
  OpenAiCompatibleTranslator,
  parseImageTranslation,
  VISION_CAPABILITY_TEST_IMAGE_DATA_URL,
} from '../core/translation/openai-compatible-translator';
import {
  assertSafeImageTranslationText,
  createImageOutputSafetyContext,
  MAX_IMAGE_TRANSLATION_TEXT_LENGTH,
} from '../core/translation/image-output-safety';
import { updateApiModelCapabilities } from '../core/translation/api-capability-repository';

const input = {
  imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  imageWidth: 320,
  imageHeight: 180,
};

const options = {
  model: 'qwen3.7-plus',
  sourceLanguage: 'auto' as const,
  targetLanguage: 'zh-CN',
  style: 'academic' as const,
};

function stubCapabilityStorage(): void {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => Object.assign(values, next)),
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('image region translator', () => {
  it('tests image-input capability with a bundled visual challenge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'K7M2' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().testVisionCapability(
      { model: 'qwen3.7-plus' },
      {
        apiKey: 'test-key',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      new AbortController().signal,
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number;
      stream: boolean;
      enable_thinking?: boolean;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.max_tokens).toBe(12);
    expect(body.stream).toBe(false);
    expect(body.enable_thinking).toBe(false);
    expect(body.messages[0]?.content).toContainEqual({
      type: 'image_url',
      image_url: { url: VISION_CAPABILITY_TEST_IMAGE_DATA_URL },
    });
    const prompt = body.messages[0]?.content.find((item) => item.type === 'text');
    expect(prompt?.text).not.toContain('K7M2');
    expect(JSON.stringify(body)).not.toContain(input.imageDataUrl);
  });

  it('rejects a text-only response that does not solve the visual challenge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(new OpenAiCompatibleTranslator().testVisionCapability(
      { model: 'text-only-model' },
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED', retryable: false });
  });

  it('does not poison real image translation when the visual challenge answer is inexact', async () => {
    stubCapabilityStorage();
    const translated = JSON.stringify({
      translation: 'Translated',
      recognizedText: 'Source',
      uncertainSpans: [],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'K7M2.' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: translated } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await expect(translator.testVisionCapability(
      { model: 'known-text-only-model' },
      credentials,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED' });
    await expect(translator.translateImageRegion(
      input,
      { ...options, model: 'known-text-only-model' },
      credentials,
      new AbortController().signal,
    )).resolves.toMatchObject({ translatedText: 'Translated' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain(input.imageDataUrl);
    expect(JSON.stringify(fetchMock.mock.calls[1])).toContain(input.imageDataUrl);
  });

  it('remembers only an explicit protocol rejection as no vision support', async () => {
    stubCapabilityStorage();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'This model does not support image input.' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await expect(translator.testVisionCapability(
      { model: 'explicit-text-only-model' },
      credentials,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED' });
    await expect(translator.translateImageRegion(
      input,
      { ...options, model: 'explicit-text-only-model' },
      credentials,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED' });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('distinguishes credentials, balance, and non-vision model failures', () => {
    expect(mapHttpError(401, null, 'Invalid API key')).toMatchObject({ code: 'AUTH_FAILED' });
    expect(mapHttpError(401, null, 'Unauthorized')).toMatchObject({ code: 'AUTH_FAILED' });
    expect(mapHttpError(403, null, 'The supplied API key is invalid.')).toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(mapHttpError(403, null, 'Authentication failed: the access token has expired.')).toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(mapHttpError(403, null, 'Invalid token.')).toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(mapHttpError(403, null, 'This API key does not have access to model qwen-plus.')).toMatchObject({
      code: 'MODEL_NOT_FOUND',
    });
    expect(mapHttpError(403, null, 'The requested deployment is not included in your plan.')).toMatchObject({
      code: 'MODEL_NOT_FOUND',
    });
    expect(mapHttpError(403, null, 'Forbidden by provider policy.')).toMatchObject({
      code: 'PROVIDER_ERROR',
      httpStatus: 403,
    });
    expect(mapHttpError(403, null)).toMatchObject({
      code: 'PROVIDER_ERROR',
      httpStatus: 403,
    });
    expect(mapHttpError(403, null, 'The account is in arrears.')).toMatchObject({
      code: 'PAYMENT_REQUIRED',
    });
    expect(mapHttpError(400, null, 'This model does not support image input.')).toMatchObject({
      code: 'VISION_MODEL_UNSUPPORTED',
    });
    expect(mapHttpError(422, null, 'The selected model is not a multimodal model.')).toMatchObject({
      code: 'VISION_MODEL_UNSUPPORTED',
    });
    expect(mapHttpError(400, null, 'This model is not included in your billing plan.')).toMatchObject({
      code: 'MODEL_NOT_FOUND',
    });
    expect(mapHttpError(
      429,
      null,
      'insufficient_quota You exceeded your current quota, check billing details.',
    )).toMatchObject({ code: 'PAYMENT_REQUIRED', retryable: false });
  });

  it('sends one OpenAI-compatible multimodal request and parses the result', async () => {
    const content = JSON.stringify({
      translation: '学术翻译结果',
      recognizedText: 'Academic source text',
      uncertainSpans: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      {
        apiKey: 'test-key',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      translatedText: '学术翻译结果',
      recognizedText: 'Academic source text',
      uncertainSpans: [],
      formulaLatex: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
      enable_thinking?: boolean;
      response_format?: { type?: string };
    };
    expect(body.model).toBe('qwen3.7-plus');
    expect(body.enable_thinking).toBe(false);
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image_url',
        image_url: { url: input.imageDataUrl },
      }),
      expect.objectContaining({ type: 'text' }),
    ]));
    const promptPart = body.messages[0]?.content.find((item) => item.type === 'text');
    const promptText = String(promptPart?.text ?? '');
    expect(promptText).toContain('不得猜测');
    expect(promptText).toContain('可编译的 LaTeX 源码');
    expect(promptText).toContain('图像像素是符号、字体和版式的最终依据');
    expect(promptText).toContain('双线体/黑板粗体使用 \\mathbb{}');
    expect(promptText).toContain('普通 P、Q、E 不得因其语义擅自升级');
    expect(promptText).toContain('可见的 ℙ、ℚ、𝔼 降级为普通字母');
    expect(promptText).toContain('\\operatorname*{arg\\,min}_{约束}');
    expect(promptText).toContain('视觉上独立成行或较长的公式必须使用 \\[...\\]');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('streams the translation field while retaining the final recognized text', async () => {
    const encoder = new TextEncoder();
    const deltas = [
      '{"translation":"正在',
      '翻译","recognizedText":"Source","uncertainSpans":[]}',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const content of deltas) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          ));
        }
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 10 } })}\n\n`,
        ));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const partials: string[] = [];

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      new AbortController().signal,
      { onPartialText: (value) => partials.push(value) },
    );

    expect(partials).toContain('正在');
    expect(partials.at(-1)).toBe('正在翻译');
    expect(result.recognizedText).toBe('Source');
    expect(result.translatedText).toBe('正在翻译');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.stream).toBe(true);
    expect(body.response_format).toBeUndefined();
  });

  it('retries an error-only SSE response without an incompatible JSON response format', async () => {
    const encoder = new TextEncoder();
    const failedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          error: {
            code: 'invalid_parameter_error',
            type: 'invalid_request_error',
            message: '<400> InternalError.Algo.InvalidParameter: Model output became abnormal while generating a JSON response for response_format. The generation was aborted.',
          },
        })}\n\n`));
        controller.close();
      },
    });
    const content = JSON.stringify({
      translation: '兼容模式译文',
      recognizedText: 'Compatible source',
      formulaLatex: [],
      uncertainSpans: [],
    });
    const successfulStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(failedStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(successfulStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).resolves.toMatchObject({
      translatedText: '兼容模式译文',
      recognizedText: 'Compatible source',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]?.response_format).toEqual({ type: 'json_object' });
    expect(bodies[1]?.response_format).toBeUndefined();
  });

  it('never replays or downgrades an image request after an SSE event was received', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"translation":"partial' } }] })}\n\n`,
        ));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          error: { code: '500', message: 'Provider failed after starting image generation' },
        })}\n\n`));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', httpStatus: 500 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps a non-vision model rejection without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'This model does not support image input.' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back when a compatible vision API rejects JSON response_format', async () => {
    const content = JSON.stringify({
      translation: '译文',
      recognizedText: 'Source',
      uncertainSpans: [],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Unknown parameter: response_format; JSON mode is unsupported.' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    )).resolves.toMatchObject({ translatedText: '译文', recognizedText: 'Source' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(secondBody.response_format).toBeUndefined();
  });

  it('remembers a JSON response-format rejection for later image requests', async () => {
    stubCapabilityStorage();
    const content = JSON.stringify({
      translation: '璇戞枃',
      recognizedText: 'Source',
      uncertainSpans: [],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Unknown parameter: response_format; JSON mode is unsupported.' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementation(async () => new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const requestOptions = { ...options, model: 'json-memory-model' };
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await translator.translateImageRegion(
      input,
      requestOptions,
      credentials,
      new AbortController().signal,
    );
    await translator.translateImageRegion(
      input,
      requestOptions,
      credentials,
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]?.response_format).toEqual({ type: 'json_object' });
    expect(bodies[1]?.response_format).toBeUndefined();
    expect(bodies[2]?.response_format).toBeUndefined();
  });

  it('does not classify an unrelated unknown parameter as a JSON-mode rejection', async () => {
    stubCapabilityStorage();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Unknown parameter: image_url' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const translator = new OpenAiCompatibleTranslator();
    const requestOptions = { ...options, model: 'unrelated-unknown-parameter-model' };
    const credentials = { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' };

    await expect(translator.translateImageRegion(
      input,
      requestOptions,
      credentials,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', httpStatus: 400 });
    await expect(translator.translateImageRegion(
      input,
      requestOptions,
      credentials,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'PROVIDER_ERROR', httpStatus: 400 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).response_format).toEqual({ type: 'json_object' });
    }
  });

  it('keeps text streaming enabled when only image streaming is unsupported', async () => {
    stubCapabilityStorage();
    await updateApiModelCapabilities('https://api.example.com/v1', 'modality-model', {
      imageStreaming: false,
    });
    const encoder = new TextEncoder();
    const content = JSON.stringify({ translation: 'Streamed text', warnings: [] });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translate(
      { text: 'Source', placeholderTokens: [] },
      { ...options, model: 'modality-model' },
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).resolves.toMatchObject({ translatedText: 'Streamed text' });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true);
  });

  it('parses fenced JSON and rejects incomplete results', () => {
    expect(parseImageTranslation('```json\n{"translation":"译文","recognizedText":"原文"}\n```'))
      .toEqual({
        translatedText: '译文',
        recognizedText: '原文',
        uncertainSpans: [],
        formulaLatex: [],
      });
    expect(parseImageTranslation(JSON.stringify({
      translation: '其中 $E=mc^2$。',
      recognizedText: 'where $E=mc^2$.',
      formulaLatex: ['E=mc^2'],
      uncertainSpans: [],
    }))).toEqual({
      translatedText: '其中 $E=mc^2$。',
      recognizedText: 'where $E=mc^2$.',
      formulaLatex: ['E=mc^2'],
      uncertainSpans: [],
    });
    expect(() => parseImageTranslation('{"translation":"译文"}'))
      .toThrow(/recognizedText/i);
  });

  it('extracts one complete image-result object from provider commentary', () => {
    const wrapped = [
      'Here is the requested JSON result:',
      '```json',
      JSON.stringify({
        translation: '译文包含 {花括号}',
        recognizedText: 'Source with {braces}',
        formulaLatex: [],
        uncertainSpans: [],
      }),
      '```',
    ].join('\n');
    expect(parseImageTranslation(wrapped)).toMatchObject({
      translatedText: '译文包含 {花括号}',
      recognizedText: 'Source with {braces}',
    });
    expect(() => parseImageTranslation('Only ordinary prose, no JSON object.'))
      .toThrow(/invalid JSON/i);
  });

  it('repairs single JSON backslashes in common LaTeX commands locally', () => {
    const damaged = String.raw`{"translation":"其中 $\text{Q}_{\Omega}=\tau$，见式 \\[x=y,\tag{8}\\]","recognizedText":"where $\text{Q}_{\Omega}=\tau$, see \\[x=y,\tag{8}\\]","formulaLatex":["\text{Q}_{\Omega}=\tau","x=y,\tag{8}"],"uncertainSpans":[]}`;
    expect(parseImageTranslation(damaged)).toMatchObject({
      translatedText: '其中 $\\text{Q}_{\\Omega}=\\tau$，见式 \\[x=y,\\tag{8}\\]',
      recognizedText: 'where $\\text{Q}_{\\Omega}=\\tau$, see \\[x=y,\\tag{8}\\]',
      formulaLatex: ['\\text{Q}_{\\Omega}=\\tau', 'x=y,\\tag{8}'],
    });
  });

  it('preserves genuine JSON newline escapes while repairing TeX', () => {
    const result = parseImageTranslation(
      '{"translation":"line 1\\nline 2 $x$","recognizedText":"source $x$","formulaLatex":["x"]}',
    );
    expect(result.translatedText).toBe('line 1\nline 2 $x$');
  });

  it('returns copy-ready single-backslash LaTeX when vision JSON is double escaped', async () => {
    const overescaped = JSON.stringify({
      translation: String.raw`其中 $\\mathbb{Q}_\\Omega\\$ 与 $Z_\\tau=x$ 匹配，另有 $mathbbQ_\\Omega$。`,
      recognizedText: String.raw`where $\\mathbb{Q}_\\Omega\\$ matches $Z_\\tau=x$, plus $mathbbQ_\\Omega$.`,
      formulaLatex: [String.raw`\\mathbb{Q}_\\Omega\\`, String.raw`Z_\\tau`, String.raw`mathbbQ_\\Omega`],
      uncertainSpans: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: overescaped } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    );

    expect(result.translatedText)
      .toBe(String.raw`其中 $\mathbb{Q}_\Omega$ 与 $Z_\tau=x$ 匹配，另有 $\mathbb{Q}_\Omega$。`);
    expect(result.recognizedText)
      .toBe(String.raw`where $\mathbb{Q}_\Omega$ matches $Z_\tau=x$, plus $\mathbb{Q}_\Omega$.`);
    expect(result.formulaLatex)
      .toEqual([String.raw`\mathbb{Q}_\Omega`, String.raw`Z_\tau=x`, String.raw`\mathbb{Q}_\Omega`]);
    expect(result.formulaNeedsReview).toBeUndefined();
  });

  it('recovers an omitted validated LaTeX formula without a hidden corrective request', async () => {
    const invalid = JSON.stringify({
      translation: '译文缺少公式',
      recognizedText: 'Source\n\\[R=\\frac{a+b}{c}\\]',
      formulaLatex: ['R=\\frac{a+b}{c}'],
      uncertainSpans: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: invalid } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      translatedText: '译文缺少公式\n\\[R=\\frac{a+b}{c}\\]',
      formulaLatex: ['R=\\frac{a+b}{c}'],
    });
    expect(result.formulaNeedsReview).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repairs same-count formula drift locally without a second vision request', async () => {
    const drifted = JSON.stringify({
      translation: '译文 $R=\\frac{a-b}{c}$',
      recognizedText: 'Source $R=\\frac{a+b}{c}$',
      formulaLatex: ['R=\\frac{a-b}{c}'],
      uncertainSpans: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: drifted } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    )).resolves.toMatchObject({
      translatedText: '译文 $R=\\frac{a+b}{c}$',
      formulaLatex: ['R=\\frac{a+b}{c}'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not consume a second prepared response for formula correction', async () => {
    const incomplete = JSON.stringify({
      translation: '译文缺少公式',
      recognizedText: 'Source $x+y$',
      formulaLatex: ['x+y'],
      uncertainSpans: [],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: incomplete } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockRejectedValueOnce(new TypeError('temporary connection failure'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      translatedText: '译文缺少公式',
      formulaNeedsReview: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps an inline omission visible for local review', async () => {
    const invalid = JSON.stringify({
      translation: '译文缺少公式',
      recognizedText: 'Source $x+y$',
      formulaLatex: ['x+y'],
      uncertainSpans: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: invalid } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await new OpenAiCompatibleTranslator().translateImageRegion(
      input,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      translatedText: '译文缺少公式',
      formulaNeedsReview: true,
    });
  });

  it('rejects provider responses that echo the selected image', async () => {
    const longPayload = 'QUJD'.repeat(100);
    const imageInput = {
      ...input,
      imageDataUrl: `data:image/png;base64,${longPayload}`,
    };
    const echoedFragment = longPayload.slice(120, 320);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        translation: '译文',
        recognizedText: echoedFragment,
        uncertainSpans: [],
      }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      imageInput,
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });

  it('reuses one prepared image safety context and still rejects echoed bytes', () => {
    const longPayload = 'QUJD'.repeat(100);
    const context = createImageOutputSafetyContext(`data:image/png;base64,${longPayload}`);
    expect(() => assertSafeImageTranslationText('安全的流式片段', context)).not.toThrow();
    const unrelatedBase64 = 'Z'.repeat(160);
    expect(() => assertSafeImageTranslationText(unrelatedBase64, context)).not.toThrow();
    expect(() => assertSafeImageTranslationText(`${unrelatedBase64}Y`, context)).not.toThrow();
    expect(() => assertSafeImageTranslationText(longPayload.slice(120, 320), context))
      .toThrow(/echoed bytes/i);
  });

  it('strictly validates the complete image result after safe streamed partials', async () => {
    const encoder = new TextEncoder();
    const longPayload = 'QUJD'.repeat(100);
    const echoedFragment = longPayload.slice(120, 320);
    const content = JSON.stringify({
      translation: '安全译文',
      recognizedText: echoedFragment,
      uncertainSpans: [],
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    await expect(new OpenAiCompatibleTranslator().translateImageRegion(
      {
        ...input,
        imageDataUrl: `data:image/png;base64,${longPayload}`,
      },
      options,
      { apiKey: 'test-key', apiBaseUrl: 'https://api.example.com/v1' },
      new AbortController().signal,
      { onPartialText: () => undefined },
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });

  it('keeps ordinary LaTeX and long scientific text while enforcing field limits', () => {
    const scientificText = `R_0=\\frac{a+b}{c_d}\n${'ACGT'.repeat(1_000)}`;
    expect(() => assertSafeImageTranslationText(scientificText)).not.toThrow();
    expect(() => assertSafeImageTranslationText('x'.repeat(MAX_IMAGE_TRANSLATION_TEXT_LENGTH)))
      .not.toThrow();
    expect(() => assertSafeImageTranslationText('x'.repeat(MAX_IMAGE_TRANSLATION_TEXT_LENGTH + 1)))
      .toThrow(/large text field/i);
    expect(() => assertSafeImageTranslationText('data:image/png;base64,private-image'))
      .toThrow(/image data/i);
  });
});
