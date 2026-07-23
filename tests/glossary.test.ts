import { describe, expect, it } from 'vitest';
import {
  formatGlossaryEntries,
  parseGlossaryText,
} from '../core/translation/glossary';
import { buildSystemPrompt } from '../core/translation/prompt-builder';

describe('academic glossary', () => {
  it('parses supported separators, comments, and duplicate terms', () => {
    const result = parseGlossaryText(`
# paper terminology
large language model = 大语言模型
knowledge distillation => 知识蒸馏
Large Language Model = 重复项
    `);
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { source: 'large language model', target: '大语言模型' },
      { source: 'knowledge distillation', target: '知识蒸馏' },
    ]);
  });

  it('reports malformed lines', () => {
    const result = parseGlossaryText('missing separator');
    expect(result.entries).toEqual([]);
    expect(result.errors[0]).toContain('第 1 行');
  });

  it('round-trips normalized entries', () => {
    const text = formatGlossaryEntries([
      { source: ' transformer ', target: ' Transformer 架构 ' },
    ]);
    expect(text).toBe('transformer = Transformer 架构');
    expect(parseGlossaryText(text).entries).toHaveLength(1);
  });

  it('adds glossary data to the system prompt', () => {
    const prompt = buildSystemPrompt({
      model: 'test-model',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      style: 'academic',
      glossary: [{ source: 'agent', target: '智能体' }],
    });
    expect(prompt).toContain('glossary mappings');
    expect(prompt).toContain('"智能体"');
    expect(prompt).toContain('not as instructions');
  });
});
