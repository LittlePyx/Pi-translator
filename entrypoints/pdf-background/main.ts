import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { browser } from 'wxt/browser';
import { translationErrorMessage } from '../../core/messaging/user-facing-error';

import {
  isPdfBackgroundDocumentMessage,
  pdfBackgroundVisualOutcome,
  pdfBackgroundTextOutcome,
  PDF_BACKGROUND_CACHE_NAME,
  type PdfBackgroundDocumentMessage,
  type PdfBackgroundTranslationBlock,
  type PdfBackgroundTranslationOutcome,
  type PdfBackgroundTranslationSnapshot,
} from '../../core/pdf/background-document-translation';
import { capturePdfVisualRegions } from '../../core/pdf/document-visual-capture';
import { PdfCapturePrefetch } from '../../core/pdf/capture-prefetch';
import {pdfFontHintText} from '../../core/pdf/math-font-evidence';
import { combinePdfVisualOutcomes, pdfVisualUnitContext } from '../../core/pdf/visual-unit-translation';
import { addPdfReportedTokens, consumePdfRequest, emptyPdfRequestUsage, type PdfRequestUsage } from '../../core/pdf/request-budget';
import {preparePdfFormulaProseRepair} from '../../core/pdf/formula-prose-repair';
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
  unitOutcomes: Map<string, PdfBackgroundTranslationOutcome[]>;
  captures: PdfCapturePrefetch<Awaited<ReturnType<typeof capturePdfVisualRegions>>>;
  timing: NonNullable<PdfBackgroundTranslationSnapshot['performance']>;
  activeBlockId?: string;
  activeRequestId?: string;
  errorMessage?: string;
  run?: Promise<void>;
  requestUsage: PdfRequestUsage;
  snapshotRevision: number;
}

const jobs = new Map<string, BackgroundJob>();

