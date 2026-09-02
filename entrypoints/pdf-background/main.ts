import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { browser } from 'wxt/browser';

import {
  isPdfBackgroundDocumentMessage,
  PDF_BACKGROUND_CACHE_NAME,
  type PdfBackgroundDocumentMessage,
  type PdfBackgroundTranslationBlock,
  type PdfBackgroundTranslationOutcome,
  type PdfBackgroundTranslationSnapshot,
} from '../../core/pdf/background-document-translation';
import { captureCanvasRegions, normalizeRegion } from '../../core/pdf/region-capture';
import type {
  TranslateRuntimeResponse,
  TranslationBatchRuntimeResponse,
} from '../../core/messaging/messages';

interface BackgroundJob {
  jobId: string;
  documentSessionId: string;
  sourceTabId: number;
  mode: 'text' | 'vision' | 'hybrid';
  blocks: PdfBackgroundTranslationBlock[];
  settings: Extract<
    PdfBackgroundDocumentMessage,
    { type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION' }
  >['payload']['settings'];
  pdf?: PDFDocumentProxy;
  phase: PdfBackgroundTranslationSnapshot['phase'];
  completed: PdfBackgroundTranslationOutcome[];
  activeBlockId?: string;
  activeRequestId?: string;
  errorMessage?: string;
  run?: Promise<void>;
}

const jobs = new Map<string, BackgroundJob>();

function snapshot(job: BackgroundJob): PdfBackgroundTranslationSnapshot {
  return {
    jobId: job.jobId,
    documentSessionId: job.documentSessionId,
    phase: job.phase,
    completed: job.completed.map((outcome) => ({ ...outcome })),
    ...(job.activeBlockId ? { activeBlockId: job.activeBlockId } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
  };
}

function publish(job: BackgroundJob): void {
  void browser.runtime.sendMessage({
    type: 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED',
    payload: snapshot(job),
  } satisfies PdfBackgroundDocumentMessage).catch(() => undefined);
}

async function captureBlock(
  job: BackgroundJob,
  block: PdfBackgroundTranslationBlock,
): Promise<{ imageDataUrl: string; imageWidth: number; imageHeight: number; captureMs: number }> {
  const startedAt = performance.now();
  const pdf = job.pdf;
  if (!pdf) throw new Error('后台 PDF 尚未准备完成。');
  const page = await pdf.getPage(block.pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.4, Math.max(
    1,
    1_800 / Math.max(baseViewport.width, baseViewport.height, 1),
  ));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('当前浏览器无法生成段落区域图像。');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // PDF.js schedules ordinary display rendering through requestAnimationFrame.
  // Offscreen documents are hidden, so their animation frames do not run;
  // print intent deliberately uses the promise-based render scheduler instead.
  await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise;
  const regions = block.sourceRegions.map(({ sourceAnchor: anchor }) => normalizeRegion(
    { x: anchor.leftRatio * baseViewport.width, y: anchor.topRatio * baseViewport.height },
    {
      x: (anchor.leftRatio + anchor.widthRatio) * baseViewport.width,
      y: (anchor.topRatio + anchor.heightRatio) * baseViewport.height,
    },
    { left: 0, top: 0, width: baseViewport.width, height: baseViewport.height },
  ));
  const capture = await captureCanvasRegions(
    canvas,
    { left: 0, top: 0, width: baseViewport.width, height: baseViewport.height },
    regions,
  );
  canvas.width = 0;
  canvas.height = 0;
  return {
    imageDataUrl: capture.dataUrl,
    imageWidth: capture.width,
    imageHeight: capture.height,
    captureMs: Math.max(0, performance.now() - startedAt),
  };
}

async function cancelActiveRequest(job: BackgroundJob): Promise<void> {
  const requestId = job.activeRequestId;
  if (!requestId) return;
  await browser.runtime.sendMessage({
    type: 'CANCEL_PDF_BACKGROUND_VISUAL_BLOCK',
    payload: { sourceTabId: job.sourceTabId, requestId },
  }).catch(() => undefined);
}

function blockContext(job: BackgroundJob, block: PdfBackgroundTranslationBlock): string {
  const previousTranslation = block.previousBlockId
    ? job.completed.find((outcome) => outcome.blockId === block.previousBlockId)?.translatedText
    : undefined;
  return [
    block.contextText,
    previousTranslation ? `上一连续块译文：${previousTranslation.slice(-340)}` : '',
  ].filter(Boolean).join('\n').slice(-1_200).trim();
}

async function processVisualBlock(
  job: BackgroundJob,
  block: PdfBackgroundTranslationBlock,
): Promise<PdfBackgroundTranslationOutcome> {
  if (!block.sourceRegions.length) {
    return {
      blockId: block.id,
      translatedText: block.text,
      visualProcessed: false,
      visualFallbackMessage: block.containsFormula
        ? '含公式段落缺少可靠的原文位置'
        : '本段缺少可靠的视觉定位',
    };
  }
  const capture = await captureBlock(job, block);
  const requestId = crypto.randomUUID();
  job.activeRequestId = requestId;
  const firstRegion = block.sourceRegions[0];
  const contextText = blockContext(job, block);
  const response = await browser.runtime.sendMessage({
    type: 'TRANSLATE_PDF_BACKGROUND_VISUAL_BLOCK',
    payload: {
      sourceTabId: job.sourceTabId,
      request: {
        requestId,
        ...(job.settings.documentId ? { documentId: job.settings.documentId } : {}),
        imageDataUrl: capture.imageDataUrl,
        imageWidth: capture.imageWidth,
        imageHeight: capture.imageHeight,
        visualPurpose: block.visualPurpose,
        recognizedTextHint: block.text,
        ...(contextText ? { contextText } : {}),
        pageUrl: job.settings.pageUrl,
        ...(job.settings.sourceLabel ? { sourceLabel: job.settings.sourceLabel } : {}),
        targetLanguage: job.settings.targetLanguage,
        sourceLanguage: job.settings.sourceLanguage,
        style: job.settings.style,
        ...(firstRegion ? {
          sourceLocation: {
            documentId: job.documentSessionId,
            pageNumber: firstRegion.pageNumber,
            ...firstRegion.sourceAnchor,
          },
        } : {}),
        clientPerformance: { captureMs: capture.captureMs },
      },
    },
  }) as TranslateRuntimeResponse;
  if (job.activeRequestId === requestId) delete job.activeRequestId;
  if (!response.ok) throw Object.assign(new Error(response.error.message), {
    code: response.error.code,
  });
  const result = response.data.result;
  const translatedText = result.translatedText.trim();
  const structurallySafe = !result.formulaNeedsReview && (
    !block.containsFormula || Boolean(result.formulaLatex?.length)
  );
  if (translatedText && structurallySafe) {
    return { blockId: block.id, translatedText, visualProcessed: true };
  }
  return {
    blockId: block.id,
    translatedText: block.text,
    visualProcessed: false,
    visualFallbackMessage: block.containsFormula
      ? '含公式段落的视觉结果未通过结构校验'
      : '视觉模型没有返回可靠译文',
  };
}

async function processTextBlocks(
  job: BackgroundJob,
  blocks: PdfBackgroundTranslationBlock[],
): Promise<PdfBackgroundTranslationOutcome[]> {
  const preserved = blocks
    .filter((block) => block.preserveInTextMode)
    .map((block): PdfBackgroundTranslationOutcome => ({
      blockId: block.id,
      translatedText: block.text,
      visualProcessed: false,
      visualFallbackMessage: '纯文本模式下公式保持原样',
    }));
  let pending = blocks.filter((block) => !block.preserveInTextMode);
  const translated: PdfBackgroundTranslationOutcome[] = [];
  const contextText = pending[0] ? blockContext(job, pending[0]) : '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!pending.length) break;
    const requestId = crypto.randomUUID();
    job.activeRequestId = requestId;
    const response = await browser.runtime.sendMessage({
      type: 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK',
      payload: {
        sourceTabId: job.sourceTabId,
        request: {
          requestId,
          items: pending.map((block) => ({ id: block.id, text: block.text })),
          ...(job.settings.documentId ? { documentId: job.settings.documentId } : {}),
          pageUrl: job.settings.pageUrl,
          ...(job.settings.sourceLabel ? { sourceLabel: job.settings.sourceLabel } : {}),
          targetLanguage: job.settings.targetLanguage,
          sourceLanguage: job.settings.sourceLanguage,
          style: job.settings.style,
          contentMode: job.settings.contentMode,
          ...(contextText ? { contextText } : {}),
        },
      },
    }) as TranslationBatchRuntimeResponse;
    if (job.activeRequestId === requestId) delete job.activeRequestId;
    if (!response.ok) throw Object.assign(new Error(response.error.message), {
      code: response.error.code,
    });
    const returned = new Map(
      response.data.items.map((item) => [item.id, item.translatedText.trim()]),
    );
    for (const block of pending) {
      const translatedText = returned.get(block.id);
      if (translatedText) {
        translated.push({ blockId: block.id, translatedText, visualProcessed: false });
      }
    }
    pending = pending.filter((block) => !returned.get(block.id));
  }
  if (pending.length) {
    throw Object.assign(new Error('模型没有返回部分段落的译文。'), {
      code: 'INVALID_RESPONSE',
    });
  }
  const outcomes = new Map(
    [...preserved, ...translated].map((outcome) => [outcome.blockId, outcome]),
  );
  return blocks.flatMap((block) => {
    const outcome = outcomes.get(block.id);
    return outcome ? [outcome] : [];
  });
}

function runJob(job: BackgroundJob): void {
  if (
    job.run || job.phase !== 'running' ||
    (job.mode !== 'text' && !job.pdf)
  ) return;
  job.run = (async () => {
    const completedIds = new Set(job.completed.map((outcome) => outcome.blockId));
    while (job.phase === 'running') {
      const pending = job.blocks.filter((block) => !completedIds.has(block.id));
      const block = pending[0];
      if (!block) break;
      if (job.phase !== 'running') break;
      job.activeBlockId = block.id;
      publish(job);
      try {
        const useVision = job.mode === 'vision' || (
          job.mode === 'hybrid' && block.visualPurpose !== 'document'
        );
        const textBatch = useVision
          ? []
          : pending.slice(0, 6).filter((candidate) => (
              job.mode !== 'hybrid' || candidate.visualPurpose === 'document'
            ));
        const outcomes = useVision
          ? [await processVisualBlock(job, block)]
          : await processTextBlocks(job, textBatch);
        if (job.phase !== 'running') break;
        job.completed.push(...outcomes);
        outcomes.forEach((outcome) => completedIds.add(outcome.blockId));
        delete job.activeBlockId;
        publish(job);
      } catch (error) {
        delete job.activeRequestId;
        delete job.activeBlockId;
        if (job.phase !== 'running') break;
        const code = error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
        job.phase = code === 'REQUEST_ABORTED' ? 'paused' : 'error';
        job.errorMessage = error instanceof Error ? error.message : 'PDF 后台翻译失败。';
        publish(job);
        break;
      }
    }
    if (job.phase === 'running') {
      job.phase = 'complete';
      delete job.activeBlockId;
      publish(job);
    }
  })().finally(() => {
    delete job.run;
    if (job.phase === 'running') runJob(job);
  });
}

async function disposeJob(job: BackgroundJob): Promise<void> {
  job.phase = 'stopped';
  jobs.delete(job.jobId);
  await cancelActiveRequest(job);
  await job.pdf?.destroy().catch(() => undefined);
}

async function initializeJob(job: BackgroundJob, pdfResourceUrl: string): Promise<void> {
  try {
    const cache = await caches.open(PDF_BACKGROUND_CACHE_NAME);
    const response = await cache.match(pdfResourceUrl);
    if (!response?.ok) throw new Error('无法从临时缓存读取当前 PDF。');
    let data: Uint8Array;
    try {
      data = new Uint8Array(await response.arrayBuffer());
    } finally {
      await cache.delete(pdfResourceUrl).catch(() => false);
    }
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    if (jobs.get(job.jobId) !== job) {
      await pdf.destroy().catch(() => undefined);
      return;
    }
    job.pdf = pdf;
    publish(job);
    runJob(job);
  } catch (error) {
    if (jobs.get(job.jobId) !== job) return;
    job.phase = 'error';
    job.errorMessage = error instanceof Error
      ? error.message
      : '无法准备后台 PDF 翻译。';
    publish(job);
  }
}

browser.runtime.onMessage.addListener((value: unknown, sender): Promise<unknown> | undefined => {
  if (!isPdfBackgroundDocumentMessage(value)) return undefined;
  const message = value;
  if (message.type === 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED') return undefined;
  if (message.type === 'DISPOSE_PDF_BACKGROUND_TRANSLATIONS_FOR_TAB') {
    const matching = [...jobs.values()].filter(
      (job) => job.sourceTabId === message.payload.sourceTabId,
    );
    return Promise.all(matching.map(disposeJob)).then(() => ({ ok: true }));
  }
  if (message.type === 'GET_PDF_BACKGROUND_DOCUMENT_TRANSLATION') {
    const job = jobs.get(message.payload.jobId);
    return Promise.resolve(job ? { ok: true, snapshot: snapshot(job) } : { ok: false });
  }
  if (message.type === 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION') {
    const job = jobs.get(message.payload.jobId);
    if (!job) return Promise.resolve({ ok: false });
    if (message.payload.action === 'dispose') {
      return disposeJob(job).then(() => ({ ok: true }));
    }
    if (message.payload.action === 'pause') {
      job.phase = 'paused';
      delete job.errorMessage;
      return cancelActiveRequest(job).then(() => {
        delete job.activeBlockId;
        publish(job);
        return { ok: true, snapshot: snapshot(job) };
      });
    }
    if (message.payload.action === 'stop') {
      job.phase = 'stopped';
      delete job.errorMessage;
      return cancelActiveRequest(job).then(() => {
        delete job.activeBlockId;
        publish(job);
        return { ok: true, snapshot: snapshot(job) };
      });
    }
    job.phase = 'running';
    delete job.errorMessage;
    publish(job);
    runJob(job);
    return Promise.resolve({ ok: true, snapshot: snapshot(job) });
  }
  const sourceTabId = sender.tab?.id;
  if (sourceTabId === undefined) return Promise.resolve({ ok: false });
  const existing = jobs.get(message.payload.jobId);
  if (existing) void disposeJob(existing);
  const job: BackgroundJob = {
    jobId: message.payload.jobId,
    documentSessionId: message.payload.documentSessionId,
    sourceTabId,
    mode: message.payload.mode,
    blocks: message.payload.blocks,
    settings: message.payload.settings,
    phase: 'running',
    completed: [],
  };
  jobs.set(job.jobId, job);
  if (job.mode !== 'text') void initializeJob(job, message.payload.pdfResourceUrl!);
  else runJob(job);
  return Promise.resolve({ ok: true, snapshot: snapshot(job) });
});
