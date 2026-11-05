import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';
import { chatCompletionParameters } from '../core/translation/chat-completion-parameters';
import { API_PRESETS } from '../core/settings/api-presets';

afterEach(() => vi.unstubAllGlobals());

describe('mainstream translation API compatibility', () => {
  it.each([
    { base: 'https://api.openai.com/v1', model: 'gpt-6-astra', budget: 'max_completion_tokens', sampling: false },
    { base: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', budget: 'max_tokens', sampling: false },
    { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', budget: 'max_tokens', sampling: true },
    { base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-5-5', budget: 'max_tokens', sampling: false },
  ])('sends a valid first request to $model without parameter guessing or retries', async ({ base, model, budget, sampling }) => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${base}/chat/completions`);
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe(model);
      expect(body[budget]).toBeGreaterThan(0);
      expect(body).not.toHaveProperty(budget === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens');
      if (!sampling) expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('enable_thinking');
      bodies.push(body);
      return new Response(JSON.stringify({ choices: [{ message: { content: bodies.length === 1
        ? 'Pi Translator 让多语言阅读更轻松。'
        : '{"translation":"示例译文","warnings":[]}' }, finish_reason: 'stop' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', undefined);
    const translator = new OpenAiCompatibleTranslator();
    const credentials = { apiBaseUrl: base, apiKey: 'test-key' };
    await translator.testConnection({ model }, credentials, new AbortController().signal);
    const result = await translator.translate({ text: 'A sample sentence.', placeholderTokens: [] }, {
      model, sourceLanguage: 'auto', targetLanguage: 'zh-CN', style: 'academic',
    }, credentials, new AbortController().signal);
    expect(result.translatedText).toBe('示例译文');
    expect(fetchMock).toHaveBeenCalledTimes(2); // One connection sample + one translation.
    expect(bodies[1]![budget]).toBe(8192);
  });

  it('keeps the existing Qwen/DeepSeek sampling and token budgets', () => {
    expect(chatCompletionParameters('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.6-flash', 0.2, 8192))
      .toEqual({ temperature: 0.2, max_tokens: 8192 });
    expect(chatCompletionParameters('https://api.deepseek.com', 'deepseek-v4-flash', 0, 64))
      .toEqual({ temperature: 0, max_tokens: 64 });
    expect(chatCompletionParameters('https://api.openai.com/v1', 'gpt-4.1', 0.2, 8192))
      .toEqual({ temperature: 0.2, max_completion_tokens: 8192 });
    expect(chatCompletionParameters('https://api.openai.com.example.org/v1', 'custom-chat', 0.2, 8192))
      .toEqual({ temperature: 0.2, max_tokens: 8192 });
  });

  it('adds official presets without preselecting a guessed account model or changing old defaults', () => {
    for (const id of ['openai', 'anthropic', 'gemini']) {
      const preset = API_PRESETS.find(preset => preset.id === id)!;
      expect(preset.apiBaseUrl).toMatch(/^https:\/\//);
      expect(preset.model).toBe('');
      expect(preset.keyHint).toContain('Key');
    }
    expect(API_PRESETS.find(preset => preset.id === 'qwen')?.model).toBe('qwen3.7-plus');
    expect(API_PRESETS.find(preset => preset.id === 'deepseek')?.model).toBe('deepseek-v4-flash');
  });
});
