import { describe, expect, it } from 'vitest';
import {
  isRuntimeMessage,
  isTranslationCorrectionReceipt,
} from '../core/messaging/messages';

function correctedResult() {
  return {
    requestId: 'corrected-1',
    originalText: 'Source text.',
    translatedText: 'Corrected translation.',
    warnings: [],
    revision: {
      rootRequestId: 'base-1',
      kind: 'manual' as const,
      label: 'Manual correction',
      scope: 'document' as const,
    },
  };
}

function correctionReceipt() {
  return {
    baseRequestId: 'base-1',
    correctedRequestId: 'corrected-1',
    scope: 'document' as const,
    previousTranslation: 'Previous translation.',
    correctedTranslation: 'Corrected translation.',
    termChange: {
      scope: 'document' as const,
      source: 'source term',
      appliedTarget: 'corrected term',
      previousTarget: 'previous term',
      documentTermId: 'term-1',
    },
  };
}

describe('runtime message guard', () => {
  it('accepts the explicit webpage region-selection action', () => {
    expect(isRuntimeMessage({ type: 'START_WEB_REGION_SELECTION' })).toBe(true);
    expect(isRuntimeMessage({
      type: 'START_WEB_REGION_SELECTION',
      payload: { restorePreviousRegion: true },
    })).toBe(true);
    expect(isRuntimeMessage({ type: 'OPEN_WEB_CAPTURE_PERMISSION_PANEL' })).toBe(true);
    expect(isRuntimeMessage({ type: 'PREPARE_WEB_CAPTURE_PERMISSION' })).toBe(true);
    expect(isRuntimeMessage({
      type: 'PREPARE_WEB_CAPTURE_PERMISSION',
      payload: { intent: 'start' },
    })).toBe(true);
    expect(isRuntimeMessage({ type: 'GET_CURRENT_WEB_CAPTURE_PERMISSION_PROMPT' })).toBe(true);
    expect(isRuntimeMessage({ type: 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT' })).toBe(true);
    expect(isRuntimeMessage({ type: 'GET_SIDEBAR_OBSTRUCTION_HINT' })).toBe(true);
    expect(isRuntimeMessage({ type: 'DISMISS_SIDEBAR_OBSTRUCTION_HINT' })).toBe(true);
    expect(isRuntimeMessage({ type: 'GET_CONTINUOUS_TRANSLATION_STATE' })).toBe(true);
    expect(isRuntimeMessage({
      type: 'SET_CONTINUOUS_TRANSLATION_PAUSED',
      payload: { tabId: 7, paused: true },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'CONTINUOUS_TRANSLATION_STATE_UPDATED',
      payload: { tabId: 7, paused: false },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'SET_CONTINUOUS_TRANSLATION_PAUSED',
      payload: { tabId: 7, paused: 'yes' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'CONTINUOUS_TRANSLATION_STATE_UPDATED',
      payload: { tabId: -1, paused: false },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'RETRANSLATE_SIDE_PANEL_TRANSLATION',
      payload: { tabId: 7, expectedRequestId: 'request-1', targetLanguage: 'en' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION',
      payload: {
        expectedRequestId: 'request-1',
        targetLanguage: 'ja',
        result: {
          requestId: 'result-1',
          originalText: 'Source text.',
          translatedText: '译文。',
          warnings: [],
        },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'RETRANSLATE_SIDE_PANEL_TRANSLATION',
      payload: { tabId: 7, expectedRequestId: 'request-1', targetLanguage: 'xx' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION',
      payload: { expectedRequestId: '', targetLanguage: 'fr' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'START_BILINGUAL_PAGE',
      payload: { tabId: 7, targetLanguage: 'zh-CN' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'CONTROL_BILINGUAL_PAGE',
      payload: { tabId: 7, action: 'pause' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'BILINGUAL_PAGE_STATE_UPDATED',
      payload: {
        state: {
          phase: 'running',
          total: 9,
          translated: 3,
          failed: 0,
          targetLanguage: 'en',
        },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'CONTROL_BILINGUAL_PAGE',
      payload: { tabId: 7, action: 'delete' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'BILINGUAL_PAGE_TAB_STATE_UPDATED',
      payload: {
        tabId: 7,
        state: {
          phase: 'complete',
          total: 2,
          translated: 3,
          failed: 0,
        },
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'GET_WEB_CAPTURE_PERMISSION_PROMPT',
      payload: { tabId: 7 },
    })).toBe(true);
  });

  it('strictly validates staged translation progress messages', () => {
    const basePayload = {
      requestId: 'translation-1',
      partialText: 'Partial translation.',
      completedChunks: 0,
      totalChunks: 2,
    };

    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: basePayload,
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: { ...basePayload, progressStage: 'provider' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: { ...basePayload, progressStage: 'validating-latex' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: { ...basePayload, progressStage: 'committing' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: {
        ...basePayload,
        completedChunks: 2,
        result: {
          requestId: 'translation-1',
          originalText: 'Source text.',
          translatedText: 'Translated text.',
          warnings: [],
        },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: { ...basePayload, progressStage: 'unknown-stage' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'TRANSLATION_PROGRESS',
      payload: { ...basePayload, privateSourceText: 'must not be accepted' },
    })).toBe(false);
  });

  it('accepts the dedicated vision-capability test message', () => {
    expect(isRuntimeMessage({
      type: 'TEST_VISION_CAPABILITY',
      payload: {
        apiBaseUrl: 'https://api.example.com/v1',
        model: 'vision-model',
        profileId: 'vision-profile',
      },
    })).toBe(true);
  });

  it('accepts the dedicated PDF page OCR message', () => {
    expect(isRuntimeMessage({
      type: 'RECOGNIZE_PDF_PAGE',
      payload: {
        requestId: 'ocr-1',
        imageDataUrl: 'data:image/png;base64,AA==',
        imageWidth: 100,
        imageHeight: 100,
        pageNumber: 1,
      },
    })).toBe(true);
  });

  it('accepts document-memory operations', () => {
    expect(isRuntimeMessage({
      type: 'GET_DOCUMENT_MEMORY',
      payload: { pageUrl: 'https://example.com/paper' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UPSERT_DOCUMENT_TERM',
      payload: {
        pageUrl: 'https://example.com/paper',
        term: { source: 'ROI', target: '感兴趣区域' },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'RESOLVE_DOCUMENT_REVIEW',
      payload: {
        pageUrl: 'https://example.com/paper',
        documentId: 'document-1',
        reviewId: 'review-1',
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: {
          requestId: 'edited-1',
          originalText: 'Source.',
          translatedText: '修订译文。',
          warnings: [],
        },
        previousTranslatedText: '原译文。',
        baseRequestId: 'base-1',
      },
    })).toBe(true);
  });

  it('accepts manual-correction update and undo messages', () => {
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        scope: 'document',
        previousTranslatedText: 'Previous translation.',
        baseRequestId: 'base-1',
        term: { source: 'source term', target: 'corrected term', scope: 'document' },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_SEGMENT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: {
          ...correctedResult(),
          alignedSegments: [{
            id: 'S1',
            originalText: 'Source.',
            translatedText: 'Previous translation.',
          }],
        },
        segmentId: 'S1',
        expectedTranslatedText: 'Previous translation.',
        correctedTranslatedText: 'Corrected translation.',
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UNDO_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        receipt: correctionReceipt(),
      },
    })).toBe(true);
  });

  it('accepts native PDF manual-correction update and undo messages', () => {
    expect(isRuntimeMessage({
      type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: {
        tabId: 7,
        expectedRequestId: 'native-pdf-request',
        expectedResultRequestId: 'native-pdf-result',
        translatedText: 'Corrected translation.',
        scope: 'current',
        term: { source: 'source term', target: 'corrected term', scope: 'global' },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: {
        tabId: 7,
        expectedRequestId: 'native-pdf-request',
        expectedResultRequestId: 'native-pdf-corrected-result',
        expectedCorrectedRequestId: 'native-pdf-corrected-result',
      },
    })).toBe(true);
  });

  it('strictly validates native PDF cancellation compare-and-set fields', () => {
    expect(isRuntimeMessage({
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: 7, expectedRequestId: 'native-pdf-request' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: -1, expectedRequestId: 'native-pdf-request' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: 7, expectedRequestId: '' },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: 7 },
    })).toBe(false);
  });

  it('validates correction receipts including their scope and term rollback', () => {
    expect(isTranslationCorrectionReceipt(correctionReceipt())).toBe(true);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      documentTermChange: {
        sourceKey: 'source term',
        applied: {
          id: 'term-1',
          source: 'source term',
          target: 'corrected term',
          createdAt: 1,
          updatedAt: 2,
        },
        previous: {
          id: 'term-1',
          source: 'source term',
          target: 'previous term',
          createdAt: 1,
          updatedAt: 1,
        },
        removedCandidates: [{
          id: 'candidate-1',
          source: 'source term',
          target: 'candidate translation',
          createdAt: 1,
        }],
        introducedCandidates: [],
      },
    })).toBe(true);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      termChange: { ...correctionReceipt().termChange, scope: 'global' },
      documentTermChange: {
        sourceKey: 'source term',
        removedCandidates: [],
        introducedCandidates: [],
      },
    })).toBe(false);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      documentTermChange: {
        sourceKey: 'source term',
        removedCandidates: Array.from({ length: 21 }, (_, index) => ({
          id: `candidate-${index}`,
          source: `source-${index}`,
          target: `target-${index}`,
          createdAt: 1,
        })),
        introducedCandidates: [],
      },
    })).toBe(false);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      segmentChange: {
        segmentId: 'S1',
        previousTranslatedText: 'Previous sentence.',
        correctedTranslatedText: 'Corrected sentence.',
      },
    })).toBe(true);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      scope: undefined,
    })).toBe(false);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      correctedRequestId: 'base-1',
    })).toBe(false);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      termChange: { ...correctionReceipt().termChange, scope: 'global' },
    })).toBe(true);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      correctedTranslation: 'Previous translation.',
    })).toBe(false);
    expect(isTranslationCorrectionReceipt({
      ...correctionReceipt(),
      segmentChange: {
        segmentId: 'S1',
        previousTranslatedText: 'Same sentence.',
        correctedTranslatedText: 'Same sentence.',
      },
    })).toBe(false);
  });

  it('rejects malformed manual-correction messages before dispatch', () => {
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_SEGMENT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        segmentId: '',
        expectedTranslatedText: 'Previous translation.',
        correctedTranslatedText: 'Corrected translation.',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: { ...correctedResult(), translatedText: '' },
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        previousTranslatedText: 'Previous translation.',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        baseRequestId: 'base-1',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UNDO_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: correctedResult(),
        receipt: { ...correctionReceipt(), correctedRequestId: '' },
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: {
        tabId: -1,
        expectedRequestId: 'request-1',
        translatedText: 'Corrected translation.',
        scope: 'document',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: {
        tabId: 7,
        expectedRequestId: 'request-1',
        translatedText: 'Corrected translation.',
        scope: 'forever',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: { tabId: 7, expectedRequestId: '' },
    })).toBe(false);
  });

  it('accepts batched local MathML rendering', () => {
    expect(isRuntimeMessage({
      type: 'RENDER_LATEX_MATHML_BATCH',
      payload: {
        items: [
          { tex: 'E=mc^2', displayMode: false },
          { tex: '\\arg\\min_x f(x)', displayMode: true },
        ],
      },
    })).toBe(true);
  });

  it('strictly accepts only content-free local render performance summaries', () => {
    expect(isRuntimeMessage({
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'render-result',
        timings: { totalMs: 18, textRenderMs: 3, mathRenderMs: 15 },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'render-result',
        timings: { totalMs: 18, textRenderMs: 3, mathRenderMs: 15 },
        text: 'private paper text',
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'translate-text',
        timings: { totalMs: 18, textRenderMs: 3, mathRenderMs: 15 },
      },
    })).toBe(false);
    expect(isRuntimeMessage({
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'render-result',
        timings: { totalMs: Number.NaN, textRenderMs: 3, mathRenderMs: 15 },
      },
    })).toBe(false);
  });

  it('accepts a top-frame PDF preview source query', () => {
    expect(isRuntimeMessage({ type: 'GET_ACTIVE_PDF_SOURCE' })).toBe(true);
  });

  it('accepts the settings recovery lifecycle messages', () => {
    expect(isRuntimeMessage({
      type: 'OPEN_OPTIONS_PAGE',
      payload: {
        focus: 'api',
        recovery: {
          role: 'text',
          errorCode: 'NO_API_KEY',
          failedRequestId: 'request-1',
          hadPartialOutput: false,
          autoResume: true,
          clientId: 'content-client-1',
        },
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'GET_SETTINGS_RECOVERY',
      payload: { token: 'opaque-recovery-token' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'COMPLETE_SETTINGS_RECOVERY',
      payload: {
        token: 'opaque-recovery-token',
        configurationRevision: 'opaque-configuration-revision',
      },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'SETTINGS_RECOVERY_READY',
      payload: {
        token: 'opaque-recovery-token',
        role: 'text',
        failedRequestId: 'request-1',
        hadPartialOutput: false,
        autoResume: true,
        targetKind: 'content-script',
        sourceTabId: 7,
        clientId: 'content-client-1',
      },
    })).toBe(true);
  });
});
