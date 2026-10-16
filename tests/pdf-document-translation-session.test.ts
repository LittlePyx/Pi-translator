import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactFormulaDocument, formulaDocumentText, parseFormulaDocument } from '../core/translation/formula-document';
import {fixedDocumentKey,retainDocumentSessions} from '../core/translation/fixed-document-storage';
import {
  PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,
  PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,
  clearRetainedPdfDocumentTranslationSession,
  clearPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationStorageSummary,
  getPdfDocumentTranslationSession,
  getPdfDocumentTranslationPlan,
  pdfDocumentTranslationSessionBehaviorKey,
  pdfDocumentTranslationSessionBlockSignature,
  pdfDocumentTranslationSessionDocumentKey,
  saveRetainedPdfDocumentTranslationSession,
  savePdfDocumentTranslationSession,
  archivedPdfTranslationBlocks,
  reusablePdfTranslationBlocks,
  pdfTranslationSourceCompatible,
  sanitizeRetainedPdfRecord,
  type PdfDocumentTranslationSessionDescriptor,
} from '../core/pdf/document-translation-session';

const sessionStorage: Record<string, unknown> = {};
const localStorage: Record<string, unknown> = {};
const sourceTexts = [
  'A private paper heading',
  'The first private PDF paragraph.',
  'The second private PDF paragraph.',
];
const signatures = sourceTexts.map((text, index) => (
  pdfDocumentTranslationSessionBlockSignature(index + 1, text, 0)
));
const descriptor = (
  identity = 'https://example.com/private-paper.pdf',
): PdfDocumentTranslationSessionDescriptor => ({
  documentKey: pdfDocumentTranslationSessionDocumentKey(identity),
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  style: 'academic',
  contentMode: 'auto',
});

