import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPdfReadingMessageHandlers } from '../core/background/pdf-reading-message-handlers';
import { isRuntimeMessage } from '../core/messaging/messages';
import { getPdfReadingState, savePdfReadingState } from '../core/pdf/reading-state';

const fingerprint = 'a'.repeat(64);
const readerUrl = 'chrome-extension://pi/pdf.html';
const state = { pageNumber: 3, pageRatio: .25, zoomLevel: 1.25, fitWidth: false, sidebarExpanded: false, updatedAt: 200 };
let values: Record<string, unknown>;
beforeEach(() => {
  values = { oldTranslation: '旧译文与人工修正 $E=mc^2$' };
  vi.stubGlobal('browser', { storage: { local: {
    get: async (key: string) => structuredClone({ [key]: values[key] }),
    set: async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF reading snapshot handoff', () => {
  it('validates the fingerprint and numeric reading snapshot at the runtime boundary', () => {
    expect(isRuntimeMessage({ type: 'SAVE_PDF_READING_STATE', payload: { fingerprint, state } })).toBe(true);
    for (const payload of [
      { fingerprint: 'private.pdf', state },
      { fingerprint, state: { ...state, pageRatio: NaN } },
      { fingerprint, state: { pageNumber: 1 } },
      { fingerprint, state, apiKey: 'unrelated' },
    ]) expect(isRuntimeMessage({ type: 'SAVE_PDF_READING_STATE', payload })).toBe(false);
  });

  it('accepts the Pi reader and rejects webpages, other extensions and extension popups', async () => {
    const handlers = createPdfReadingMessageHandlers(readerUrl);
    const message = { type: 'SAVE_PDF_READING_STATE' as const, payload: { fingerprint, state } };
    for (const url of ['https://example.org/pdf.html', 'chrome-extension://other/pdf.html', 'chrome-extension://pi/popup.html']) {
      expect(await handlers.SAVE_PDF_READING_STATE(message, { url })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PAGE' } });
    }
    expect(values).toEqual({ oldTranslation: '旧译文与人工修正 $E=mc^2$' });
    expect(await handlers.SAVE_PDF_READING_STATE(message, { url: `${readerUrl}?url=https://example.org/source.pdf` })).toMatchObject({ ok: true });
    expect(await getPdfReadingState(`pdf-content:${fingerprint}`)).toEqual(state);
    expect(values.oldTranslation).toBe('旧译文与人工修正 $E=mc^2$');
    expect(JSON.stringify(values)).not.toContain('source.pdf');
  });

  it('keeps a newer unload snapshot when an older debounced save arrives later', async () => {
    await savePdfReadingState(`pdf-content:${fingerprint}`, state);
    await savePdfReadingState('another-document', { ...state, updatedAt: 150 });
    await savePdfReadingState(`pdf-content:${fingerprint}`, { ...state, pageRatio: 0, updatedAt: 100 });
    expect(await getPdfReadingState(`pdf-content:${fingerprint}`)).toEqual(state);
    expect(await getPdfReadingState('another-document')).toBeDefined();
  });
});
