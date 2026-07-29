import type {
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
let currentSession: PdfSidePanelSession | undefined;

function setStatus(message: string): void {
  status.textContent = message;
  if (!message) return;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 2200);
}

function render(session: PdfSidePanelSession | null | undefined): void {
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
    const total = session.totalChunks ?? 1;
    const completed = session.completedChunks ?? 0;
    translationState.textContent = total > 1
      ? `翻译中 ${Math.min(completed + 1, total)}/${total}`
      : '正在流式接收';
    translationText.textContent = session.partialText || '正在连接翻译接口…';
    return;
  }

  if (session.status === 'error' && session.error) {
    translationState.textContent = '翻译失败';
    translationText.textContent =
      session.error.code === 'EMPTY_SELECTION' && session.error.message
        ? session.error.message
        : translationErrorMessage(session.error.code, session.error.message);
    return;
  }

  translationState.textContent = session.result?.cached
    ? '会话缓存'
    : session.result?.latencyMs
      ? `${(session.result.latencyMs / 1000).toFixed(1)} 秒`
      : '已完成';
  translationText.textContent = session.result?.translatedText ?? session.partialText ?? '';
}

async function loadActiveSession(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  if (activeTabId === undefined) {
    render(undefined);
    return;
  }
  const response = (await browser.runtime.sendMessage({
    type: 'GET_PDF_SIDE_PANEL_SESSION',
    payload: { tabId: activeTabId },
  } satisfies RuntimeMessage)) as RuntimeResponse<{ session: PdfSidePanelSession | null }>;
  render(response.ok ? response.data.session : undefined);
}

function openFullSettings(): void {
  void browser.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' } satisfies RuntimeMessage);
}

openSettings.addEventListener('click', openFullSettings);
errorSettings.addEventListener('click', openFullSettings);

retry.addEventListener('click', () => {
  if (activeTabId === undefined) return;
  void browser.runtime.sendMessage({
    type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION',
    payload: { tabId: activeTabId },
  } satisfies RuntimeMessage);
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
    const source = parsePdfSourceUrl(currentSession?.pageUrl);
    const sourceUrl = source?.href;
    const pageNumber = currentSession?.pageNumber ?? pdfInitialPage(sourceUrl);
    if (sourceUrl) {
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
      if (
        source?.protocol === 'file:' &&
        !(await browser.extension.isAllowedFileSchemeAccess())
      ) {
        setStatus('请先在扩展管理页开启“允许访问文件 URL”');
        return;
      }
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
  })().catch(() => setStatus('无法打开 Pi PDF 阅读器'));
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

browser.tabs.onActivated.addListener(() => {
  void loadActiveSession();
});

void loadActiveSession().catch(() => render(undefined));
