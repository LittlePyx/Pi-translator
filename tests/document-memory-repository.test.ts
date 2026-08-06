import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDocumentReferenceContext,
  confirmDocumentTerm,
  dismissDocumentTermCandidate,
  getDocumentMemory,
  mergeDocumentGlossary,
  rememberDocumentTranslation,
  upsertDocumentTerm,
} from '../core/document/document-memory-repository';

const storage: Record<string, unknown> = {};
const identity = { documentId: 'doc-test', label: 'paper.pdf' };

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('document translation memory', () => {
  it('stores bounded translations and promotes confirmed terminology', async () => {
    await rememberDocumentTranslation(identity, {
      requestId: 'request-1',
      originalText: 'The adaptive sensing policy selects an ROI.',
      translatedText: '自适应感知策略选择一个感兴趣区域。',
      warnings: [],
      targetLanguage: 'zh-CN',
      termCandidates: [{ source: 'adaptive sensing', target: '自适应感知' }],
    });
    let memory = await getDocumentMemory(identity);
    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.candidateTerms[0]?.source).toBe('adaptive sensing');

    memory = await confirmDocumentTerm(identity, memory.candidateTerms[0]!.id);
    expect(memory.candidateTerms).toHaveLength(0);
    expect(memory.confirmedTerms[0]).toMatchObject({
      source: 'adaptive sensing',
      target: '自适应感知',
    });
    expect(mergeDocumentGlossary([
      { source: 'adaptive sensing', target: '全局旧译法' },
      { source: 'scene', target: '场景' },
    ], memory)).toEqual([
      { source: 'adaptive sensing', target: '自适应感知' },
      { source: 'scene', target: '场景' },
    ]);
  });

  it('supports manual terms and remembers dismissed candidates', async () => {
    let memory = await upsertDocumentTerm(identity, {
      source: 'single-pixel imaging',
      target: '单像素成像',
    });
    expect(memory.confirmedTerms[0]?.target).toBe('单像素成像');

    memory = await rememberDocumentTranslation(identity, {
      requestId: 'request-2',
      originalText: 'An ROI is reconstructed.',
      translatedText: '重建感兴趣区域。',
      warnings: [],
      termCandidates: [{ source: 'ROI', target: '感兴趣区域' }],
    });
    const candidateId = memory.candidateTerms[0]!.id;
    await dismissDocumentTermCandidate(identity, candidateId);
    memory = await rememberDocumentTranslation(identity, {
      requestId: 'request-3',
      originalText: 'The ROI is refined.',
      translatedText: '细化感兴趣区域。',
      warnings: [],
      termCandidates: [{ source: 'ROI', target: '感兴趣区域' }],
    });
    expect(memory.candidateTerms).toHaveLength(0);
  });

  it('injects only relevant, size-limited document context', async () => {
    const memory = await rememberDocumentTranslation(identity, {
      requestId: 'request-4',
      originalText: 'The adaptive sensing policy is learned from data.',
      translatedText: '自适应感知策略从数据中学习。',
      warnings: [],
      completedAt: 10,
    });
    const context = buildDocumentReferenceContext(
      'This adaptive sensing policy remains stable.',
      'The method is evaluated on two datasets.',
      memory,
      500,
    );
    expect(context).toContain('Earlier in this document');
    expect(context).toContain('自适应感知策略');
    expect(context!.length).toBeLessThanOrEqual(500);
  });

  it('replaces an earlier translation of the same source with the adopted revision', async () => {
    await rememberDocumentTranslation(identity, {
      requestId: 'draft-request',
      originalText: 'The estimator is stable under perturbations.',
      translatedText: '该估计器是稳定的。',
      warnings: [],
      completedAt: 10,
    });
    const memory = await rememberDocumentTranslation(identity, {
      requestId: 'revision-request',
      originalText: 'The estimator is stable under perturbations.',
      translatedText: '该估计器在扰动下保持稳定。',
      warnings: [],
      completedAt: 20,
      revision: {
        rootRequestId: 'draft-request',
        kind: 'manual',
        label: '手动修改',
        scope: 'document',
      },
    });

    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.recentTranslations[0]).toMatchObject({
      requestId: 'revision-request',
      translatedText: '该估计器在扰动下保持稳定。',
    });
    expect(buildDocumentReferenceContext(
      'This estimator remains stable.',
      undefined,
      memory,
    )).toContain('该估计器在扰动下保持稳定。');
  });

  it('replaces stale OCR text when re-recognition changes the source wording', async () => {
    await rememberDocumentTranslation(identity, {
      requestId: 'ocr-root',
      originalText: 'The stale OCR source texl.',
      translatedText: '旧的识别译文。',
      warnings: [],
      sourceKind: 'image-region',
      completedAt: 10,
    });
    const memory = await rememberDocumentTranslation(identity, {
      requestId: 'ocr-revision',
      originalText: 'The corrected OCR source text.',
      translatedText: '修正后的识别译文。',
      warnings: [],
      sourceKind: 'image-region',
      completedAt: 20,
      revision: {
        rootRequestId: 'ocr-root',
        kind: 'custom',
        label: '重新识别',
        scope: 'document',
      },
    });

    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.recentTranslations[0]).toMatchObject({
      requestId: 'ocr-revision',
      rootRequestId: 'ocr-root',
      originalText: 'The corrected OCR source text.',
      translatedText: '修正后的识别译文。',
    });
    const context = buildDocumentReferenceContext(
      'The corrected OCR source remains important.',
      undefined,
      memory,
    );
    expect(context).toContain('The corrected OCR source text.');
    expect(context).not.toContain('stale OCR');
  });

  it('enforces document and per-document storage budgets', async () => {
    for (let index = 0; index < 25; index += 1) {
      await rememberDocumentTranslation(identity, {
        requestId: `bounded-${index}`,
        originalText: `source sentence ${index}`,
        translatedText: `translated sentence ${index}`,
        warnings: [],
        completedAt: index,
      });
    }
    const memory = await getDocumentMemory(identity);
    expect(memory.recentTranslations).toHaveLength(20);
    expect(memory.recentTranslations[0]?.requestId).toBe('bounded-24');
    expect(memory.recentTranslations.at(-1)?.requestId).toBe('bounded-5');

    for (let index = 0; index < 45; index += 1) {
      await rememberDocumentTranslation({
        documentId: `doc-budget-${index}`,
        label: 'example.com',
      }, {
        requestId: `document-${index}`,
        originalText: `document source ${index}`,
        translatedText: `document translation ${index}`,
        warnings: [],
        completedAt: index + 100,
      });
    }
    const stored = storage.documentTranslationMemoryV1 as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(40);
    expect(stored).not.toHaveProperty('doc-budget-0');
    expect(stored).toHaveProperty('doc-budget-44');
  });
});
