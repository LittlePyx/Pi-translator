import type {
  LatexMathMlResponse,
  PdfSidePanelSession,
  RuntimeMessage,
  RuntimeResponse,
} from '../../core/messaging/messages';
import { translationErrorMessage } from '../../core/messaging/user-facing-error';
import {
  parsePdfSourceUrl,
  pdfInitialPage,
  pdfPermissionPattern,
} from '../../core/pdf/source';
import {
  createLatestRequestGate,
  isSamePdfSidePanelSession,
} from '../../core/pdf/sidepanel-session';
import { getSettings } from '../../core/settings/repository';
import {
  containsRenderableLatex,
  latexRenderParts,
  splitLatexDisplaySegments,
} from '../../core/translation/latex-display';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing side panel element #${id}`);
  return value as T;
}

const emptyState = element<HTMLElement>('empty-state');
const sessionSection = element<HTMLElement>('session');
const sourceLabel = element<HTMLElement>('source-label');
const sourceText = element<HTMLElement>('source-text');
const translationState = element<HTMLElement>('translation-state');
const translationText = element<HTMLElement>('translation-text');
const formulaView = element<HTMLButtonElement>('formula-view');
const progressTrack = element<HTMLElement>('progress-track');
const errorActions = element<HTMLElement>('error-actions');
const retry = element<HTMLButtonElement>('retry');
const copy = element<HTMLButtonElement>('copy');
const status = element<HTMLElement>('status');
const openPiReader = element<HTMLButtonElement>('open-pi-reader');
const readerHintText = element<HTMLElement>('reader-hint-text');
const openSettings = element<HTMLButtonElement>('open-settings');
const errorSettings = element<HTMLButtonElement>('error-settings');

let activeTabId: number | undefined;
let activeWindowId: number | undefined;
let currentSession: PdfSidePanelSession | undefined;
let autoRenderLatex = true;
let formulaRenderOverride: boolean | undefined;
const sessionLoadGate = createLatestRequestGate();

function renderTranslationText(text: string, renderLatex: boolean): void {
  translationText.replaceChildren();
  if (!renderLatex) {
    translationText.textContent = text;
    return;
  }
  for (const segment of splitLatexDisplaySegments(text)) {
    if (segment.kind === 'text') {
      translationText.append(document.createTextNode(segment.text));
      continue;
    }
    const math = document.createElement(segment.displayMode ? 'div' : 'span');
    math.className = `pi-math ${segment.displayMode ? 'pi-math-display' : 'pi-math-inline'}`;
    math.textContent = segment.raw;
    translationText.append(math);
    const renderParts = latexRenderParts(segment.tex, segment.displayMode);
    void browser.runtime.sendMessage({
      type: 'RENDER_LATEX_MATHML',
      payload: { tex: renderParts.tex, displayMode: segment.displayMode },
    } satisfies RuntimeMessage).then((response: LatexMathMlResponse) => {
      if (response.ok && response.data.html && math.isConnected) {
        if (!renderParts.equationTag) {
          math.innerHTML = response.data.html;
          return;
        }
        const scroll = document.createElement('span');
        scroll.className = 'pi-math-scroll';
        scroll.innerHTML = response.data.html;
        const tag = document.createElement('span');
        tag.className = 'pi-equation-tag';
        tag.textContent = `(${renderParts.equationTag})`;
        math.classList.add('pi-math-numbered');
        math.replaceChildren(scroll, tag);
      }
    }).catch(() => undefined);
  }
}

function setStatus(message: string): void {
  status.textContent = message;
  if (!message) return;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 2200);
}