beforeEach(() => {
  for (const key of Object.keys(sessionStorage)) delete sessionStorage[key];
  for (const key of Object.keys(localStorage)) delete localStorage[key];
  const area = (storage: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
    remove: vi.fn(async (key: string) => { delete storage[key]; }),
  });
  vi.stubGlobal('browser', {
    storage: {
      session: area(sessionStorage),
      local: area(localStorage),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('PDF document translation session repository', () => {
  it('counts archived formulas and corrections against fixed-document storage limits', () => {
    const record={...descriptor(),updatedAt:1,blocks:[{translatedText:'当前'}],archivedBlocks:[{translatedText:'旧修正'.repeat(10),formulaDocument:{latex:'x'.repeat(100)}}]};
    expect(()=>retainDocumentSessions('pdf',[record],new Set([fixedDocumentKey('pdf',record)]),6,50)).toThrow('上限');
  });
  it('migrates only exact paragraphs of the same PDF and archives removed corrections and formulas through replacement', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('migration');
    const sourceFingerprint = 'a'.repeat(64);
    const formulaDocument = parseFormulaDocument({recognizedText:'Original {{m1}}.', translation:'人工修正 {{m1}}。', formulas:[{id:'m1',latex:'\\mathcal{P}',display:false}]});
    const corrected = {signature:signatures[0]!, translatedText:formulaDocument.translationTemplate, formulaDocument:compactFormulaDocument(formulaDocument),
      reviewConfirmation:'review-ab12',formulaReviewMessage:'人工核对说明',formulaReviewDraft:true as const};
    const oldSplit = {signature:signatures[1]!,translatedText:'旧分段人工修正'};
    const merged = pdfDocumentTranslationSessionBlockSignature(2, 'A newly combined complete sentence.', 0);
    for (const [save, read] of [[savePdfDocumentTranslationSession,getPdfDocumentTranslationSession],
      [saveRetainedPdfDocumentTranslationSession,getRetainedPdfDocumentTranslationSession]] as const) {
      await save({descriptor:descriptor(),documentSignatures:signatures,sourceFingerprint,activity:'complete',blocks:[corrected,oldSplit]},behaviorKey);
      const old = (await read(descriptor(),behaviorKey))!;
      const nextSignatures = [signatures[0]!,merged];
      expect(reusablePdfTranslationBlocks(old,nextSignatures,sourceFingerprint)).toEqual([expect.objectContaining(corrected)]);
      expect(archivedPdfTranslationBlocks(old,nextSignatures,sourceFingerprint)).toEqual([oldSplit]);
      expect(pdfTranslationSourceCompatible(old,nextSignatures,'b'.repeat(64))).toBe(false);
      const {sourceFingerprint: _fingerprint, ...withoutFingerprint} = old;
      expect(pdfTranslationSourceCompatible(withoutFingerprint,nextSignatures,sourceFingerprint)).toBe(false);
      expect(reusablePdfTranslationBlocks(old,nextSignatures,undefined)).toEqual([]);
      expect(reusablePdfTranslationBlocks(old,nextSignatures,'b'.repeat(64),{allowUpdatedDocument:true})).toEqual([corrected]);
      await save({descriptor:descriptor(),documentSignatures:nextSignatures,sourceFingerprint,activity:'paused',replaceBlocks:true,blocks:[corrected]},behaviorKey);
      await save({descriptor:descriptor(),documentSignatures:nextSignatures,sourceFingerprint,activity:'complete',replaceBlocks:true,
        blocks:[corrected,{signature:merged,translatedText:'完整句子的新译文'}]},behaviorKey);
      const migrated = (await read(descriptor(),behaviorKey))!;
      expect(migrated.blocks.find(block=>block.signature===signatures[0])).toEqual(expect.objectContaining(corrected));
      expect(migrated.archivedBlocks).toEqual([oldSplit]);
      expect(sanitizeRetainedPdfRecord({...migrated,behaviorKey})?.archivedBlocks).toEqual([oldSplit]);
      expect(sanitizeRetainedPdfRecord({...migrated,behaviorKey,archivedBlocks:[corrected]})).toBeUndefined();
      expect(sanitizeRetainedPdfRecord({...migrated,behaviorKey,sourceFingerprint:undefined})).toBeUndefined();
      expect(reusablePdfTranslationBlocks(migrated,signatures,sourceFingerprint)).toEqual(expect.arrayContaining([oldSplit]));
      // A library restore must also copy archived work into an initially empty session.
      await clearPdfDocumentTranslationSession();
      await savePdfDocumentTranslationSession({descriptor:descriptor(),documentSignatures:nextSignatures,sourceFingerprint,
        activity:'complete',replaceBlocks:true,blocks:migrated.blocks,archivedBlocks:migrated.archivedBlocks!},behaviorKey);
      expect((await getPdfDocumentTranslationSession(descriptor(),behaviorKey))?.archivedBlocks).toEqual([oldSplit]);
      await expect(savePdfDocumentTranslationSession({descriptor:descriptor(),documentSignatures:nextSignatures,
        activity:'paused',archivedBlocks:[oldSplit]},behaviorKey)).rejects.toThrow();
    }
    expect((await getRetainedPdfDocumentTranslationStorageSummary()).translationCharacters).toBe(
      corrected.translatedText.length + oldSplit.translatedText.length + '完整句子的新译文'.length);
  });
  it('retains task choices through background checkpoints and restores an independent copy from local retention', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('task-plan');
    const plan = {mode: 'custom' as const, pages: [2, 3], skipReferences: true, skipAppendix: false, multimodal: false, requestLimit: 10};
    for (const save of [savePdfDocumentTranslationSession, saveRetainedPdfDocumentTranslationSession]) {
      await save({descriptor: descriptor(), documentSignatures: signatures, activity: 'paused', plan}, behaviorKey);
      await save({descriptor: descriptor(), documentSignatures: signatures, activity: 'paused', blocks: [{signature: signatures[0]!, translatedText: '已翻译。'}]}, behaviorKey);
    }
    const restored = (await getPdfDocumentTranslationPlan(descriptor()))!;
    expect(restored).toEqual(plan);
    restored.pages.push(9);
    await clearPdfDocumentTranslationSession(descriptor());
    expect(await getPdfDocumentTranslationPlan(descriptor())).toEqual(plan);
    expect(JSON.stringify(localStorage)).not.toContain('private-paper.pdf');
  });
  it('rejects malformed task choices without overwriting a saved translation', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('task-plan-validation');
    const plan = {mode: 'current' as const, pages: [2], skipReferences: false, skipAppendix: false, multimodal: true, requestLimit: 1};
    for (const save of [savePdfDocumentTranslationSession, saveRetainedPdfDocumentTranslationSession]) {
      const update = {descriptor: descriptor(), documentSignatures: signatures, activity: 'paused' as const, plan};
      await save(update, behaviorKey);
      for (const invalid of [{...plan, pages: [2, 2]}, {...plan, pages: []}, {...plan, pages: [1, 2]}, {...plan, requestLimit: -1}, {...plan, pageUrl: 'https://example.com'}]) {
        await expect(save({...update, plan: invalid}, behaviorKey)).rejects.toThrow();
      }
    }
    expect(await getPdfDocumentTranslationPlan(descriptor())).toEqual(plan);
  });
  it('stores one formula transcription without source prose and removes it on replacement', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('formula-registry');
    const formulaDocument = parseFormulaDocument({ recognizedText: 'Private source prose {{m1}} and {{m2}}.',
      translation: '矩阵 {{m1}} 和 {{m2}}。', formulas: [
        { id: 'm1', latex: 'E^{h}', display: false },
        { id: 'm2', latex: 'E^{l}', display: false, uncertain: true },
      ] });
    const update = { descriptor: descriptor(), documentSignatures: signatures, activity: 'complete' as const,
      blocks: [{ signature: signatures[0]!, translatedText: formulaDocumentText(formulaDocument), formulaDocument,
        formulaReviewMessage: 'm2 待核对' }] };
    for (const [save, read, storage] of [
      [savePdfDocumentTranslationSession, getPdfDocumentTranslationSession, sessionStorage],
      [saveRetainedPdfDocumentTranslationSession, getRetainedPdfDocumentTranslationSession, localStorage],
    ] as const) {
      await save(update, behaviorKey);
      const saved = (await read(descriptor(), behaviorKey))!.blocks[0]!;
      expect(saved.translatedText).toBe(formulaDocument.translationTemplate);
      expect(formulaDocumentText(saved.formulaDocument!)).toBe(formulaDocumentText(formulaDocument));
      const serialized = JSON.stringify(storage);
      expect(serialized).not.toContain('Private source prose');
      expect(serialized).not.toContain('private-paper.pdf');
      expect(serialized.match(/E\^\{h\}/gu)).toHaveLength(1);
      await save({ ...update, blocks: [{ signature: signatures[0]!, translatedText: '重试成功' }] }, behaviorKey);
      expect((await read(descriptor(), behaviorKey))!.blocks[0]!.formulaDocument).toBeUndefined();
    }
  });
  it('retains formula review and fallback states through session and local restore', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('formula-review');
    const blocks = [
      { signature: signatures[0]!, translatedText: '保留的正文译文，含待核对的公式 y=Ax。', formulaReviewMessage: '公式结构未通过校验', formulaReviewDraft: true as const },
      { signature: signatures[1]!, translatedText: 'Original source', visualFallbackMessage: '模型未返回译文' },
    ];
    const update = { descriptor: descriptor(), documentSignatures: signatures, activity: 'complete' as const, blocks };
    await savePdfDocumentTranslationSession(update, behaviorKey);
    await saveRetainedPdfDocumentTranslationSession(update, behaviorKey);
    for (const read of [getPdfDocumentTranslationSession, getRetainedPdfDocumentTranslationSession]) {
      const saved = await read(descriptor(), behaviorKey);
      expect(saved?.blocks).toEqual(expect.arrayContaining(blocks));
    }
    const serialized = JSON.stringify(localStorage);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('private-paper.pdf');
    await savePdfDocumentTranslationSession({ ...update, blocks: [
      { signature: signatures[0]!, translatedText: '重新翻译成功。' },
    ] }, behaviorKey);
    const saved = await getPdfDocumentTranslationSession(descriptor(), behaviorKey);
    expect(saved?.blocks.find((block) => block.signature === signatures[0])?.formulaReviewMessage).toBeUndefined();
    expect(saved?.blocks.find((block) => block.signature === signatures[0])?.formulaReviewDraft).toBeUndefined();
  });
  it('keeps a paragraph signature stable when unrelated blocks are inserted on the same page', () => {
    const text = 'A stable paragraph can move to a later block index.';
    const beforeInsertion = pdfDocumentTranslationSessionBlockSignature(4, text, 0);
    const afterInsertion = pdfDocumentTranslationSessionBlockSignature(4, text, 0);
    expect(afterInsertion).toBe(beforeInsertion);
    expect(pdfDocumentTranslationSessionBlockSignature(4, text, 1))
      .not.toBe(beforeInsertion);
  });

  it('restores translated paragraphs without persisting the PDF identity or source text', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('default\ne2e-model');
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'paused',
      blocks: [{ signature: signatures[0]!, translatedText: '一篇私密论文的标题' }],
    }, behaviorKey);

    await expect(getPdfDocumentTranslationSession(descriptor(), behaviorKey)).resolves
      .toMatchObject({
        activity: 'paused',
        blocks: [{ signature: signatures[0], translatedText: '一篇私密论文的标题' }],
      });
    const serialized = JSON.stringify(
      sessionStorage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY],
    );
    expect(serialized).not.toContain('https://example.com/private-paper.pdf');
    sourceTexts.forEach((text) => expect(serialized).not.toContain(text));
  });

  it('merges completed batches and discards blocks removed from the current document plan', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('same-model');
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'active',
      blocks: [{ signature: signatures[0]!, translatedText: '标题' }],
    }, behaviorKey);
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures.slice(1),
      activity: 'complete',
      blocks: [
        { signature: signatures[1]!, translatedText: '第一段' },
        { signature: signatures[2]!, translatedText: '第二段' },
      ],
    }, behaviorKey);

    await expect(getPdfDocumentTranslationSession(descriptor(), behaviorKey)).resolves
      .toMatchObject({
        activity: 'complete',
        documentSignatures: signatures.slice(1),
        blocks: [
          { signature: signatures[2], translatedText: '第二段' },
          { signature: signatures[1], translatedText: '第一段' },
        ],
      });
  });

  it('can replace cached blocks when the user explicitly retranslates a range', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('same-model');
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'complete',
      blocks: [
        { signature: signatures[0]!, translatedText: '旧标题' },
        { signature: signatures[1]!, translatedText: '保留正文' },
      ],
    }, behaviorKey);
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'paused',
      replaceBlocks: true,
      blocks: [{ signature: signatures[1]!, translatedText: '保留正文' }],
    }, behaviorKey);

    await expect(getPdfDocumentTranslationSession(descriptor(), behaviorKey)).resolves
      .toMatchObject({
        blocks: [{ signature: signatures[1], translatedText: '保留正文' }],
      });
  });

  it('does not reuse another provider behavior and preserves its stored work', async () => {
    const firstBehavior = pdfDocumentTranslationSessionBehaviorKey('model-a');
    const secondBehavior = pdfDocumentTranslationSessionBehaviorKey('model-b');
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'complete',
      blocks: [{ signature: signatures[0]!, translatedText: '旧模型译文' }],
    }, firstBehavior);

    await expect(getPdfDocumentTranslationSession(descriptor(), secondBehavior)).resolves
      .toBeUndefined();
    expect(sessionStorage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeDefined();
  });

  it('isolates documents and clears only the requested session', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('model-a');
    const another = descriptor('https://example.com/another-paper.pdf');
    await savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'paused',
    }, behaviorKey);
    await savePdfDocumentTranslationSession({
      descriptor: another,
      documentSignatures: signatures,
      activity: 'paused',
    }, behaviorKey);

    await clearPdfDocumentTranslationSession(descriptor());
    await expect(getPdfDocumentTranslationSession(descriptor(), behaviorKey)).resolves
      .toBeUndefined();
    await expect(getPdfDocumentTranslationSession(another, behaviorKey)).resolves.toBeDefined();
    await clearPdfDocumentTranslationSession();
    expect(sessionStorage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeUndefined();
  });

  it('retains an explicitly saved translation locally without storing PDF identity or source text', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('persistent-model');
    await saveRetainedPdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'complete',
      blocks: [
        { signature: signatures[0]!, translatedText: '一篇保留在本机的译文' },
        { signature: signatures[1]!, translatedText: '第一段译文' },
      ],
    }, behaviorKey);

    expect(sessionStorage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeUndefined();
    await expect(getRetainedPdfDocumentTranslationSession(descriptor(), behaviorKey)).resolves
      .toMatchObject({
        activity: 'complete',
        blocks: [
          { signature: signatures[1], translatedText: '第一段译文' },
          { signature: signatures[0], translatedText: '一篇保留在本机的译文' },
        ],
      });
    const serialized = JSON.stringify(
      localStorage[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY],
    );
    expect(serialized).not.toContain('https://example.com/private-paper.pdf');
    sourceTexts.forEach((text) => expect(serialized).not.toContain(text));
    await expect(getRetainedPdfDocumentTranslationStorageSummary()).resolves.toMatchObject({
      documentCount: 1,
      translationCharacters: 15,
      maximumDocuments: 6,
      nearingCapacity: false,
    });
  });

  it('keeps an older retained result intact when the active model changes', async () => {
    const firstBehavior = pdfDocumentTranslationSessionBehaviorKey('model-a');
    const secondBehavior = pdfDocumentTranslationSessionBehaviorKey('model-b');
    await saveRetainedPdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures,
      activity: 'complete',
      blocks: [{ signature: signatures[0]!, translatedText: '明确保留的旧模型译文' }],
    }, firstBehavior);

    await expect(getRetainedPdfDocumentTranslationSession(descriptor(), secondBehavior)).resolves
      .toBeUndefined();
    await expect(getRetainedPdfDocumentTranslationSession(descriptor(), firstBehavior)).resolves
      .toBeDefined();
  });

  it('bounds retained translations and can clear one document or all local results', async () => {
    const behaviorKey = pdfDocumentTranslationSessionBehaviorKey('model-a');
    for (let index = 0; index < 8; index += 1) {
      await saveRetainedPdfDocumentTranslationSession({
        descriptor: descriptor(`https://example.com/retained-${index}.pdf`),
        documentSignatures: signatures,
        activity: 'complete',
        blocks: [{ signature: signatures[0]!, translatedText: `本机译文 ${index}` }],
      }, behaviorKey);
    }
    const retained = localStorage[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY];
    expect(Array.isArray(retained) ? retained : []).toHaveLength(6);

    const newest = descriptor('https://example.com/retained-7.pdf');
    await clearRetainedPdfDocumentTranslationSession(newest);
    await expect(getRetainedPdfDocumentTranslationSession(newest, behaviorKey)).resolves
      .toBeUndefined();
    expect(localStorage[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).toBeDefined();
    await clearRetainedPdfDocumentTranslationSession();
    expect(localStorage[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).toBeUndefined();
    await expect(getRetainedPdfDocumentTranslationStorageSummary()).resolves.toMatchObject({
      documentCount: 0,
      translationCharacters: 0,
      estimatedBytes: 0,
    });
  });

  it('rejects translations that are not part of the current paragraph plan', async () => {
    await expect(savePdfDocumentTranslationSession({
      descriptor: descriptor(),
      documentSignatures: signatures.slice(0, 1),
      activity: 'active',
      blocks: [{ signature: signatures[1]!, translatedText: '不应保存' }],
    }, pdfDocumentTranslationSessionBehaviorKey('model-a'))).rejects
      .toThrow('not part of this document');
  });
});
