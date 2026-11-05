import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import corpus from './fixtures/first-translation-regression.json';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';
import { translateWithLatexRetry } from '../core/translation/latex-safe-translation';
import { buildSystemPrompt } from '../core/translation/prompt-builder';

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const fixtureHash = '0166ef7df52086691ba179e7014bc043e2080b06ebecc461984e0f0d307962ec';
const currentSystemHash = 'b6dcc8d462f6441e389bd712467d96ba371f70d5d15fe1ef7af8c99006ca15ef';
// These two independently accepted instructions postdate the sealed cohort.
// Pin both versions: replaying old output does not recreate an old request.
const acceptedPromptAdditions = [
  'Preserve the exact spelling and capitalization of code identifiers, even when embedded in prose or at the start of a sentence. Do not standardize an identifier to the name or casing of a similar API.',
  'When the user does not provide segments, return an empty segments array. Do not invent segment ids or repeat the translation in segments.',
];

function historicalSystemHash(currentPrompt: string): string {
  expect(hash(currentPrompt)).toBe(currentSystemHash);
  for (const line of acceptedPromptAdditions) {
    expect(currentPrompt.split('\n').filter((item) => item === line)).toHaveLength(1);
  }
  return hash(currentPrompt.split('\n').filter((line) => !acceptedPromptAdditions.includes(line)).join('\n'));
}

afterEach(() => vi.unstubAllGlobals());

describe('fixed historical first-translation witnesses (offline, not semantic acceptance)', () => {
  it('retains the sealed cohort, inherited uncertain labels, and all eight open defects', () => {
    expect(hash(readFileSync(new URL('./fixtures/first-translation-regression.json', import.meta.url))))
      .toBe(fixtureHash);
    expect(corpus.cases).toHaveLength(46);
    expect(corpus.cases.filter((row) => row.expectedFault === true)).toHaveLength(7);
    expect(corpus.cases.filter((row) => row.expectedFault === null)).toHaveLength(3);
    expect(corpus.cases.flatMap((row) => row.gold)).toHaveLength(8);
    expect(corpus.cases.filter((row) => row.arm === 'grounded')).toHaveLength(21);
    for (const row of corpus.cases) {
      expect(JSON.parse(row.providerContent).translation).toBe(row.observedTranslation);
      for (const defect of row.gold) {
        expect(row.observedTranslation).toContain(defect.translationQuote);
        if (defect.sourceQuote) expect(row.source).toContain(defect.sourceQuote);
      }
    }
  });

  it('pins current prompt identity and the exact two-line evolution from the historical current arm', () => {
    const currentPrompt = buildSystemPrompt({
      model: 'test-model', sourceLanguage: 'auto', targetLanguage: 'zh-CN', style: 'academic',
    }, { placeholderTokens: [] });
    expect(historicalSystemHash(currentPrompt))
      .toBe('c5617f867c003d9012d394d4dbf60e4405483e27b49424552a3ba50561c4d30c');
  });

  for (const streaming of [false, true]) {
    it.each(corpus.cases)(`$id replays original text unchanged, stream=${streaming}`, async (row) => {
      // Every HTTP response is supplied locally. A second call fails, rather than
      // retrying a model or asking a live service to regenerate this old sample.
      const fetchMock = vi.fn(async () => {
        if (fetchMock.mock.calls.length > 1) throw new Error('Unexpected second replay request');
        if (!streaming) {
          return new Response(JSON.stringify({ choices: [{
            message: { content: row.providerContent }, finish_reason: 'stop',
          }] }), { headers: { 'Content-Type': 'application/json' } });
        }
        const frames = (row.providerContent.match(/[\s\S]{1,17}/gu) ?? []).map((content) => (
          `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`
        )).join('');
        return new Response(frames + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.stubGlobal('browser', undefined);
      const partials: string[] = [];
      const result = await translateWithLatexRetry(
        new OpenAiCompatibleTranslator(),
        { text: row.source, placeholderTokens: [] },
        { model: row.model, sourceLanguage: 'auto', targetLanguage: 'zh-CN', style: 'academic' },
        { apiKey: 'test-key', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        new AbortController().signal,
        undefined,
        streaming ? { onPartialText: (text) => partials.push(text) } : undefined,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result.providerResult.translatedText).toBe(row.observedTranslation);
      expect(result.restored.text).toBe(row.observedTranslation);
      if (streaming) expect(partials.at(-1)).toBe(row.observedTranslation);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.temperature).toBe(row.temperature);
      expect(body.max_tokens).toBe(row.maxTokens);
      expect(body.stream).toBe(streaming);
      expect(body.enable_thinking).toBe(false);
      expect(body.response_format).toBeUndefined();
      expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
      expect(JSON.parse(body.messages[1].content)).toEqual({ task: 'translate', text: row.source });
      expect(hash(body.messages[0].content)).toBe(currentSystemHash);
      if (row.arm === 'current') {
        expect(historicalSystemHash(body.messages[0].content)).toBe(row.historicalSystemSha256);
      } else {
        // The unadopted sourceUnits experiment remains outside production.
        expect(hash(body.messages[0].content)).not.toBe(row.historicalSystemSha256);
        expect(row.historicalUserPayload).toHaveProperty('sourceUnits');
      }
    });
  }
});