function render(session: PdfSidePanelSession | null | undefined): void {
  if (session?.requestId !== currentSession?.requestId) formulaRenderOverride = undefined;
  currentSession = session ?? undefined;
  emptyState.hidden = Boolean(session);
  sessionSection.hidden = !session;
  if (!session) return;

  sourceLabel.textContent = session.sourceLabel;
  sourceLabel.title = session.sourceLabel;
  sourceText.textContent = session.sourceText;
  const pdfSource = parsePdfSourceUrl(session.pageUrl);
  const pageNumber = session.pageNumber ?? pdfInitialPage(session.pageUrl);
  readerHintText.textContent = pdfSource
    ? pageNumber
      ? `将直接继承当前 PDF，并定位到第 ${pageNumber} 页。`
      : '将直接继承当前 PDF，并在打开后收起此侧边栏。'
    : '未识别到原 PDF 地址，可手动选择本地文件。';
  openPiReader.textContent = pdfSource ? '用 Pi 打开' : '打开 Pi 阅读器';

  const isTranslating = session.status === 'translating';
  progressTrack.hidden = !isTranslating;
  errorActions.hidden = session.status !== 'error';
  copy.disabled = session.status !== 'complete' || !session.result?.translatedText;
  translationText.classList.toggle('pending', isTranslating && !session.partialText);
  translationText.classList.toggle('error', session.status === 'error');

  if (isTranslating) {
    formulaView.hidden = true;
    const total = session.totalChunks ?? 1;
    const completed = session.completedChunks ?? 0;
    translationState.textContent = total > 1
      ? `翻译中 ${Math.min(completed + 1, total)}/${total}`
      : '正在流式接收';
    translationText.textContent = session.partialText || '正在连接翻译接口…';
    return;
  }

  if (session.status === 'error' && session.error) {
    formulaView.hidden = true;
    translationState.textContent = '翻译失败';
    const exactPdfMessage = [
      'EMPTY_SELECTION',
      'REQUEST_ABORTED',
      'UNSUPPORTED_PAGE',
    ].includes(session.error.code);
    translationText.textContent =
      exactPdfMessage && session.error.message
        ? session.error.message
        : translationErrorMessage(session.error.code, session.error.message);
    return;
  }

  translationState.textContent = session.result?.cached
    ? '会话缓存'
    : session.result?.latencyMs
      ? `${(session.result.latencyMs / 1000).toFixed(1)} 秒`
      : '已完成';
  const translatedText = session.result?.translatedText ?? session.partialText ?? '';
  const hasLatex = containsRenderableLatex(translatedText);
  const renderLatex = formulaRenderOverride ?? autoRenderLatex;
  formulaView.hidden = !hasLatex;
  formulaView.textContent = renderLatex ? '源码' : '公式';
  formulaView.title = renderLatex ? '显示可编辑的 LaTeX 源码' : '渲染译文中的 LaTeX 公式';
  formulaView.setAttribute('aria-pressed', String(renderLatex));
  renderTranslationText(translatedText, hasLatex && renderLatex);
}

async function loadActiveSession(
  activated?: { tabId: number; windowId: number },
): Promise<void> {
  const isCurrentLoad = sessionLoadGate.begin();
  let requestedTabId: number | undefined;
  if (activated) {
    requestedTabId = activated.tabId;
    activeWindowId = activated.windowId;
  } else {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!isCurrentLoad()) return;
    requestedTabId = tab?.id;
    activeWindowId = tab?.windowId;
  }
  activeTabId = requestedTabId;
  if (requestedTabId === undefined) {
    render(undefined);
    return;
  }
  const response = (await browser.runtime.sendMessage({
    type: 'GET_PDF_SIDE_PANEL_SESSION',
    payload: { tabId: requestedTabId },
  } satisfies RuntimeMessage)) as RuntimeResponse<{ session: PdfSidePanelSession | null }>;
  if (!isCurrentLoad() || activeTabId !== requestedTabId) return;
  if (!response.ok) {
    render(undefined);
    setStatus(translationErrorMessage(response.error.code, response.error.message));
    return;
  }
  render(response.data.session);
}

function activeSession(): PdfSidePanelSession | undefined {
  if (currentSession?.tabId === activeTabId) return currentSession;
  setStatus('当前标签页已切换，正在刷新 PDF 会话');
  void loadActiveSession().catch(() => setStatus('无法读取当前 PDF 会话'));
  return undefined;
}

function openFullSettings(): void {
  void browser.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' } satisfies RuntimeMessage);
}

