import { describe, expect, it } from 'vitest';
import {
  recommendedTextModel,
  recommendedVisionModelCandidates,
  modelFamily,
  translationModelChoices,
} from '../core/settings/api-model-selection';

describe('API model recommendation', () => {
  it('groups direct and gateway model IDs without inventing available models', () => {
    for (const [id, family] of [
      ['openai/gpt-6-astra', 'gpt'], ['o3', 'gpt'], ['anthropic/claude-opus-5-5', 'claude'],
      ['google/gemini-3.8-flash', 'gemini'], ['qwen3.8-max', 'qwen'],
      ['vanchin/deepseek-v4-pro', 'deepseek'], ['moonshot-v1', 'kimi'],
      ['ZHIPU/GLM-5.3', 'glm'], ['MiniMax-M3', 'minimax'], ['new-provider/model-a', 'other'],
    ]) expect(modelFamily(id!)).toBe(family);
    expect(translationModelChoices([' qwen3.8-max ', 'qwen3.8-max', 'new-provider/model-a']))
      .toEqual(['qwen3.8-max', 'new-provider/model-a']);
  });

  it('filters a series while retaining unknown future text models and exact gateway IDs', () => {
    const models = ['openai/gpt-6-astra', 'qwen3.8-max', 'private-new-model', 'anthropic/claude-opus-5-5'];
    expect(translationModelChoices(models, 'gpt')).toEqual(['openai/gpt-6-astra']);
    expect(translationModelChoices(models, 'other')).toEqual(['private-new-model']);
    expect(translationModelChoices(models, 'glm')).toEqual([]);
  });

  it('excludes non-chat and specialized endpoint IDs from automatic text choices', () => {
    const models = ['dall-e-3', 'sora-2', 'gpt-4o-transcribe', 'gpt-5-codex', 'o3-deep-research', 'computer-use-preview'];
    expect(translationModelChoices(models)).toEqual([]);
    expect(recommendedTextModel([...models, 'gpt-6-astra'])).toBe('gpt-6-astra');
  });
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

  it('does not recommend image generation, OCR or realtime endpoints for chat translation', () => {
    const utilityModels = ['qwen-image-2.1-pro', 'qwen3.5-ocr', 'qwen3.8-omni-flash-realtime'];
    expect(recommendedTextModel([...utilityModels, 'deepseek-v4.1-flash'], utilityModels[0]))
      .toBe('deepseek-v4.1-flash');
    expect(recommendedTextModel(utilityModels)).toBeUndefined();
    expect(recommendedVisionModelCandidates(utilityModels, utilityModels[0]!)).toEqual([]);
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
