import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ listener: undefined as any, send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  onMessage: { addListener: (listener: any) => { runtime.listener = listener; } }, sendMessage: runtime.send,
} } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }));
const sender = { tab: { id: 77 } };
const control = (jobId: string, action: string) => runtime.listener({ type: 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
  target: 'pdf-background', payload: { jobId, action } }, sender);
const snapshot = async (jobId: string) => (await runtime.listener({ type: 'GET_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
  target: 'pdf-background', payload: { jobId } }, sender)).snapshot;
function start(jobId: string, count = 2) {
  return runtime.listener({ type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION', target: 'pdf-background', payload: {
    jobId, documentSessionId: 'document', mode: 'text', blocks: Array.from({ length: count }, (_, index) => ({
      id: `b${index + 1}`, pageNumber: index + 1, text: 'The method predicts outputs using local observations and global representations.',
      containsFormula: false, preserveInTextMode: false, visualPurpose: 'document', sourceRegions: [],
    })), settings: { pageUrl: 'https://example.test/paper.pdf', targetLanguage: 'zh-CN', sourceLanguage: 'auto', style: 'academic', contentMode: 'auto' },
  } }, sender);
}

describe('PDF background worker result retention', () => {
  beforeAll(async () => { await import('../entrypoints/pdf-background/main'); });
  afterEach(() => { vi.restoreAllMocks(); runtime.send.mockReset(); });

  it.each(['network', 'missing'] as const)('retains successful siblings when follow-up fails: %s', async failure => {
    const jobId = `partial-${failure}`; const requested: string[][] = [];
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    runtime.send.mockImplementation(async message => {
      if (message.type !== 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK') return {};
      const ids = message.payload.request.items.map((item: any) => item.id); requested.push(ids);
      if (requested.length === 2) return failure === 'network'
        ? { ok: false, error: { code: 'NETWORK_ERROR', message: 'Injected local network failure' } }
        : { ok: true, data: { items: [] } };
      return { ok: true, data: { items: [{ id: ids[0], translatedText: '该方法根据局部观测和全局表示预测输出。' }] } };
    });
    try {
      await start(jobId);
      await vi.waitFor(async () => expect((await snapshot(jobId)).phase).toBe('error'));
      expect((await snapshot(jobId)).completed.map((item: any) => item.blockId)).toEqual(['b1']);
      await control(jobId, 'resume');
      await vi.waitFor(async () => expect((await snapshot(jobId)).phase).toBe('complete'));
      expect((await snapshot(jobId)).completed.map((item: any) => item.blockId)).toEqual(['b1', 'b2']);
      expect(requested).toEqual([['b1', 'b2'], ['b2'], ['b2']]);
    } finally { await control(jobId, 'dispose'); }
  });

  it('retains a fully returned paragraph when pause arrives before the queue commits it', async () => {
    const jobId = 'pause-at-result'; let requests = 0;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    runtime.send.mockImplementation(async message => {
      if (message.type !== 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK') return {};
      requests++;
      await control(jobId, 'pause');
      return { ok: true, data: { items: [{ id: 'b1', translatedText: '该方法根据局部观测和全局表示预测输出。' }] } };
    });
    try {
      await start(jobId, 1);
      await vi.waitFor(async () => expect((await snapshot(jobId)).completed).toHaveLength(1));
      expect((await snapshot(jobId)).phase).toBe('paused');
      await control(jobId, 'resume');
      await vi.waitFor(async () => expect((await snapshot(jobId)).phase).toBe('complete'));
      expect(requests).toBe(1);
    } finally { await control(jobId, 'dispose'); }
  });
});
