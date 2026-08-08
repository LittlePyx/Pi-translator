import { describe, expect, it } from 'vitest';
import {
  formatGlossaryEntries,
  parseGlossaryText,
  rollbackGlossaryEntry,
  upsertGlossaryEntry,
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

  it('upserts and conditionally rolls back a confirmed global term', () => {
    const updated = upsertGlossaryEntry(
      [{ source: 'ROI', target: '感兴趣区域' }],
      { source: 'roi', target: '兴趣区域' },
    );
    expect(updated.previousTarget).toBe('感兴趣区域');
    expect(updated.entries).toEqual([{ source: 'roi', target: '兴趣区域' }]);

    expect(rollbackGlossaryEntry(updated.entries, {
      source: 'roi',
      appliedTarget: '兴趣区域',
      ...(updated.previousTarget !== undefined
        ? { previousTarget: updated.previousTarget }
        : {}),
    })).toEqual({
      rolledBack: true,
      entries: [{ source: 'roi', target: '感兴趣区域' }],
    });
    expect(rollbackGlossaryEntry(
      [{ source: 'roi', target: '后来由用户修改的译法' }],
      { source: 'roi', appliedTarget: '兴趣区域' },
    ).rolledBack).toBe(false);

    const whitespaceNormalized = upsertGlossaryEntry(
      [{ source: 'adaptive  sensing', target: '旧译法' }],
      { source: 'adaptive sensing', target: '自适应感知' },
    );
    expect(whitespaceNormalized.previousTarget).toBe('旧译法');
    expect(whitespaceNormalized.entries).toHaveLength(1);
  });
});
