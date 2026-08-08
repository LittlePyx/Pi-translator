import { describe, expect, it } from 'vitest';
import {
  formatGlossaryEntries,
  MAX_GLOSSARY_ENTRIES,
  mergeGlossaryDraft,
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

  it('merges a stale settings-page draft without dropping newer terms', () => {
    const baseline = [
      { source: 'attention', target: '注意力' },
      { source: 'obsolete term', target: '旧术语' },
    ];
    const latest = [
      { source: 'diffusion model', target: '扩散模型' },
      { source: 'attention', target: '后台更新的译法' },
      { source: 'obsolete term', target: '旧术语' },
    ];
    const draft = [
      { source: 'attention', target: '注意机制' },
      { source: 'new user term', target: '用户新术语' },
    ];

    expect(mergeGlossaryDraft(baseline, draft, latest)).toEqual([
      { source: 'new user term', target: '用户新术语' },
      { source: 'attention', target: '注意机制' },
      { source: 'diffusion model', target: '扩散模型' },
    ]);

    expect(mergeGlossaryDraft(
      baseline,
      baseline,
      latest,
    )).toEqual(latest);
  });

  it('rejects a stale draft when concurrent additions would exceed capacity', () => {
    const baseline = Array.from({ length: MAX_GLOSSARY_ENTRIES - 1 }, (_, index) => ({
      source: `baseline-${index}`,
      target: `translation-${index}`,
    }));
    const latest = [
      { source: 'background-addition', target: 'background translation' },
      ...baseline,
    ];
    const draft = [
      { source: 'settings-page-addition', target: 'settings translation' },
      ...baseline,
    ];

    expect(() => mergeGlossaryDraft(baseline, draft, latest)).toThrow();
  });

  it('allows an explicit edit when a concurrently updated glossary is full', () => {
    const baseline = Array.from({ length: MAX_GLOSSARY_ENTRIES }, (_, index) => ({
      source: `term-${index}`,
      target: `translation-${index}`,
    }));
    const latest = baseline.map((entry, index) => index === 1
      ? { ...entry, target: 'newer background translation' }
      : entry);
    const draft = baseline.map((entry, index) => index === 0
      ? { ...entry, target: 'explicit settings translation' }
      : entry);

    const merged = mergeGlossaryDraft(baseline, draft, latest);
    expect(merged).toHaveLength(MAX_GLOSSARY_ENTRIES);
    expect(merged.find((entry) => entry.source === 'term-0')?.target)
      .toBe('explicit settings translation');
    expect(merged.find((entry) => entry.source === 'term-1')?.target)
      .toBe('newer background translation');
  });
});
