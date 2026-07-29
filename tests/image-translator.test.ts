import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapHttpError,
  OpenAiCompatibleTranslator,
  parseImageTranslation,
  VISION_CAPABILITY_TEST_IMAGE_DATA_URL,
} from '../core/translation/openai-compatible-translator';
import {
  assertSafeImageTranslationText,
  MAX_IMAGE_TRANSLATION_TEXT_LENGTH,
} from '../core/translation/image-output-safety';

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

afterEach(() => vi.unstubAllGlobals());

describe('image region translator', () => {
  it('tests image-input capability with only the bundled tiny image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
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
    expect(body.max_tokens).toBe(8);
    expect(body.stream).toBe(false);
    expect(body.enable_thinking).toBe(false);
    expect(body.messages[0]?.content).toContainEqual({
      type: 'image_url',
      image_url: { url: VISION_CAPABILITY_TEST_IMAGE_DATA_URL },
    });
    expect(JSON.stringify(body)).not.toContain(input.imageDataUrl);
  });

  it('distinguishes credentials, balance, and non-vision model failures', () => {
    expect(mapHttpError(401, null, 'Invalid API key')).toMatchObject({ code: 'AUTH_FAILED' });
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
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image_url',
        image_url: { url: input.imageDataUrl },
      }),
      expect.objectContaining({ type: 'text' }),
    ]));
    expect(JSON.stringify(body)).toContain('不得猜测');
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
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

  it('parses fenced JSON and rejects incomplete results', () => {
    expect(parseImageTranslation('```json\n{"translation":"译文","recognizedText":"原文"}\n```'))
      .toEqual({ translatedText: '译文', recognizedText: '原文', uncertainSpans: [] });
    expect(() => parseImageTranslation('{"translation":"译文"}'))
      .toThrow(/recognizedText/i);
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
