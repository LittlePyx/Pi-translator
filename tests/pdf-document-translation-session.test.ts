import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,
  PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,
  clearRetainedPdfDocumentTranslationSession,
  clearPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationStorageSummary,
  getPdfDocumentTranslationSession,
  pdfDocumentTranslationSessionBehaviorKey,
  pdfDocumentTranslationSessionBlockSignature,
  pdfDocumentTranslationSessionDocumentKey,
  saveRetainedPdfDocumentTranslationSession,
  savePdfDocumentTranslationSession,
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

  it('invalidates a session when the provider behavior changes', async () => {
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
    expect(sessionStorage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeUndefined();
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
