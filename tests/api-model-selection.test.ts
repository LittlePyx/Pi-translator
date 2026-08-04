import { describe, expect, it } from 'vitest';
import {
  recommendedTextModel,
  recommendedVisionModelCandidates,
} from '../core/settings/api-model-selection';

describe('API model recommendation', () => {
  it('keeps an available preferred text model', () => {
    expect(recommendedTextModel(
      ['text-embedding-v3', 'qwen3.7-plus', 'qwen3.7-flash'],
      'qwen3.7-plus',
    )).toBe('qwen3.7-plus');
  });

  it('prefers chat-like models and excludes utility models', () => {
    expect(recommendedTextModel([
      'text-embedding-v3',
      'rerank-v2',
      'general-base',
      'general-chat',
    ])).toBe('general-chat');
  });

  it('tries the selected text model before other likely visual models', () => {
    expect(recommendedVisionModelCandidates(
      ['deepseek-chat', 'qwen-vl-max', 'image-generation-v2'],
      'deepseek-chat',
    )).toEqual(['deepseek-chat', 'qwen-vl-max']);
  });

  it('recognizes opaque Qwen plus model names as possible multimodal models', () => {
    expect(recommendedVisionModelCandidates(
      ['qwen3.7-plus', 'qwen3.7-flash'],
      'qwen3.7-flash',
    )).toEqual(['qwen3.7-flash', 'qwen3.7-plus']);
  });

  it('does not guess models that the provider did not return', () => {
    expect(recommendedVisionModelCandidates(
      ['model-a', 'model-vl'],
      'model-a',
      'missing-vision-model',
    )).toEqual(['model-a', 'model-vl']);
  });
});
