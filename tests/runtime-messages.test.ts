import { describe, expect, it } from 'vitest';
import { isRuntimeMessage } from '../core/messaging/messages';

describe('runtime message guard', () => {
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
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        pageUrl: 'https://example.com/paper',
        result: {
          requestId: 'edited-1',
          originalText: 'Source.',
          translatedText: '修订译文。',
          warnings: [],
        },
      },
    })).toBe(true);
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

  it('accepts a top-frame PDF preview source query', () => {
    expect(isRuntimeMessage({ type: 'GET_ACTIVE_PDF_SOURCE' })).toBe(true);
  });
});
