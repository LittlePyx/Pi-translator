import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { startSelectionTranslator } from '../../core/content/selection-translator';
import { parsePdfSourceUrl, pdfFilename, pdfInitialPage } from '../../core/pdf/source';
import {
  captureCanvasRegion,
  isUsableRegion,
  moveRegion,
  normalizeRegion,
  resizeRegion,
  type Point,
  type RegionRect,
  type RegionResizeHandle,
} from '../../core/pdf/region-capture';
import type { RuntimeMessage } from '../../core/messaging/messages';

GlobalWorkerOptions.workerSrc = workerUrl;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing PDF viewer element #${id}`);
  return value as T;
}

const fileInput = element<HTMLInputElement>('file-input');
const chooseFile = element<HTMLButtonElement>('choose-file');
const emptyOpen = element<HTMLButtonElement>('empty-open');
const documentName = element<HTMLElement>('document-name');
const pageCount = element<HTMLElement>('page-count');
const regionTranslate = element<HTMLButtonElement>('region-translate');
const zoomOut = element<HTMLButtonElement>('zoom-out');
const zoomIn = element<HTMLButtonElement>('zoom-in');
const zoomValue = element<HTMLOutputElement>('zoom-value');
const openSettings = element<HTMLButtonElement>('open-settings');
const stage = element<HTMLElement>('document-stage');
const emptyState = element<HTMLElement>('empty-state');
const loading = element<HTMLElement>('loading');
const loadingText = element<HTMLElement>('loading-text');
const notice = element<HTMLElement>('notice');
const viewer = element<HTMLElement>('pdf-viewer');

const ZOOM_LEVELS = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;
let zoomIndex = 2;
let pdfDocument: PDFDocumentProxy | undefined;
let currentSourceUrl = location.href;
let currentSourceLabel: string | undefined;
let renderGeneration = 0;
let pageObserver: IntersectionObserver | undefined;
const activeRenderTasks = new Set<RenderTask>();
const invalidationCallbacks: Array<() => void> = [];
let regionMode = false;
let scanHintShownForDocument = false;
let noticeRevision = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

type RegionInteraction =
  | { kind: 'draw'; pointerId: number; start: Point }
  | { kind: 'move'; pointerId: number; start: Point; initialRegion: RegionRect }
  | {
    kind: 'resize';
    pointerId: number;
    handle: RegionResizeHandle;
    initialRegion: RegionRect;
  };

interface ActiveRegionSelection {
  pageElement: HTMLElement;
  canvas: HTMLCanvasElement;
  region: RegionRect;
  box: HTMLElement;
  confirm?: HTMLElement;
  interaction: RegionInteraction | undefined;
}

let activeRegion: ActiveRegionSelection | undefined;

function currentZoom(): number {
  return ZOOM_LEVELS[zoomIndex] ?? 1.25;
}

function setLoading(message: string | undefined): void {
  loading.hidden = !message;
  if (message) loadingText.textContent = message;
}

function showNotice(
  message: string | undefined,
  options: { transient?: boolean } = {},
): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = undefined;
  noticeRevision += 1;
  notice.hidden = !message;
  notice.textContent = message ?? '';
  notice.classList.toggle('transient', Boolean(message && options.transient));
  if (!message || !options.transient) return;
  const revision = noticeRevision;
  noticeTimer = setTimeout(() => {
    if (noticeRevision !== revision) return;
    notice.hidden = true;
    notice.textContent = '';
    notice.classList.remove('transient');
    noticeTimer = undefined;
  }, 4500);
}

function setDocumentControls(enabled: boolean): void {
  zoomOut.disabled = !enabled || zoomIndex === 0;
  zoomIn.disabled = !enabled || zoomIndex === ZOOM_LEVELS.length - 1;
  zoomValue.value = `${Math.round(currentZoom() * 100)}%`;
  regionTranslate.disabled = !enabled;
}

function clearRegionSelection(): void {
  activeRegion?.box.remove();
  activeRegion?.confirm?.remove();
  activeRegion = undefined;
}

