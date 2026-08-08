import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDocumentReferenceContext,
  clearDocumentMemory,
  confirmDocumentTerm,
  dismissDocumentTermCandidate,
  documentMemoryTranslationResult,
  getDocumentMemory,
  mergeDocumentGlossary,
  rememberDocumentCorrection,
  rememberDocumentTranslation,
  resolveDocumentReview,
  restoreDocumentCorrection,
  upsertDocumentTerm,
} from '../core/document/document-memory-repository';
import type { TranslateResult } from '../core/translation/types';

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

  it('atomically remembers a corrected translation and restores a whitespace-normalized term', async () => {
    const before = await upsertDocumentTerm(identity, {
      source: 'adaptive  sensing',
      target: '旧译法',
    });
    const originalTermId = before.confirmedTerms[0]!.id;
    const set = browser.storage.local.set as ReturnType<typeof vi.fn>;
    set.mockClear();

    const corrected = await rememberDocumentCorrection(identity, {
      requestId: 'correction-request',
      originalText: 'Adaptive sensing is stable.',
      translatedText: '自适应感知保持稳定。',
      warnings: [],
      completedAt: 30,
    }, {
      source: 'adaptive sensing',
      target: '自适应感知',
    });

    expect(set).toHaveBeenCalledTimes(1);
    expect(corrected.termChange).toMatchObject({
      previousTarget: '旧译法',
      documentTermId: originalTermId,
    });
    expect(corrected.memory.confirmedTerms).toHaveLength(1);

    set.mockClear();
    const restored = await restoreDocumentCorrection(identity, {
      requestId: 'restored-request',
      originalText: 'Adaptive sensing is stable.',
      translatedText: '旧译文。',
      warnings: [],
      completedAt: 40,
    }, corrected.termChange);
    expect(set).toHaveBeenCalledTimes(1);
    expect(restored.termRolledBack).toBe(true);
    expect(restored.memory.confirmedTerms[0]).toMatchObject({
      id: originalTermId,
      target: '旧译法',
    });
    expect(restored.memory.recentTranslations[0]?.translatedText).toBe('旧译文。');
  });

  it('allows an explicit document term to preserve its source spelling', async () => {
    const memory = await upsertDocumentTerm(identity, {
      source: 'ResNet',
      target: 'ResNet',
    });
    expect(memory.confirmedTerms[0]).toMatchObject({ source: 'ResNet', target: 'ResNet' });
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

  it('keeps one pending review per image region without persisting capture data', async () => {
    const sourceLocation = {
      documentId: 'pdf-session-review',
      pageNumber: 3,
      leftRatio: 0.12,
      topRatio: 0.24,
      widthRatio: 0.31,
      heightRatio: 0.08,
    };
    const captureDataUrl = 'data:image/png;base64,private-capture-bytes';
    const resultWithCapture = {
      requestId: 'review-root',
      originalText: 'The uncertain source contains $x+y$.',
      translatedText: '待核对的译文。',
      warnings: [],
      sourceKind: 'image-region',
      sourceLocation,
      formulaNeedsReview: true,
      uncertainSpans: ['公式结构需要核对', ' 公式结构需要核对 '],
      completedAt: 10,
      imageDataUrl: captureDataUrl,
    } satisfies TranslateResult & { imageDataUrl: string };

    let memory = await rememberDocumentTranslation(identity, resultWithCapture);
    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.recentTranslations[0]).toMatchObject({
      requestId: 'review-root',
      review: {
        formulaNeedsReview: true,
        uncertainSpans: ['公式结构需要核对'],
      },
    });
    const reviewId = memory.recentTranslations[0]!.review!.id;
    expect(JSON.stringify(storage)).not.toContain('data:image/');
    expect(JSON.stringify(storage)).not.toContain('private-capture-bytes');

    memory = await rememberDocumentTranslation(identity, {
      requestId: 'review-repeat',
      originalText: 'The corrected OCR still contains $x+y$.',
      translatedText: '仍需核对的新译文。',
      warnings: [],
      sourceKind: 'image-region',
      sourceLocation,
      formulaNeedsReview: true,
      uncertainSpans: ['新的公式问题'],
      completedAt: 20,
      revision: {
        rootRequestId: 'review-root',
        kind: 'custom',
        label: '重新识别',
        scope: 'document',
      },
    });
    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.recentTranslations[0]).toMatchObject({
      requestId: 'review-repeat',
      review: {
        id: reviewId,
        uncertainSpans: ['新的公式问题'],
      },
    });

    memory = await rememberDocumentTranslation(identity, {
      requestId: 'review-clean',
      originalText: 'The corrected OCR contains $x+y$.',
      translatedText: '已经核对通过的译文。',
      warnings: [],
      sourceKind: 'image-region',
      sourceLocation: { ...sourceLocation, documentId: 'pdf-session-after-reopen' },
      uncertainSpans: [],
      completedAt: 30,
      revision: {
        rootRequestId: 'review-root',
        kind: 'custom',
        label: '重新识别',
        scope: 'document',
      },
    });
    expect(memory.recentTranslations).toHaveLength(1);
    expect(memory.recentTranslations[0]).toMatchObject({ requestId: 'review-clean' });
    expect(memory.recentTranslations[0]?.review).toBeUndefined();
  });

  it('isolates resolved reviews and reopens them only when the evidence changes', async () => {
    const otherIdentity = { documentId: 'doc-other', label: 'other.pdf' };
    const sourceLocation = {
      documentId: 'pdf-session-isolation',
      pageNumber: 2,
      leftRatio: 0.1,
      topRatio: 0.2,
      widthRatio: 0.4,
      heightRatio: 0.1,
    };
    const reviewResult = {
      requestId: 'isolated-review',
      originalText: 'The formula $a=b$ needs review.',
      translatedText: '公式需要核对。',
      warnings: [],
      sourceKind: 'image-region' as const,
      sourceLocation,
      formulaNeedsReview: true,
      uncertainSpans: ['等式两侧可能不一致'],
      completedAt: 10,
    };

    const first = await rememberDocumentTranslation(identity, reviewResult);
    await rememberDocumentTranslation(otherIdentity, {
      ...reviewResult,
      requestId: 'other-review',
    });
    const reviewId = first.recentTranslations[0]!.review!.id;
    const resolved = await resolveDocumentReview(identity, reviewId);
    const reviewedAt = resolved.recentTranslations[0]!.review!.reviewedAt;
    expect(reviewedAt).toEqual(expect.any(Number));
    expect((await getDocumentMemory(otherIdentity)).recentTranslations[0]?.review?.reviewedAt)
      .toBeUndefined();

    const repeated = await rememberDocumentTranslation(identity, {
      ...reviewResult,
      requestId: 'identical-review-repeat',
      revision: {
        rootRequestId: 'isolated-review',
        kind: 'custom',
        label: '重新识别',
        scope: 'document',
      },
    });
    expect(repeated.recentTranslations).toHaveLength(1);
    expect(repeated.recentTranslations[0]?.review?.reviewedAt).toBe(reviewedAt);

    const changed = await rememberDocumentTranslation(identity, {
      ...reviewResult,
      requestId: 'changed-review-repeat',
      uncertainSpans: ['检测到新的公式不一致'],
      revision: {
        rootRequestId: 'isolated-review',
        kind: 'custom',
        label: '重新识别',
        scope: 'document',
      },
    });
    expect(changed.recentTranslations).toHaveLength(1);
    expect(changed.recentTranslations[0]?.review).toMatchObject({
      id: reviewId,
      uncertainSpans: ['检测到新的公式不一致'],
    });
    expect(changed.recentTranslations[0]?.review?.reviewedAt).toBeUndefined();
  });

  it('keeps pending reviews out of context and clears them with document memory', async () => {
    const sourceLocation = {
      documentId: 'pdf-session-context',
      pageNumber: 1,
      leftRatio: 0.2,
      topRatio: 0.3,
      widthRatio: 0.35,
      heightRatio: 0.12,
    };
    let memory = await rememberDocumentTranslation(identity, {
      requestId: 'context-review',
      originalText: 'The adaptive sensing formula remains uncertain.',
      translatedText: '自适应感知公式仍需核对。',
      warnings: [],
      sourceKind: 'image-region',
      sourceLocation,
      formulaNeedsReview: true,
      uncertainSpans: ['公式分隔符没有闭合'],
      completedAt: 10,
    });
    expect(buildDocumentReferenceContext(
      'This adaptive sensing formula is reused.',
      undefined,
      memory,
    )).toBeUndefined();

    const entry = memory.recentTranslations[0]!;
    expect(documentMemoryTranslationResult(entry, 'paper.pdf')).toMatchObject({
      requestId: 'context-review',
      sourceHost: 'paper.pdf',
      sourceKind: 'image-region',
      sourceLocation,
      formulaNeedsReview: true,
      uncertainSpans: ['公式分隔符没有闭合'],
      cached: true,
    });

    memory = await resolveDocumentReview(identity, entry.review!.id);
    expect(buildDocumentReferenceContext(
      'This adaptive sensing formula is reused.',
      undefined,
      memory,
    )).toContain('自适应感知公式仍需核对。');

    memory = await clearDocumentMemory(identity);
    expect(memory.recentTranslations).toHaveLength(0);
    expect((await getDocumentMemory(identity)).recentTranslations).toHaveLength(0);
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
