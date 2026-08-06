import type {
  PdfSidePanelSession,
  RuntimeMessage,
  RuntimeResponse,
} from '../../core/messaging/messages';
import { translationErrorMessage } from '../../core/messaging/user-facing-error';
import {
  edgePdfSourceUrl,
  parsePdfSourceUrl,
  pdfInitialPage,
  pdfPermissionPattern,
} from '../../core/pdf/source';
import {
  createLatestRequestGate,
  isSamePdfSidePanelSession,
} from '../../core/pdf/sidepanel-session';
import { getSettings } from '../../core/settings/repository';
import { containsRenderableLatex } from '../../core/translation/latex-display';
import { normalizeVisionLatexText } from '../../core/translation/formula-output-validation';
import { renderTranslationContent } from '../../ui/translation-content';

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
const pdfAccessAlert = element<HTMLElement>('pdf-access-alert');
const pdfAccessTitle = element<HTMLElement>('pdf-access-title');
const pdfAccessMessage = element<HTMLElement>('pdf-access-message');
const pdfAccessSteps = element<HTMLOListElement>('pdf-access-steps');
const openExtensionManagement = element<HTMLButtonElement>('open-extension-management');
const retryPdfAccess = element<HTMLButtonElement>('retry-pdf-access');

let activeTabId: number | undefined;
let activeWindowId: number | undefined;
let currentSession: PdfSidePanelSession | undefined;
let autoRenderLatex = true;
let formulaRenderOverride: boolean | undefined;
const sessionLoadGate = createLatestRequestGate();

function renderTranslationText(text: string, renderLatex: boolean): void {
  renderTranslationContent(translationText, text, renderLatex);
}

function presentationText(session: PdfSidePanelSession, text: string): string {
  return session.result?.sourceKind === 'image-region' || session.providerContext?.role === 'vision'
    ? normalizeVisionLatexText(text)
    : text;
}

function providerErrorContext(session: PdfSidePanelSession): string | undefined {
  const context = session.providerContext;
  const providerError = session.error && [
    'NO_API_KEY',
    'API_PERMISSION_REQUIRED',
    'AUTH_FAILED',
    'PAYMENT_REQUIRED',
    'MODEL_NOT_FOUND',
    'RATE_LIMITED',
    'REQUEST_TIMEOUT',
    'NETWORK_ERROR',
    'PROVIDER_ERROR',
    'EMPTY_RESPONSE',
    'INVALID_RESPONSE',
    'LATEX_VALIDATION_FAILED',
  ].includes(session.error.code);
  if (!context || !providerError) return undefined;
  const role = context.role === 'vision' ? 'PDF 公式 API' : '文字 API';
  return `本次使用：${role}「${context.profileName}」 · ${context.model}`;
}

function setStatus(message: string): void {
  status.textContent = message;
  if (!message) return;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 2200);
}

function hidePdfAccessAlert(): void {
  pdfAccessAlert.hidden = true;
}