function setRegionMode(enabled: boolean): void {
  regionMode = enabled && Boolean(pdfDocument);
  clearRegionSelection();
  viewer.classList.toggle('region-mode', regionMode);
  regionTranslate.setAttribute('aria-pressed', String(regionMode));
  if (regionMode) {
    window.getSelection()?.removeAllRanges();
    showNotice('拖动框选 · 选框可移动和缩放 · Esc 取消', { transient: true });
  } else {
    showNotice(undefined);
  }
}

function clearDocument(): void {
  setRegionMode(false);
  renderGeneration += 1;
  pageObserver?.disconnect();
  pageObserver = undefined;
  for (const task of activeRenderTasks) task.cancel();
  activeRenderTasks.clear();
  viewer.replaceChildren();
  window.getSelection()?.removeAllRanges();
}

async function renderPage(
  page: PDFPageProxy,
  pageElement: HTMLElement,
  generation: number,
): Promise<void> {
  if (pageElement.dataset.rendered || generation !== renderGeneration) return;
  pageElement.dataset.rendered = 'loading';
  const scale = currentZoom();
  const viewport = page.getViewport({ scale });
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  const textContainer = pageElement.querySelector<HTMLElement>('.textLayer');
  if (!canvas || !textContainer) return;

  // Render above the CSS pixel density so thin paper fonts stay crisp at the
  // default zoom. Pages are lazy-rendered, and the dimension cap prevents an
  // unusually large page or zoom level from exhausting canvas memory.
  const desiredOutputScale = Math.min(
    Math.max((window.devicePixelRatio || 1) * 1.35, 2),
    3,
  );
  const outputScale = Math.min(
    desiredOutputScale,
    8192 / Math.max(viewport.width, 1),
    8192 / Math.max(viewport.height, 1),
  );
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is unavailable.');

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    ...(outputScale === 1
      ? {}
      : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
  });
  activeRenderTasks.add(renderTask);
  try {
    const textContentPromise = page.getTextContent();
    await renderTask.promise;
    const textContent = await textContentPromise;
    if (generation !== renderGeneration) return;
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textContainer,
      viewport,
    });
    await textLayer.render();
    if (generation !== renderGeneration) return;
    pageElement.dataset.rendered = 'ready';
    const hasText = textLayer.textContentItemsStr.some((value) => value.trim());
    pageElement.dataset.hasText = String(hasText);
    if (!hasText && !scanHintShownForDocument && !regionMode) {
      scanHintShownForDocument = true;
      showNotice('可能是扫描版 PDF · 可用“框选翻译”识别局部内容', {
        transient: true,
      });
    }
  } finally {
    activeRenderTasks.delete(renderTask);
  }
}

async function buildPages(pdf: PDFDocumentProxy, targetPage = 1): Promise<void> {
  clearDocument();
  const generation = renderGeneration;
  const scale = currentZoom();
  viewer.style.setProperty('--scale-factor', String(scale));
  viewer.hidden = false;
  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pageElement = entry.target as HTMLElement;
        const pageNumber = Number(pageElement.dataset.pageNumber);
        void pdf.getPage(pageNumber)
          .then((page) => renderPage(page, pageElement, generation))
          .catch((error: unknown) => {
            if (generation !== renderGeneration) return;
            pageElement.dataset.rendered = 'error';
            pageElement.title = error instanceof Error ? error.message : String(error);
          });
        pageObserver?.unobserve(pageElement);
      }
    },
    { root: stage, rootMargin: '900px 0px' },
  );

  const firstPage = await pdf.getPage(1);
  if (generation !== renderGeneration) return;
  const defaultViewport = firstPage.getViewport({ scale });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageElement = document.createElement('article');
    pageElement.className = 'pdf-page';
    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.ariaLabel = `第 ${pageNumber} 页`;
    pageElement.style.width = `${defaultViewport.width}px`;
    pageElement.style.height = `${defaultViewport.height}px`;
    const canvas = document.createElement('canvas');
    canvas.ariaHidden = 'true';
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    pageElement.append(canvas, textLayer);
    viewer.append(pageElement);
    pageObserver.observe(pageElement);
  }
  const safeTargetPage = Math.min(pdf.numPages, Math.max(1, Math.round(targetPage)));
  const target = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${safeTargetPage}"]`,
  );
  stage.scrollTo({ top: target ? Math.max(0, target.offsetTop - 16) : 0 });
}