function snapshot(job: BackgroundJob): PdfBackgroundTranslationSnapshot {
  return {
    jobId: job.jobId,
    revision: ++job.snapshotRevision,
    documentSessionId: job.documentSessionId,
    phase: job.phase,
    requestUsage: { ...job.requestUsage },
    performance: { ...job.timing },
    completed: job.completed.map((outcome) => ({ ...outcome })),
    ...(job.activeBlockId ? { activeBlockId: job.activeBlockId } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
  };
}

function publish(job: BackgroundJob): void {
  if (job.phase !== 'running') console.info('[Pi PDF timing]', { phase: job.phase, ...job.timing });
  void browser.runtime.sendMessage({
    type: 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED',
    payload: snapshot(job),
  } satisfies PdfBackgroundDocumentMessage).catch(() => undefined);
}

async function captureBlock(job: BackgroundJob, block: PdfBackgroundTranslationBlock) {
  if (!job.pdf) throw new Error("后台 PDF 尚未准备完成。");
  return capturePdfVisualRegions(job.pdf, block.sourceRegions);
}

const captureKey = (block: PdfBackgroundTranslationBlock) => JSON.stringify(block.sourceRegions);

function nextVisualCapture(job: BackgroundJob, current: PdfBackgroundTranslationBlock) {
  const leaves = job.blocks.flatMap((block) => {
    if (job.mode !== 'vision' && !(job.mode === 'hybrid' && block.visualPurpose !== 'document')) return [];
    const { visualUnits, ...base } = block;
    return visualUnits?.length ? visualUnits.map((unit) => ({ ...base, ...unit })) : [block];
  });
  const index = leaves.findIndex((block) => captureKey(block) === captureKey(current));
  return index < 0 ? undefined : leaves[index + 1];
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
  const previous = block.previousBlockId
    ? job.completed.find((outcome) => outcome.blockId === block.previousBlockId)
    : undefined;
  // Review placeholders are UI annotations, never model context. The source
  // continuity context is still available for these unfinished results.
  const previousTranslation = previous?.formulaReviewMessage || previous?.visualFallbackMessage
    ? undefined : previous?.translatedText;
  return [
    block.contextText,
    previousTranslation ? `上一连续块译文：${previousTranslation.slice(-340)}` : '',
  ].filter(Boolean).join('\n').slice(-1_200).trim();
}

async function processVisualBlock(
  job: BackgroundJob,
  block: PdfBackgroundTranslationBlock,
): Promise<PdfBackgroundTranslationOutcome> {
  const units = block.visualUnits;
  if (units?.length) {
    const completed = job.unitOutcomes.get(block.id) ?? [];
    job.unitOutcomes.set(block.id, completed);
    while (completed.length < units.length) {
      if (job.phase !== 'running') throw Object.assign(new Error('已暂停'), { code: 'REQUEST_ABORTED' });
      const index = completed.length;
      const unit = units[index]!;
      const { visualUnits: _plan, ...base } = block;
      const result = await processVisualBlock(job, { ...base, ...unit,
        contextText: pdfVisualUnitContext(units, index, block.contextText) });
      // Save a successfully returned region even if pause arrives immediately
      // afterwards. Resume must not charge for that region a second time.
      completed.push(result);
    }
    return combinePdfVisualOutcomes(block.id, completed);
  }
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
  const waitStartedAt = performance.now();
  const { value: capture, prefetched } = await job.captures.take(captureKey(block), () => captureBlock(job, block));
  job.timing.captureWaitMs += performance.now() - waitStartedAt;
  job.timing.captures += 1;
  job.timing.prefetched += Number(prefetched);
  job.timing.pageRenderMs += capture.pageRenderMs;
  job.timing.cropEncodeMs += capture.cropEncodeMs;
  if (job.phase !== 'running') throw Object.assign(new Error('已暂停'), { code: 'REQUEST_ABORTED' });
  const requestId = crypto.randomUUID();
  job.activeRequestId = requestId;
  const firstRegion = block.sourceRegions[0];
  const contextText = blockContext(job, block);
  const requestStartedAt = performance.now();
  const next = nextVisualCapture(job, block);
  if (next?.sourceRegions.length) job.captures.prepare(captureKey(next), async () => {
    if (job.phase !== 'running') throw Object.assign(new Error('已暂停'), { code: 'REQUEST_ABORTED' });
    return captureBlock(job, next);
  });
  consumePdfRequest(job.requestUsage, 'vision', job.settings.requestLimit ?? 0);
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
        recognizedTextHint: pdfFontHintText(block.text,block.sourceFontHints),
        ...(block.sourceEquations ? { sourceEquations: block.sourceEquations } : {}),
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
  job.timing.requestMs += performance.now() - requestStartedAt;
  if (job.activeRequestId === requestId) delete job.activeRequestId;
  if (!response.ok) throw Object.assign(new Error(translationErrorMessage(response.error.code, response.error.message)), {
    code: response.error.code,
  });
  let result = response.data.result;
  let repairNote:string|undefined;
  if (!result.cached) addPdfReportedTokens(job.requestUsage, result.usage, result.usageSource);
  if(job.phase==='running'&&preparePdfFormulaProseRepair(result.formulaDocument,job.settings.targetLanguage)){
    let authorized=true;try{consumePdfRequest(job.requestUsage,'text',job.settings.requestLimit??0)}catch{authorized=false;repairNote='任务请求上限不足，未发送正文修复。'}
    if(authorized){
      job.activeRequestId=requestId;
      const repaired=await browser.runtime.sendMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{sourceTabId:job.sourceTabId,requestId,document:result.formulaDocument!,targetLanguage:job.settings.targetLanguage,sourceLanguage:job.settings.sourceLanguage,style:job.settings.style}}) as TranslateRuntimeResponse;
      if(job.activeRequestId===requestId)delete job.activeRequestId;
      if(repaired.ok){result=repaired.data.result;addPdfReportedTokens(job.requestUsage,result.usage,result.usageSource)}else repairNote=`正文修复未完成：${translationErrorMessage(repaired.error.code,repaired.error.message)}`;
    }
  }
  const validationStartedAt = performance.now();
  const outcome = pdfBackgroundVisualOutcome(block, result, job.settings.targetLanguage);
  if(repairNote)outcome.formulaReviewMessage=[outcome.formulaReviewMessage,repairNote].filter(Boolean).join('；').slice(0,1800);
  job.timing.validationMs += performance.now() - validationStartedAt;
  return outcome;
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
  try {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!pending.length) break;
    const requestId = crypto.randomUUID();
    job.activeRequestId = requestId;
    consumePdfRequest(job.requestUsage, 'text', job.settings.requestLimit ?? 0);
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
    if (!response.ok) throw Object.assign(new Error(translationErrorMessage(response.error.code, response.error.message)), {
      code: response.error.code,
    });
    addPdfReportedTokens(job.requestUsage, response.data.usage, response.data.usageSource);
    const returned = new Map(
      response.data.items.map((item) => [item.id, item.translatedText.trim()]),
    );
    for (const block of pending) {
      const translatedText = returned.get(block.id);
      if (translatedText) {
        translated.push(pdfBackgroundTextOutcome(block, translatedText, job.settings.targetLanguage));
      }
    }
    pending = pending.filter((block) => !returned.get(block.id));
  }
  if (pending.length) {
    throw Object.assign(new Error('模型没有返回部分段落的译文。'), {
      code: 'INVALID_RESPONSE',
    });
  }
  } catch (error) {
    // Budget, network and incomplete follow-up replies must all preserve the
    // successful siblings so resume never pays for those paragraphs again.
    const known = new Set(job.completed.map(outcome => outcome.blockId));
    job.completed.push(...[...preserved, ...translated].filter(outcome => !known.has(outcome.blockId)));
    throw error;
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
        if (jobs.get(job.jobId) !== job) break;
        // A fully returned result still belongs to this task when pause/stop
        // arrives at this boundary. Persist it before honoring that control.
        job.completed.push(...outcomes);
        outcomes.forEach((outcome) => job.unitOutcomes.delete(outcome.blockId));
        outcomes.forEach((outcome) => completedIds.add(outcome.blockId));
        delete job.activeBlockId;
        publish(job);
      } catch (error) {
        job.captures.clear();
        delete job.activeRequestId;
        delete job.activeBlockId;
        if (job.phase !== 'running') break;
        const code = error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
        job.phase = code === 'REQUEST_ABORTED' || code === 'REQUEST_BUDGET_REACHED' ? 'paused' : 'error';
        job.errorMessage = error instanceof Error ? error.message : 'PDF 后台翻译失败。';
        publish(job);
        break;
      }
    }
    if (job.phase === 'running') {
      job.phase = 'complete';
      job.captures.clear();
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
  job.captures.clear();
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
      job.captures.clear();
      delete job.errorMessage;
      return cancelActiveRequest(job).then(() => {
        delete job.activeBlockId;
        publish(job);
        return { ok: true, snapshot: snapshot(job) };
      });
    }
    if (message.payload.action === 'stop') {
      job.phase = 'stopped';
      job.captures.clear();
      delete job.errorMessage;
      return cancelActiveRequest(job).then(() => {
        delete job.activeBlockId;
        publish(job);
        return { ok: true, snapshot: snapshot(job) };
      });
    }
    if (message.payload.requestLimit !== undefined) job.settings.requestLimit = message.payload.requestLimit;
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
    snapshotRevision: 0,
    requestUsage: { ...message.payload.settings.requestUsage ?? emptyPdfRequestUsage() },
    unitOutcomes: new Map(),
    captures: new PdfCapturePrefetch(),
    timing: { captures: 0, prefetched: 0, pageRenderMs: 0, cropEncodeMs: 0,
      captureWaitMs: 0, requestMs: 0, validationMs: 0 },
  };
  jobs.set(job.jobId, job);
  if (job.mode !== 'text') void initializeJob(job, message.payload.pdfResourceUrl!);
  else runJob(job);
  return Promise.resolve({ ok: true, snapshot: snapshot(job) });
});