function showPdfAccessAlert(title: string, message: string, steps: string[]): void {
  pdfAccessTitle.textContent = title;
  pdfAccessMessage.textContent = message;
  pdfAccessSteps.replaceChildren(...steps.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  pdfAccessAlert.hidden = false;
}

function showHiddenPdfSourceAlert(): void {
  showPdfAccessAlert(
    'Edge 没有提供原 PDF 地址',
    '如果这是本地 PDF，通常是 Pi Translator 尚未获准访问文件 URL。',
    [
      '打开 Edge 扩展管理页并进入 Pi Translator 详情。',
      '开启“允许访问文件 URL”，回到原 PDF 后重新检测。',
    ],
  );
}

async function requestPdfSourceAccess(sourceUrl: string): Promise<boolean> {
  const source = parsePdfSourceUrl(sourceUrl);
  if (!source) return false;
  if (
    source.protocol === 'file:' &&
    !(await browser.extension.isAllowedFileSchemeAccess())
  ) {
    showPdfAccessAlert(
      '还差一步：允许读取本地 PDF',
      'Edge 默认不允许扩展读取 file:// 文件，这不是 API 或 PDF 损坏。',
      [
        '打开 Edge 扩展管理页并进入 Pi Translator 详情。',
        '开启“允许访问文件 URL”，回到原 PDF 后重新检测。',
      ],
    );
    return false;
  }
  const origin = pdfPermissionPattern(sourceUrl);
  if (!origin) return true;
  let granted = false;
  try {
    // Preserve Edge's transient user activation: request directly from the
    // click path instead of awaiting a separate contains() call first.
    granted = await browser.permissions.request({ origins: [origin] });
  } catch {
    granted = false;
  }
  if (!granted) {
    showPdfAccessAlert(
      '需要当前 PDF 所在站点的读取权限',
      `Pi PDF 只会申请 ${source.protocol === 'file:' ? '本地文件' : source.origin}，不会因此读取其他网站。`,
      [
        '点击“重新检测”，并在 Edge 的权限提示中选择允许。',
        '授权后再次点击“用 Pi 打开”。',
      ],
    );
    return false;
  }
  hidePdfAccessAlert();
  return true;
}

async function recoverActivePdfSource(): Promise<string | undefined> {
  const session = activeSession();
  if (!session) return undefined;
  const tab = await browser.tabs.get(session.tabId);
  const sourceUrl = edgePdfSourceUrl({ ...(tab.url ? { tabUrl: tab.url } : {}) });
  if (!sourceUrl) return undefined;
  currentSession = {
    ...session,
    pageUrl: sourceUrl,
    sourceLabel: parsePdfSourceUrl(sourceUrl)?.pathname.split('/').at(-1) || session.sourceLabel,
  };
  render(currentSession);
  return sourceUrl;
}

function render(session: PdfSidePanelSession | null | undefined): void {
  if (session?.requestId !== currentSession?.requestId) formulaRenderOverride = undefined;
  currentSession = session ?? undefined;
  emptyState.hidden = Boolean(session);
  sessionSection.hidden = !session;
  if (!session) return;

  sourceLabel.textContent = session.sourceLabel;
  sourceLabel.title = session.sourceLabel;
  sourceText.textContent = presentationText(session, session.sourceText);
  const pdfSource = parsePdfSourceUrl(session.pageUrl);
  const pageNumber = session.pageNumber ?? pdfInitialPage(session.pageUrl);
  readerHintText.textContent = pdfSource
    ? pageNumber
      ? `将直接继承当前 PDF，并定位到第 ${pageNumber} 页。`
      : '将直接继承当前 PDF，并在打开后收起此侧边栏。'
    : 'Edge 没有提供原 PDF 地址；若为本地文件，请先开启文件 URL 权限。';
  openPiReader.textContent = pdfSource ? '用 Pi 打开' : '解决 PDF 读取权限';
  if (!pdfSource) showHiddenPdfSourceAlert();
  else hidePdfAccessAlert();

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
    const message =
      exactPdfMessage && session.error.message
        ? session.error.message
        : translationErrorMessage(session.error.code, session.error.message);
    const providerContext = providerErrorContext(session);
    translationText.textContent = providerContext
      ? `${message}\n\n${providerContext}`
      : message;
    return;
  }

  translationState.textContent = session.result?.cached
    ? '会话缓存'
    : session.result?.latencyMs
      ? `${(session.result.latencyMs / 1000).toFixed(1)} 秒`
      : '已完成';
  const translatedText = presentationText(
    session,
    session.result?.translatedText ?? session.partialText ?? '',
  );
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
  const session = currentSession;
  const text = session?.result?.translatedText;
  if (!session || !text) return;
  void navigator.clipboard.writeText(presentationText(session, text))
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
    if (!sourceUrl) {
      showHiddenPdfSourceAlert();
      return;
    }
    if (!await requestPdfSourceAccess(sourceUrl)) return;
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
  })().catch((error: unknown) => setStatus(
    error instanceof Error ? error.message : '无法打开 Pi PDF 阅读器',
  ));
});

openExtensionManagement.addEventListener('click', () => {
  void browser.tabs.create({
    url: `edge://extensions/?id=${browser.runtime.id}`,
    active: true,
  }).catch(() => setStatus('请手动打开 edge://extensions 并进入 Pi Translator 详情。'));
});

retryPdfAccess.addEventListener('click', () => {
  void (async () => {
    const session = activeSession();
    if (!session) return;
    const sourceUrl = parsePdfSourceUrl(session.pageUrl)?.href ?? await recoverActivePdfSource();
    if (!sourceUrl) {
      showHiddenPdfSourceAlert();
      return;
    }
    if (await requestPdfSourceAccess(sourceUrl)) {
      setStatus('PDF 读取权限已就绪');
    }
  })().catch(() => showHiddenPdfSourceAlert());
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