async function openPdfData(
  data: Uint8Array,
  name: string,
  sourceUrl?: string,
  initialPage = 1,
): Promise<void> {
  setLoading('正在解析 PDF…');
  showNotice(undefined);
  emptyState.hidden = true;
  viewer.hidden = true;
  clearDocument();
  try {
    const task = getDocument({ data, isEvalSupported: false });
    const nextDocument = await task.promise;
    await pdfDocument?.destroy();
    pdfDocument = nextDocument;
    scanHintShownForDocument = false;
    currentSourceUrl = sourceUrl ?? location.href;
    currentSourceLabel = sourceUrl ? undefined : name;
    documentName.textContent = name;
    document.title = `${name} - Pi PDF`;
    pageCount.hidden = false;
    pageCount.textContent = `${nextDocument.numPages} 页`;
    setDocumentControls(true);
    setLoading('正在准备页面…');
    await buildPages(nextDocument, initialPage);
  } catch (error) {
    emptyState.hidden = false;
    viewer.hidden = true;
    pageCount.hidden = true;
    setDocumentControls(false);
    showNotice(error instanceof Error ? `无法打开 PDF：${error.message}` : '无法打开这个 PDF。');
  } finally {
    setLoading(undefined);
  }
}

async function openLocalFile(file: File): Promise<void> {
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showNotice('请选择 PDF 文件。');
    return;
  }
  await openPdfData(new Uint8Array(await file.arrayBuffer()), file.name);
}

function pageRegionBounds(selection: ActiveRegionSelection): RegionRect {
  const pageBounds = selection.pageElement.getBoundingClientRect();
  return normalizeRegion({ x: 0, y: 0 }, { x: pageBounds.width, y: pageBounds.height }, {
    left: 0,
    top: 0,
    width: pageBounds.width,
    height: pageBounds.height,
  });
}

function positionRegionConfirmation(selection: ActiveRegionSelection): void {
  const confirmation = selection.confirm;
  if (!confirmation) return;
  const pageBounds = selection.pageElement.getBoundingClientRect();
  const popupWidth = confirmation.offsetWidth;
  const popupHeight = confirmation.offsetHeight;
  const left = Math.min(
    Math.max(4, selection.region.right - popupWidth),
    Math.max(4, pageBounds.width - popupWidth - 4),
  );
  const top = selection.region.bottom + popupHeight + 5 <= pageBounds.height
    ? selection.region.bottom + 5
    : Math.max(4, selection.region.top - popupHeight - 5);
  confirmation.style.left = `${left}px`;
  confirmation.style.top = `${top}px`;
}

function renderRegionBox(selection: ActiveRegionSelection): void {
  selection.box.style.left = `${selection.region.left}px`;
  selection.box.style.top = `${selection.region.top}px`;
  selection.box.style.width = `${selection.region.width}px`;
  selection.box.style.height = `${selection.region.height}px`;
  positionRegionConfirmation(selection);
}

function updateRegionFromPointer(selection: ActiveRegionSelection, point: Point): void {
  const interaction = selection.interaction;
  if (!interaction) return;
  const bounds = pageRegionBounds(selection);
  if (interaction.kind === 'draw') {
    selection.region = normalizeRegion(interaction.start, point, bounds);
  } else if (interaction.kind === 'move') {
    selection.region = moveRegion(
      interaction.initialRegion,
      { x: point.x - interaction.start.x, y: point.y - interaction.start.y },
      bounds,
    );
  } else {
    selection.region = resizeRegion(
      interaction.initialRegion,
      interaction.handle,
      point,
      bounds,
    );
  }
  renderRegionBox(selection);
}