openSettings.addEventListener('click', openFullSettings);
errorSettings.addEventListener('click', openFullSettings);
formulaView.addEventListener('click', () => {
  if (!currentSession?.result?.translatedText) return;
  const rendered = formulaRenderOverride ?? autoRenderLatex;
  formulaRenderOverride = !rendered;
  render(currentSession);
});

retry.addEventListener('click', () => {
  const session = activeSession();
  if (!session) return;
  void (async () => {
    const response = (await browser.runtime.sendMessage({
      type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: session.tabId },
    } satisfies RuntimeMessage)) as RuntimeResponse<{ started: true }>;
    if (currentSession?.tabId !== session.tabId || activeTabId !== session.tabId) return;
    if (!response.ok) {
      setStatus(translationErrorMessage(response.error.code, response.error.message));
    }
  })().catch(() => setStatus('无法重新开始 PDF 翻译'));
});

copy.addEventListener('click', () => {
  const text = currentSession?.result?.translatedText;
  if (!text) return;
  void navigator.clipboard.writeText(text)
    .then(() => setStatus('已复制'))
    .catch(() => setStatus('复制失败'));
});

openPiReader.addEventListener('click', () => {
  void (async () => {
    const session = activeSession();
    if (!session) return;
    const source = parsePdfSourceUrl(session.pageUrl);
    const sourceUrl = source?.href;
    const pageNumber = session.pageNumber ?? pdfInitialPage(sourceUrl);
    if (sourceUrl) {
      if (
        source?.protocol === 'file:' &&
        !(await browser.extension.isAllowedFileSchemeAccess())
      ) {
        setStatus('请先在扩展管理页开启“允许访问文件 URL”，再重新尝试');
        return;
      }
      const origin = pdfPermissionPattern(sourceUrl);
      if (origin) {
        const granted =
          (await browser.permissions.contains({ origins: [origin] })) ||
          (await browser.permissions.request({ origins: [origin] }));
        if (!granted) {
          setStatus('未授予当前 PDF 的读取权限');
          return;
        }
      }
    }
    if (
      activeTabId !== session.tabId ||
      !isSamePdfSidePanelSession(currentSession, session)
    ) {
      setStatus('标签页已切换，请在当前 PDF 中重新操作');
      return;
    }
    const response = (await browser.runtime.sendMessage({
      type: 'OPEN_PDF_VIEWER',
      ...(sourceUrl
        ? {
            payload: {
              url: sourceUrl,
              ...(pageNumber ? { page: pageNumber } : {}),
            },
          }
        : {}),
    } satisfies RuntimeMessage)) as RuntimeResponse<{ opened: true }> | undefined;
    if (!response?.ok) throw new Error(response?.error.message ?? 'PDF reader did not open.');
    if (!sourceUrl) setStatus('请在 Pi 阅读器中选择本地 PDF');
  })().catch((error: unknown) => setStatus(
    error instanceof Error ? error.message : '无法打开 Pi PDF 阅读器',
  ));
});

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const typed = message as RuntimeMessage;
  if (
    typed.type === 'PDF_SIDE_PANEL_SESSION_UPDATED' &&
    typed.payload.tabId === activeTabId
  ) {
    render(typed.payload);
  }
});

browser.tabs.onActivated.addListener((activated) => {
  if (activeWindowId !== undefined && activated.windowId !== activeWindowId) return;
  sessionLoadGate.invalidate();
  activeTabId = activated.tabId;
  render(undefined);
  void loadActiveSession(activated).catch(() => setStatus('无法读取当前 PDF 会话'));
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.extensionSettings) return;
  void getSettings().then((settings) => {
    autoRenderLatex = settings.autoRenderLatex;
    formulaRenderOverride = undefined;
    render(currentSession);
  });
});

void getSettings().then((settings) => {
  autoRenderLatex = settings.autoRenderLatex;
  render(currentSession);
});
void loadActiveSession().catch(() => {
  render(undefined);
  setStatus('无法读取当前 PDF 会话，请重新加载扩展后重试');
});
