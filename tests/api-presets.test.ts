import { describe, expect, it } from 'vitest';
import { API_PRESETS } from '../core/settings/api-presets';

describe('API provider presets', () => {
  it('keeps common providers ahead of the custom fallback', () => {
    expect(API_PRESETS.map((preset) => preset.id)).toEqual([
      'deepseek',
      'qwen',
      'openrouter',
      'ollama',
    ]);
    expect(new Set(API_PRESETS.map((preset) => preset.apiBaseUrl)).size)
      .toBe(API_PRESETS.length);
  });
});
