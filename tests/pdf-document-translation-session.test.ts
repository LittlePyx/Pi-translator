import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,
  clearPdfDocumentTranslationSession,
  getPdfDocumentTranslationSession,
  pdfDocumentTranslationSessionBehaviorKey,
  pdfDocumentTranslationSessionBlockSignature,
  pdfDocumentTranslationSessionDocumentKey,
  savePdfDocumentTranslationSession,
  type PdfDocumentTranslationSessionDescriptor,
} from '../core/pdf/document-translation-session';

const storage: Record<string, unknown> = {};
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
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
        remove: vi.fn(async (key: string) => { delete storage[key]; }),
      },
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
      storage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY],
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
    expect(storage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeUndefined();
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
    expect(storage[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]).toBeUndefined();
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