function pointWithinPage(event: PointerEvent, pageElement: HTMLElement): Point {
  const bounds = pageElement.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function createRegionConfirmation(selection: ActiveRegionSelection): void {
  selection.confirm?.remove();
  const confirmation = document.createElement('div');
  confirmation.className = 'region-confirm';
  confirmation.setAttribute('role', 'group');
  confirmation.setAttribute('aria-label', '框选翻译确认');
  const note = document.createElement('span');
  note.className = 'region-confirm-note';
  note.textContent = '仅此区域会发送至视觉 API';
  const actions = document.createElement('div');
  actions.className = 'region-confirm-actions';
  const confirm = document.createElement('button');
  confirm.className = 'confirm';
  confirm.type = 'button';
  confirm.textContent = '发送并翻译';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  actions.append(confirm, cancel);
  confirmation.append(note, actions);
  selection.pageElement.append(confirmation);
  selection.confirm = confirmation;
  selection.box.classList.add('adjustable');
  selection.box.title = '拖动选框可移动，拖动角点可调整大小';
  for (const handle of ['nw', 'ne', 'se', 'sw'] satisfies RegionResizeHandle[]) {
    const grip = document.createElement('span');
    grip.className = `region-resize-handle ${handle}`;
    grip.dataset.regionHandle = handle;
    grip.ariaHidden = 'true';
    selection.box.append(grip);
  }
  positionRegionConfirmation(selection);
  cancel.addEventListener('click', () => clearRegionSelection());
  confirm.addEventListener('click', () => {
    confirm.disabled = true;
    cancel.disabled = true;
    showNotice('正在准备框选图像…');
    void (async () => {
      const currentBounds = selection.pageElement.getBoundingClientRect();
      const capture = await captureCanvasRegion(
        selection.canvas,
        { left: 0, top: 0, width: currentBounds.width, height: currentBounds.height },
        selection.region,
      );
      const rect = {
        left: currentBounds.left + selection.region.left,
        top: currentBounds.top + selection.region.top,
        right: currentBounds.left + selection.region.right,
        bottom: currentBounds.top + selection.region.bottom,
      };
      const pageNumber = selection.pageElement.dataset.pageNumber ?? '';
      setRegionMode(false);
      showNotice(undefined);
      const controller = await selectionTranslator;
      await controller.translateImageRegion({
        imageDataUrl: capture.dataUrl,
        imageWidth: capture.width,
        imageHeight: capture.height,
        rect,
        pageUrl: currentSourceUrl,
        sourceLabel: `${currentSourceLabel ?? documentName.textContent ?? 'PDF'}${pageNumber ? ` · 第 ${pageNumber} 页` : ''}`,
      });
    })().catch((error: unknown) => {
      confirm.disabled = false;
      cancel.disabled = false;
      showNotice(error instanceof Error ? error.message : '无法处理框选区域，请重新框选。');
    });
  });
}

viewer.addEventListener('pointerdown', (event) => {
  if (!regionMode || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.region-confirm')) return;
  const existing = activeRegion;
  if (existing && target.closest('.region-selection-box') === existing.box) {
    const handleElement = target.closest<HTMLElement>('[data-region-handle]');
    const handle = handleElement?.dataset.regionHandle as RegionResizeHandle | undefined;
    const point = pointWithinPage(event, existing.pageElement);
    existing.interaction = handle
      ? { kind: 'resize', pointerId: event.pointerId, handle, initialRegion: existing.region }
      : {
        kind: 'move',
        pointerId: event.pointerId,
        start: point,
        initialRegion: existing.region,
      };
    existing.pageElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const pageElement = target.closest<HTMLElement>('.pdf-page[data-rendered="ready"]');
  const canvas = pageElement?.querySelector<HTMLCanvasElement>('canvas');
  if (!pageElement || !canvas) return;
  clearRegionSelection();
  const start = pointWithinPage(event, pageElement);
  const box = document.createElement('div');
  box.className = 'region-selection-box';
  pageElement.append(box);
  const region = normalizeRegion(start, start, {
    left: 0,
    top: 0,
    width: pageElement.clientWidth,
    height: pageElement.clientHeight,
  });
  activeRegion = {
    pageElement,
    canvas,
    region,
    box,
    interaction: { kind: 'draw', pointerId: event.pointerId, start },
  };
  pageElement.setPointerCapture(event.pointerId);
  event.preventDefault();
});

viewer.addEventListener('pointermove', (event) => {
  const selection = activeRegion;
  if (!selection || selection.interaction?.pointerId !== event.pointerId) return;
  updateRegionFromPointer(selection, pointWithinPage(event, selection.pageElement));
  event.preventDefault();
});

viewer.addEventListener('pointerup', (event) => {
  const selection = activeRegion;
  const interaction = selection?.interaction;
  if (!selection || !interaction || interaction.pointerId !== event.pointerId) return;
  updateRegionFromPointer(selection, pointWithinPage(event, selection.pageElement));
  if (selection.pageElement.hasPointerCapture(event.pointerId)) {
    selection.pageElement.releasePointerCapture(event.pointerId);
  }
  selection.interaction = undefined;
  if (interaction.kind === 'draw' && !isUsableRegion(selection.region)) {
    clearRegionSelection();
    showNotice('框选范围太小，请拖动选择更大的文字或图片区域。');
    return;
  }
  if (interaction.kind === 'draw') createRegionConfirmation(selection);
  else positionRegionConfirmation(selection);
  event.preventDefault();
});

viewer.addEventListener('pointercancel', (event) => {
  const selection = activeRegion;
  const interaction = selection?.interaction;
  if (!selection || !interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.kind === 'draw') {
    clearRegionSelection();
    showNotice(undefined);
    return;
  }
  selection.region = interaction.initialRegion;
  selection.interaction = undefined;
  renderRegionBox(selection);
});

regionTranslate.addEventListener('click', () => setRegionMode(!regionMode));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !regionMode) return;
  setRegionMode(false);
  showNotice(undefined);
});

