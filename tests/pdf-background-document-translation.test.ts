import { describe, expect, it } from 'vitest';

import {
  isPdfBackgroundDocumentMessage,
  isPdfBackgroundProxyMessage,
  pdfBackgroundVisualResultIsStructurallySafe,
} from '../core/pdf/background-document-translation';

function startMessage() {
  return {
    type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
    target: 'pdf-background',
    payload: {
      jobId: 'job-1',
      documentSessionId: 'document-1',
      mode: 'vision',
      pdfResourceUrl: 'https://pi-translator.invalid/__pdf-background/document-1.pdf',
      blocks: [{
        id: 'P1B1',
        pageNumber: 1,
        text: 'Energy E = mc^2 remains visible.',
        containsFormula: true,
        preserveInTextMode: false,
        visualPurpose: 'formula',
        sourceRegions: [],
      }],
      settings: {
        pageUrl: 'chrome-extension://extension-id/pdf.html',
        targetLanguage: 'zh-CN',
        sourceLanguage: 'auto',
        style: 'academic',
        contentMode: 'auto',
      },
    },
  };
}

describe('PDF background translation message guards', () => {
  it('accepts complete figure and table translations without formula metadata', () => {
    expect(pdfBackgroundVisualResultIsStructurallySafe({
      containsFormula: true,
      visualPurpose: 'figure',
    }, {
      formulaNeedsReview: true,
      formulaLatex: [],
    })).toBe(true);
    expect(pdfBackgroundVisualResultIsStructurallySafe({
      containsFormula: true,
      visualPurpose: 'table',
    }, {
      formulaLatex: [],
    })).toBe(true);
    expect(pdfBackgroundVisualResultIsStructurallySafe({
      containsFormula: true,
      visualPurpose: 'formula',
    }, {
      formulaLatex: [],
    })).toBe(false);
  });

  it('accepts complete start, control, snapshot, and tab cleanup messages', () => {
    expect(isPdfBackgroundDocumentMessage(startMessage())).toBe(true);
    expect(isPdfBackgroundDocumentMessage({
      ...startMessage(),
      payload: { ...startMessage().payload, mode: 'hybrid' },
    })).toBe(true);
    expect(isPdfBackgroundDocumentMessage({
      type: 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
      target: 'pdf-background',
      payload: { jobId: 'job-1', action: 'pause' },
    })).toBe(true);
    expect(isPdfBackgroundDocumentMessage({
      type: 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED',
      payload: {
        jobId: 'job-1',
        documentSessionId: 'document-1',
        phase: 'running',
        completed: [],
      },
    })).toBe(true);
    expect(isPdfBackgroundDocumentMessage({
      type: 'DISPOSE_PDF_BACKGROUND_TRANSLATIONS_FOR_TAB',
      target: 'pdf-background',
      payload: { sourceTabId: 12 },
    })).toBe(true);
  });

  it('rejects incomplete jobs and invalid tab cleanup targets', () => {
    expect(isPdfBackgroundDocumentMessage({
      ...startMessage(),
      payload: { ...startMessage().payload, mode: 'automatic' },
    })).toBe(false);
    expect(isPdfBackgroundDocumentMessage({
      ...startMessage(),
      payload: {
        ...startMessage().payload,
        blocks: startMessage().payload.blocks.map(({ visualPurpose: _purpose, ...block }) => block),
      },
    })).toBe(false);
    expect(isPdfBackgroundDocumentMessage({
      type: 'DISPOSE_PDF_BACKGROUND_TRANSLATIONS_FOR_TAB',
      target: 'pdf-background',
      payload: { sourceTabId: -1 },
    })).toBe(false);
  });

  it('accepts only correctly identified privileged proxy requests', () => {
    expect(isPdfBackgroundProxyMessage({ type: 'ENSURE_PDF_BACKGROUND_DOCUMENT' })).toBe(true);
    expect(isPdfBackgroundProxyMessage({
      type: 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK',
      payload: { sourceTabId: 12, request: { requestId: 'request-1' } },
    })).toBe(true);
    expect(isPdfBackgroundProxyMessage({
      type: 'TRANSLATE_PDF_BACKGROUND_VISUAL_BLOCK',
      payload: { sourceTabId: -1, request: { requestId: 'request-1' } },
    })).toBe(false);
  });
});
