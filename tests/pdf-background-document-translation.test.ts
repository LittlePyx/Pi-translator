import { describe, expect, it } from 'vitest';

import {
  isPdfBackgroundDocumentMessage,
  isPdfBackgroundProxyMessage,
  pdfBackgroundVisualFallbackMessage,
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

  it('accepts a simple inline equation when extraction, recognition, and translation agree', () => {
    const block = {
      containsFormula: true,
      visualPurpose: 'formula' as const,
      text: 'We set the sampling matrix Φ in Eq. (1) to Φ = PF, where P is under-sampling.',
    };
    expect(pdfBackgroundVisualResultIsStructurallySafe(block, {
      recognizedText: 'We set the sampling matrix Φ in Eq. (1) to Φ = PF.',
      translatedText: '我们将式（1）中的采样矩阵 Φ 设置为 Φ = PF。',
      formulaLatex: [],
    })).toBe(true);
    expect(pdfBackgroundVisualResultIsStructurallySafe(block, {
      recognizedText: 'We set the sampling matrix Φ in Eq. (1) to Φ = PF.',
      translatedText: '我们将式（1）中的采样矩阵设置为 PF。',
      formulaLatex: [],
    })).toBe(false);
    expect(pdfBackgroundVisualResultIsStructurallySafe(block, {
      recognizedText: 'We set the sampling matrix Φ in Eq. (1) to Φ = PF.',
      translatedText: '我们将式（1）中的采样矩阵 Φ 设置为 Φ = PF。',
      formulaLatex: [],
      formulaNeedsReview: true,
    })).toBe(false);
    expect(pdfBackgroundVisualResultIsStructurallySafe({
      ...block,
      text: 'We use Φ = PF and reconstruct with y = Ax.',
    }, {
      recognizedText: 'We use Φ = PF and reconstruct with y = Ax.',
      translatedText: '我们使用 Φ = PF 进行重建。',
      formulaLatex: [],
    })).toBe(false);
    expect(pdfBackgroundVisualResultIsStructurallySafe({
      ...block,
      text: 'See https://example.test/read?mode=a=b for details.',
    }, {
      recognizedText: 'See https://example.test/read?mode=a=b for details.',
      translatedText: '详情参见 https://example.test/read?mode=a=b。',
      formulaLatex: [],
    })).toBe(false);
  });

  it('reports the concrete formula fallback reason', () => {
    const block = {
      containsFormula: true,
      visualPurpose: 'formula' as const,
      text: 'The result is E = mc^2.',
    };
    expect(pdfBackgroundVisualFallbackMessage(block, {
      formulaLatex: [],
    })).toBe('模型未返回可核对的公式结构');
    expect(pdfBackgroundVisualFallbackMessage(block, {
      formulaLatex: ['E=mc^2'],
      formulaNeedsReview: true,
      uncertainSpans: ['公式 LaTeX 未通过自动校验：识别原文与译文中的公式不一致'],
    })).toBe('公式结构未通过校验：识别原文与译文中的公式不一致');
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