function visiblePageNumber(): number {
  const pages = [...viewer.querySelectorAll<HTMLElement>('.pdf-page')];
  if (pages.length === 0) return 1;
  const anchor = stage.getBoundingClientRect().top + 12;
  let closestPage = 1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    if (rect.top <= anchor && rect.bottom >= anchor) {
      return Number(page.dataset.pageNumber) || closestPage;
    }
    const distance = Math.min(Math.abs(rect.top - anchor), Math.abs(rect.bottom - anchor));
    if (distance >= closestDistance) continue;
    closestDistance = distance;
    closestPage = Number(page.dataset.pageNumber) || closestPage;
  }
  return closestPage;
}

async function openPdfSource(source: URL, initialPage = 1): Promise<void> {
  setLoading(source.protocol === 'file:' ? '正在读取本地 PDF…' : '正在读取在线 PDF…');
  emptyState.hidden = true;
  try {
    const response = await fetch(
      source.href,
      source.protocol === 'file:' ? undefined : { credentials: 'include' },
    );
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      throw new Error('这个地址返回的不是 PDF 文件');
    }
    await openPdfData(
      new Uint8Array(await response.arrayBuffer()),
      pdfFilename(source.href),
      source.href,
      initialPage,
    );
  } catch (error) {
    emptyState.hidden = false;
    showNotice(
      `${error instanceof Error ? error.message : '在线 PDF 读取失败'}。你仍可点击“打开 PDF”选择已下载的本地文件。`,
    );
  } finally {
    setLoading(undefined);
  }
}

function chooseLocalPdf(): void {
  fileInput.click();
}

chooseFile.addEventListener('click', chooseLocalPdf);
emptyOpen.addEventListener('click', chooseLocalPdf);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openLocalFile(file);
  fileInput.value = '';
});

zoomOut.addEventListener('click', () => {
  if (!pdfDocument || zoomIndex === 0) return;
  const pageNumber = visiblePageNumber();
  zoomIndex -= 1;
  setDocumentControls(true);
  void buildPages(pdfDocument, pageNumber);
});
zoomIn.addEventListener('click', () => {
  if (!pdfDocument || zoomIndex === ZOOM_LEVELS.length - 1) return;
  const pageNumber = visiblePageNumber();
  zoomIndex += 1;
  setDocumentControls(true);
  void buildPages(pdfDocument, pageNumber);
});
openSettings.addEventListener('click', () => {
  void browser.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' } satisfies RuntimeMessage);
});

const selectionTranslator = startSelectionTranslator(
  { onInvalidated: (callback) => invalidationCallbacks.push(callback) },
  'pdf',
  {
    pageUrl: () => currentSourceUrl,
    sourceLabel: () => currentSourceLabel,
    allowSitePause: false,
  },
);

window.addEventListener('beforeunload', () => {
  clearDocument();
  void pdfDocument?.destroy();
  for (const callback of invalidationCallbacks) callback();
});

setDocumentControls(false);
const initialSource = parsePdfSourceUrl(
  new URLSearchParams(location.search).get('url') ?? undefined,
);
const initialPage = pdfInitialPage(location.href) ?? pdfInitialPage(initialSource?.href) ?? 1;
if (initialSource) void openPdfSource(initialSource, initialPage);
