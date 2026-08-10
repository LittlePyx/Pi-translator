import type {
  OpenOptionsPageResponse,
  PdfSidePanelSession,
  RuntimeMessage,
  RuntimeResponse,
  SettingsRecoveryRequest,
  TranslationSessionResult,
} from '../../core/messaging/messages';
import type {
  TranslationCorrectionTermInput,
  TranslationMemoryScope,
} from '../../core/translation/types';
import {
  translationCorrectionErrorMessage,
  translationErrorMessage,
  translationErrorRecovery,
  type SettingsFocus,
  type TranslationProviderRole,
} from '../../core/messaging/user-facing-error';
import {
  edgePdfSourceUrl,
  isEdgeNativePdfContext,
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
import {
  renderTranslationContent,
  type TranslationRenderPerformance,
} from '../../ui/translation-content';
import {
  TranslationProgressFeedbackController,
  type TranslationProgressFeedback,
  type TranslationProgressIdentity,
  type TranslationProgressStage,
} from '../../ui/translation-progress-feedback';
import { normalizeLatexForClipboard } from '../../ui/latex-copy';
import { translationCompletionStatus } from '../../ui/translation-timing';
import {
  applyManualCorrection,
  createManualCorrectionDraft,
  createManualCorrectionSession,
  ManualCorrectionError,
  type ManualCorrectionEdit,
} from '../../core/translation/manual-correction';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing side panel element #${id}`);
  return value as T;
}

const emptyState = element<HTMLElement>('empty-state');
const emptyTitle = element<HTMLElement>('empty-title');
const emptyDescription = element<HTMLElement>('empty-description');
const emptyAction = element<HTMLButtonElement>('empty-action');
const emptyStatus = element<HTMLElement>('empty-status');
const sessionSection = element<HTMLElement>('session');
const sourceLabel = element<HTMLElement>('source-label');
const sourceText = element<HTMLElement>('source-text');
const sourceToggle = element<HTMLButtonElement>('source-toggle');
const translationState = element<HTMLElement>('translation-state');
const stopTranslation = element<HTMLButtonElement>('stop-translation');
const translationText = element<HTMLElement>('translation-text');
const errorMessage = element<HTMLElement>('error-message');
const formulaView = element<HTMLButtonElement>('formula-view');
const progressTrack = element<HTMLElement>('progress-track');
const errorActions = element<HTMLElement>('error-actions');
const retry = element<HTMLButtonElement>('retry');
const copy = element<HTMLButtonElement>('copy');
const copyFeedback = element<HTMLElement>('copy-feedback');
const correct = element<HTMLButtonElement>('correct');
const correctionUndo = element<HTMLElement>('correction-undo');
const undoCorrection = element<HTMLButtonElement>('undo-correction');
const status = element<HTMLElement>('status');
const sessionActions = element<HTMLElement>('session-actions');
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
type SidePanelEmptyContext =
  | { kind: 'loading' }
  | { kind: 'pdf'; sourceUrl?: string; pageNumber?: number }
  | { kind: 'other' };
let emptyContext: SidePanelEmptyContext = { kind: 'loading' };
let emptyContextRevision = 0;
let autoRenderLatex = true;
let formulaRenderOverride: boolean | undefined;
let retryFocusPending = false;
let retryStatusFocusPending = false;
let retryFocusTabId: number | undefined;
let stopPendingRequestId: string | undefined;
let copyResetTimer: number | undefined;
let sourceExpanded = false;
let sourceCanExpand = false;
let sourceLayoutFrame: number | undefined;
const sessionLoadGate = createLatestRequestGate();
let activeProgressIdentity: TranslationProgressIdentity | undefined;
let activeProgressStage: TranslationProgressStage | undefined;
let activeProgressFeedback: TranslationProgressFeedback | undefined;
let translationRenderRevision = 0;

function emptyContextForTabUrl(tabUrl: string | undefined): SidePanelEmptyContext {
  if (!isEdgeNativePdfContext({ ...(tabUrl ? { tabUrl } : {}) })) {
    return { kind: 'other' };
  }
  const sourceUrl = edgePdfSourceUrl({ ...(tabUrl ? { tabUrl } : {}) });
  const pageNumber = pdfInitialPage(tabUrl) ?? pdfInitialPage(sourceUrl);
  return {
    kind: 'pdf',
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(pageNumber ? { pageNumber } : {}),
  };
}

async function resolveEmptyContext(
  tabId: number | undefined,
  tabUrl: string | undefined,
): Promise<SidePanelEmptyContext> {
  const context = emptyContextForTabUrl(tabUrl);
  if (context.kind === 'pdf' || tabUrl || tabId === undefined) return context;
  const options = await browser.sidePanel.getOptions({ tabId }).catch(() => undefined);
  return options?.enabled ? { kind: 'pdf' } : context;
}

function showEmptyContext(context: SidePanelEmptyContext): void {
  emptyContext = context;
  emptyContextRevision += 1;
  emptyState.dataset.context = context.kind;
  emptyState.toggleAttribute('aria-busy', context.kind === 'loading');
  emptyAction.disabled = false;
  emptyAction.removeAttribute('aria-busy');
  emptyStatus.textContent = '';
  emptyStatus.setAttribute('role', 'status');
  emptyStatus.setAttribute('aria-live', 'polite');
  if (context.kind === 'loading') {
    emptyTitle.textContent = '正在检查当前页面…';
    emptyDescription.textContent = '确认当前标签页是否可以开始 PDF 翻译。';
    emptyAction.hidden = true;
    return;
  }
  emptyAction.hidden = false;
  if (context.kind === 'pdf') {
    emptyTitle.textContent = '当前 PDF 已就绪';
    emptyDescription.textContent = '选择文字后右键翻译；需要浮动按钮或更顺畅的跨行选择时，可改用 Pi PDF。';
    emptyAction.textContent = context.sourceUrl ? '用 Pi 打开当前 PDF' : '打开 Pi PDF 阅读器';
    return;
  }
  emptyTitle.textContent = '当前没有可翻译的 PDF';
  emptyDescription.textContent = '切换到一份 PDF 后选择文字，或直接用 Pi PDF 打开本地文件。';
  emptyAction.textContent = '打开 Pi PDF 阅读器';
}

function setEmptyStatus(message: string, error = false): void {
  emptyStatus.setAttribute('role', error ? 'alert' : 'status');
  emptyStatus.setAttribute('aria-live', error ? 'assertive' : 'polite');
  emptyStatus.textContent = message;
}

async function requestEmptyPdfSourceAccess(sourceUrl: string): Promise<boolean> {
  const source = parsePdfSourceUrl(sourceUrl);
  if (!source) return false;
  if (
    source.protocol === 'file:' &&
    !(await browser.extension.isAllowedFileSchemeAccess())
  ) {
    setEmptyStatus('请先在 Edge 扩展详情中开启“允许访问文件 URL”。', true);
    return false;
  }
  const origin = pdfPermissionPattern(sourceUrl);
  if (!origin) return true;
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [origin] });
  } catch {
    granted = false;
  }
  if (!granted) {
    setEmptyStatus('未获得当前 PDF 来源的读取权限，文件尚未打开。', true);
    return false;
  }
  return true;
}

function progressIdentity(session: PdfSidePanelSession): TranslationProgressIdentity {
  return {
    requestId: session.requestId,
    revisionKey: session.startedAt,
  };
}

function isSameProgressIdentity(
  left: TranslationProgressIdentity | undefined,
  right: TranslationProgressIdentity,
): boolean {
  return left?.requestId === right.requestId && left.revisionKey === right.revisionKey;
}

function isCurrentProgressFeedback(feedback: TranslationProgressFeedback): boolean {
  const session = currentSession;
  if (!session) return false;
  return session.requestId === feedback.requestId && session.startedAt === feedback.revisionKey;
}

const progressFeedback = new TranslationProgressFeedbackController((feedback) => {
  if (!isCurrentProgressFeedback(feedback)) return;
  const session = currentSession;
  if (
    session?.status !== 'translating'
    && !(session?.status === 'complete' && feedback.stage === 'rendering')
  ) {
    return;
  }
  activeProgressFeedback = feedback;
  translationState.textContent = feedback.message;
});

function finishProgress(): void {
  if (activeProgressIdentity) progressFeedback.finish(activeProgressIdentity);
  activeProgressIdentity = undefined;
  activeProgressStage = undefined;
  activeProgressFeedback = undefined;
}

function baseTranslationProgressText(session: PdfSidePanelSession): string {
  const total = session.totalChunks ?? 1;
  const completed = session.completedChunks ?? 0;
  return total > 1
    ? `翻译中 ${Math.min(completed + 1, total)}/${total}`
    : '翻译中';
}

function syncTranslationProgress(session: PdfSidePanelSession): void {
  const identity = progressIdentity(session);
  const stage = session.progressStage ?? 'provider';
  const hasPartial = Boolean(session.partialText);
  const identityChanged = !isSameProgressIdentity(activeProgressIdentity, identity);
  const stageChanged = activeProgressStage !== stage;

  if (identityChanged) {
    finishProgress();
    activeProgressIdentity = identity;
    activeProgressStage = stage;
    translationState.textContent = baseTranslationProgressText(session);
    progressFeedback.begin(identity, stage, { hasPartial });
    return;
  }

  if (stageChanged) {
    activeProgressStage = stage;
    activeProgressFeedback = undefined;
    translationState.textContent = baseTranslationProgressText(session);
    progressFeedback.enterStage(identity, stage, { hasPartial });
    return;
  }

  if (activeProgressFeedback?.stage === stage) {
    translationState.textContent = activeProgressFeedback.message;
  } else {
    translationState.textContent = baseTranslationProgressText(session);
  }
  if (stage === 'provider' && hasPartial) progressFeedback.providerPartial(identity);
}

function recoveryRole(session: PdfSidePanelSession): TranslationProviderRole {
  if (session.providerContext?.role) return session.providerContext.role;
  return [
    'VISION_NOT_CONFIGURED',
    'VISION_MODEL_UNSUPPORTED',
    'OCR_NOT_SUPPORTED',
    'OCR_INVALID_RESPONSE',
    'IMAGE_REGION_INVALID',
  ].includes(session.error?.code ?? '')
    ? 'vision'
    : 'text';
}

function settingsRecoveryRequest(
  session: PdfSidePanelSession,
): SettingsRecoveryRequest | undefined {
  if (!session.error) return undefined;
  const recovery = translationErrorRecovery(
    session.error.code,
    session.error.retryable,
    recoveryRole(session),
  );
  if (!recovery.settingsFocus) return undefined;
  return {
    role: recoveryRole(session),
    errorCode: session.error.code,
    failedRequestId: session.requestId,
    hadPartialOutput: Boolean(session.partialText?.trim()),
    autoResume: recovery.autoResumeAfterSettings === true,
    nativePdfTabId: session.tabId,
  };
}

const recordedRenderPerformance = new Set<string>();

function recordResultRenderPerformance(
  requestId: string,
  metrics: TranslationRenderPerformance,
): void {
  if (recordedRenderPerformance.has(requestId)) return;
  recordedRenderPerformance.add(requestId);
  if (recordedRenderPerformance.size > 100) {
    const oldest = recordedRenderPerformance.values().next().value as string | undefined;
    if (oldest) recordedRenderPerformance.delete(oldest);
  }
  void browser.runtime.sendMessage({
    type: 'RECORD_LOCAL_PERFORMANCE',
    payload: {
      operation: 'render-result',
      timings: {
        totalMs: metrics.textRenderMs + metrics.mathRenderMs,
        textRenderMs: metrics.textRenderMs,
        mathRenderMs: metrics.mathRenderMs,
      },
      ...(metrics.mathRenderFailed ? { errorCode: 'INVALID_RESPONSE' as const } : {}),
    },
  } satisfies RuntimeMessage).catch(() => undefined);
}

function renderTranslationText(
  text: string,
  renderLatex: boolean,
  requestId: string,
): Promise<TranslationRenderPerformance> {
  return renderTranslationContent(
    translationText,
    text,
    renderLatex,
    (metrics) => recordResultRenderPerformance(requestId, metrics),
  );
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
    'API_ENDPOINT_INVALID',
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

function syncSessionActions(): void {
  const hasAction = !copy.hidden || !correct.hidden || !correctionUndo.hidden;
  sessionActions.hidden = !hasAction && !status.textContent;
}

function setStatus(message: string, timeoutMs = 2_200): void {
  status.textContent = message;
  syncSessionActions();
  if (!message || timeoutMs <= 0) return;
  window.setTimeout(() => {
    if (status.textContent !== message) return;
    status.textContent = '';
    syncSessionActions();
  }, timeoutMs);
}

function copyActionLabel(session: PdfSidePanelSession): string {
  return session.status === 'error' && session.partialText?.trim()
    ? '复制部分译文'
    : '复制译文';
}

function clearCopyFeedback(): void {
  if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
  copyResetTimer = undefined;
  copy.removeAttribute('data-state');
  copyFeedback.textContent = '';
}

function showCopySuccess(session: PdfSidePanelSession): void {
  if (currentSession !== session) return;
  clearCopyFeedback();
  setStatus('');
  copy.dataset.state = 'success';
  copy.textContent = '已复制';
  window.requestAnimationFrame(() => {
    if (currentSession === session && copy.dataset.state === 'success') {
      copyFeedback.textContent = '译文已复制到剪贴板';
    }
  });
  copyResetTimer = window.setTimeout(() => {
    copyResetTimer = undefined;
    if (currentSession !== session || copy.dataset.state !== 'success') return;
    copy.removeAttribute('data-state');
    copy.textContent = copyActionLabel(session);
    copyFeedback.textContent = '';
  }, 1_800);
}

function syncSourceDisclosure(session: PdfSidePanelSession, renderRevision: number): void {
  if (sourceLayoutFrame !== undefined) window.cancelAnimationFrame(sourceLayoutFrame);
  sourceLayoutFrame = undefined;
  sourceText.classList.toggle('expanded', sourceExpanded);
  sourceToggle.textContent = sourceExpanded ? '收起' : '展开';
  sourceToggle.setAttribute('aria-expanded', String(sourceExpanded));
  sourceToggle.setAttribute('aria-label', sourceExpanded ? '收起原文' : '展开完整原文');
  sourceToggle.hidden = !sourceCanExpand;
  if (sourceExpanded) return;

  sourceLayoutFrame = window.requestAnimationFrame(() => {
    sourceLayoutFrame = undefined;
    if (
      renderRevision !== translationRenderRevision
      || !isSamePdfSidePanelSession(currentSession, session)
    ) return;
    sourceCanExpand = sourceText.scrollHeight > sourceText.clientHeight + 1;
    sourceToggle.hidden = !sourceCanExpand;
  });
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
  const sameSession = Boolean(session && isSamePdfSidePanelSession(currentSession, session));
  if (!sameSession) {
    formulaRenderOverride = undefined;
    sourceExpanded = false;
    sourceCanExpand = false;
  }
  if (sourceLayoutFrame !== undefined) window.cancelAnimationFrame(sourceLayoutFrame);
  sourceLayoutFrame = undefined;
  clearCopyFeedback();
  currentSession = session ?? undefined;
  const renderRevision = ++translationRenderRevision;
  emptyState.hidden = Boolean(session);
  sessionSection.hidden = !session;
  if (!session) {
    finishProgress();
    retryFocusPending = false;
    retryStatusFocusPending = false;
    retryFocusTabId = undefined;
    stopPendingRequestId = undefined;
    stopTranslation.hidden = true;
    errorMessage.hidden = true;
    errorMessage.textContent = '';
    correct.hidden = true;
    correctionUndo.hidden = true;
    copy.hidden = true;
    sessionActions.hidden = true;
    sourceToggle.hidden = true;
    sourceText.classList.remove('expanded');
    return;
  }
  if (retryFocusPending && retryFocusTabId !== session.tabId) {
    retryFocusPending = false;
    retryStatusFocusPending = false;
    retryFocusTabId = undefined;
  }

  sourceLabel.textContent = session.sourceLabel;
  sourceLabel.title = session.sourceLabel;
  sourceText.textContent = presentationText(session, session.sourceText);
  syncSourceDisclosure(session, renderRevision);
  const pdfSource = parsePdfSourceUrl(session.pageUrl);
  const pageNumber = session.pageNumber ?? pdfInitialPage(session.pageUrl);
  const needsVisionHint = session.providerContext?.role === 'vision';
  readerHintText.hidden = !needsVisionHint;
  readerHintText.textContent = needsVisionHint
    ? `Edge 原生阅读器未提供选区图像；本次只传递选中文字。复杂公式可用 Pi 打开后截图识别${pageNumber ? `，并定位到第 ${pageNumber} 页` : ''}。`
    : '';
  openPiReader.textContent = pdfSource ? '用 Pi 打开' : '解决 PDF 读取权限';
  if (!pdfSource) showHiddenPdfSourceAlert();
  else hidePdfAccessAlert();

  const isTranslating = session.status === 'translating';
  const explicitlyStopped = session.status === 'error' &&
    session.error?.code === 'REQUEST_ABORTED' &&
    !session.error.retryable;
  const stoppedFromControl = !isTranslating && stopPendingRequestId === session.requestId;
  if (!isTranslating || stopPendingRequestId !== session.requestId) {
    stopPendingRequestId = undefined;
  }
  const preservedPartial = session.status === 'error' ? session.partialText?.trim() : undefined;
  const copyableText = session.status === 'complete'
    ? session.result?.translatedText
    : preservedPartial;
  progressTrack.hidden = !isTranslating;
  stopTranslation.hidden = !isTranslating;
  stopTranslation.disabled = stopPendingRequestId === session.requestId;
  stopTranslation.textContent = stopTranslation.disabled ? '停止中' : '停止';
  stopTranslation.title = stopTranslation.disabled ? '正在停止翻译' : '停止翻译';
  errorMessage.hidden = true;
  errorMessage.textContent = '';
  errorActions.hidden = session.status !== 'error';
  retry.hidden = false;
  retry.disabled = false;
  retry.textContent = '重试';
  retry.title = '';
  retry.classList.remove('primary');
  errorSettings.hidden = false;
  errorSettings.textContent = '检查设置';
  errorSettings.classList.remove('primary');
  errorSettings.classList.add('secondary');
  copy.hidden = !copyableText;
  copy.disabled = !copyableText;
  copy.textContent = copyActionLabel(session);
  correct.hidden = session.status !== 'complete' || !session.result?.translatedText;
  correct.disabled = correct.hidden;
  correctionUndo.hidden = !session.correctionReceipt || session.status !== 'complete';
  undoCorrection.disabled = correctionUndo.hidden;
  syncSessionActions();
  translationText.classList.toggle('pending', isTranslating && !session.partialText);
  translationText.classList.toggle(
    'error',
    session.status === 'error' && !preservedPartial && !explicitlyStopped,
  );

  if (isTranslating) {
    formulaView.hidden = true;
    syncTranslationProgress(session);
    translationText.textContent = session.partialText || '';
    if (retryStatusFocusPending) {
      queueMicrotask(() => {
        if (!retryStatusFocusPending) return;
        retryStatusFocusPending = false;
        if (currentSession?.status === 'translating') {
          translationState.focus({ preventScroll: true });
        }
      });
    }
    return;
  }

  finishProgress();

  if (session.status === 'error' && session.error) {
    formulaView.hidden = true;
    const waitingForConfirmation =
      session.settingsRecoveryConfirmation?.failedRequestId === session.requestId;
    if (waitingForConfirmation) {
      translationState.textContent = '配置已完成 · 等待确认';
      retry.hidden = false;
      retry.textContent = '确认重新翻译';
      retry.title = '使用刚保存的配置发起一次新的翻译请求';
      retry.classList.add('primary');
      errorSettings.hidden = true;
      errorActions.hidden = false;
      translationText.textContent = preservedPartial
        ? presentationText(session, preservedPartial)
        : '配置已完成。为避免意外调用 API，请确认后再重新翻译。';
      if (preservedPartial) {
        errorMessage.textContent = '上方部分译文已保留；为避免重复调用 API，请确认后再重新翻译。';
        errorMessage.hidden = false;
      }
      return;
    }
    translationState.textContent = explicitlyStopped
      ? preservedPartial
        ? '已停止 · 已保留部分译文'
        : '已停止'
      : preservedPartial
        ? '翻译中断 · 已保留部分译文'
        : '翻译失败';
    const exactPdfMessage = [
      'EMPTY_SELECTION',
      'REQUEST_ABORTED',
      'UNSUPPORTED_PAGE',
    ].includes(session.error.code);
    const message =
      exactPdfMessage && session.error.message
        ? session.error.message
        : translationErrorMessage(session.error.code, session.error.message);
    const recovery = translationErrorRecovery(
      session.error.code,
      session.error.retryable,
      recoveryRole(session),
    );
    retry.hidden = !recovery.showRetry;
    errorSettings.hidden = !recovery.settingsFocus;
    errorSettings.textContent = recovery.settingsLabel ?? '检查设置';
    errorSettings.dataset.settingsFocus = recovery.settingsFocus ?? '';
    errorSettings.classList.toggle('secondary', recovery.showRetry);
    errorSettings.classList.toggle('primary', !recovery.showRetry && Boolean(recovery.settingsFocus));
    errorActions.hidden = !recovery.showRetry && !recovery.settingsFocus;
    const providerContext = providerErrorContext(session);
    const errorText = providerContext
      ? `${message}\n\n${providerContext}`
      : message;
    if (preservedPartial) {
      translationText.textContent = presentationText(session, preservedPartial);
      if (!explicitlyStopped) {
        errorMessage.textContent = errorText;
        errorMessage.hidden = false;
      }
    } else {
      translationText.textContent = errorText;
    }
    if (retryFocusPending) {
      const shouldRestoreFocus = retryStatusFocusPending || document.activeElement === translationState;
      retryFocusPending = false;
      retryStatusFocusPending = false;
      retryFocusTabId = undefined;
      const focusTarget = recovery.showRetry
        ? retry
        : recovery.settingsFocus
          ? errorSettings
          : translationState;
      if (shouldRestoreFocus) queueMicrotask(() => focusTarget.focus({ preventScroll: true }));
    }
    if (stoppedFromControl) {
      queueMicrotask(() => (preservedPartial ? copy : translationState).focus({ preventScroll: true }));
    }
    return;
  }

  const completedState = translationCompletionStatus(session.result ?? {});
  translationState.textContent = completedState;
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
  const renderPromise = renderTranslationText(
    translatedText,
    hasLatex && renderLatex,
    session.result?.requestId ?? session.requestId,
  );
  if (hasLatex && renderLatex) {
    const identity = progressIdentity(session);
    activeProgressIdentity = identity;
    activeProgressStage = 'rendering';
    activeProgressFeedback = undefined;
    progressFeedback.begin(identity, 'rendering');
    void renderPromise.finally(() => {
      if (
        renderRevision !== translationRenderRevision
        || currentSession?.status !== 'complete'
        || currentSession.requestId !== identity.requestId
        || currentSession.startedAt !== identity.revisionKey
      ) {
        return;
      }
      finishProgress();
      translationState.textContent = completedState;
    }).catch(() => undefined);
  }
  if (retryFocusPending) {
    const shouldRestoreFocus = retryStatusFocusPending || document.activeElement === translationState;
    retryFocusPending = false;
    retryStatusFocusPending = false;
    retryFocusTabId = undefined;
    if (shouldRestoreFocus) queueMicrotask(() => copy.focus({ preventScroll: true }));
  }
}

async function loadActiveSession(
  activated?: { tabId: number; windowId: number },
): Promise<void> {
  const isCurrentLoad = sessionLoadGate.begin();
  let requestedTabId: number | undefined;
  let requestedTabUrl: string | undefined;
  if (activated) {
    requestedTabId = activated.tabId;
    activeWindowId = activated.windowId;
    const tab = await browser.tabs.get(requestedTabId).catch(() => undefined);
    if (!isCurrentLoad()) return;
    requestedTabUrl = tab?.url;
  } else {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!isCurrentLoad()) return;
    requestedTabId = tab?.id;
    requestedTabUrl = tab?.url;
    activeWindowId = tab?.windowId;
  }
  activeTabId = requestedTabId;
  const nextEmptyContext = await resolveEmptyContext(requestedTabId, requestedTabUrl);
  if (!isCurrentLoad()) return;
  showEmptyContext(nextEmptyContext);
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
    setEmptyStatus(translationErrorMessage(response.error.code, response.error.message), true);
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

function openCorrectionEditor(): void {
  const session = activeSession();
  if (!session?.result || session.status !== 'complete') return;
  const sessionResult = session.result;
  const correctionSession = createManualCorrectionSession({
    translatedText: sessionResult.translatedText,
    sourceText: session.sourceText,
  });
  const draft = createManualCorrectionDraft(correctionSession);
  const panel = document.createElement('div');
  panel.className = 'correction-editor';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '修正译文，公式已锁定');
  const parts = document.createElement('div');
  parts.className = 'correction-parts';
  const inputs = new Map<string, HTMLTextAreaElement>();
  let textPartNumber = 0;
  let formulaNumber = 0;
  for (const part of draft.parts) {
    if (part.kind === 'text') {
      if (!part.text.length) continue;
      textPartNumber += 1;
      const input = document.createElement('textarea');
      input.className = 'correction-text-part';
      input.value = part.text;
      input.maxLength = 24000;
      input.setAttribute('aria-label', `可编辑译文第 ${textPartNumber} 段`);
      inputs.set(part.id, input);
      parts.append(input);
    } else {
      formulaNumber += 1;
      const formula = document.createElement('div');
      formula.className = 'correction-latex';
      formula.textContent = part.text;
      formula.setAttribute('aria-label', `受保护公式 ${formulaNumber}，不可编辑`);
      formula.setAttribute('role', 'textbox');
      formula.setAttribute('aria-readonly', 'true');
      formula.tabIndex = 0;
      parts.append(formula);
    }
  }
  const note = document.createElement('p');
  note.className = 'correction-note';
  note.textContent = formulaNumber
    ? '公式片段已锁定；保存只修改自然语言，不调用 API。'
    : '保存修改不会调用 API。';
  if (session.result.alignedSegments?.length) {
    note.textContent += ' 保存整段修正后将退出逐句对照。';
  }
  const scopeLabel = document.createElement('label');
  scopeLabel.className = 'correction-scope';
  scopeLabel.append('译文保存');
  const scope = document.createElement('select');
  scope.ariaLabel = '修正译文的保存范围';
  const stableDocument = Boolean(session.pageUrl.trim() || session.result.documentId);
  for (const [value, label] of [
    ['current', '仅本次'],
    ['document', '记住本文'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.disabled = value === 'document' && !stableDocument;
    scope.append(option);
  }
  scopeLabel.append(scope);
  const termDisclosure = document.createElement('details');
  termDisclosure.className = 'correction-term-disclosure';
  const termSummary = document.createElement('summary');
  termSummary.textContent = '＋ 固定术语（可选）';
  const termFields = document.createElement('fieldset');
  termFields.className = 'correction-term-fields';
  const sourceLabel = document.createElement('label');
  sourceLabel.append('原文术语');
  const source = document.createElement('input');
  source.maxLength = 120;
  source.placeholder = '例如 adaptive sensing';
  source.ariaLabel = '原文术语';
  sourceLabel.append(source);
  const targetLabel = document.createElement('label');
  targetLabel.append('固定译法');
  const target = document.createElement('input');
  target.maxLength = 120;
  target.placeholder = '例如 自适应感知';
  target.ariaLabel = '固定译法';
  targetLabel.append(target);
  const termScopeLabel = document.createElement('label');
  termScopeLabel.className = 'correction-term-scope';
  termScopeLabel.append('保存到');
  const termScope = document.createElement('select');
  termScope.ariaLabel = '术语保存范围';
  for (const [value, label] of [
    ['document', '本文'],
    ['global', '全局'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.disabled = value === 'document' && !stableDocument;
    termScope.append(option);
  }
  if (!stableDocument) termScope.value = 'global';
  termScopeLabel.append(termScope);
  termFields.append(sourceLabel, targetLabel, termScopeLabel);
  termDisclosure.append(termSummary, termFields);
  const actions = document.createElement('div');
  actions.className = 'correction-actions';
  const feedback = document.createElement('span');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'save';
  save.textContent = '保存';
  actions.append(feedback, cancel, save);
  panel.append(parts, note, scopeLabel, termDisclosure, actions);
  translationText.replaceChildren(panel);
  formulaView.hidden = true;
  copy.hidden = true;
  copy.disabled = true;
  correct.hidden = true;
  correctionUndo.hidden = true;
  syncSessionActions();

  cancel.addEventListener('click', () => {
    if (!isSamePdfSidePanelSession(currentSession, session)) return;
    render(currentSession);
    queueMicrotask(() => correct.focus());
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel.click();
  });
  save.addEventListener('click', () => {
    const selectedScope = scope.value as TranslationMemoryScope;
    const edits: ManualCorrectionEdit[] = [...inputs].map(([partId, input]) => ({
      partId,
      text: input.value,
    }));
    const hasTermInput = Boolean(source.value.trim() || target.value.trim());
    const explicitTermCandidate = termDisclosure.open && hasTermInput
      ? { source: source.value, target: target.value }
      : undefined;
    let translatedText: string;
    let term: TranslationCorrectionTermInput | undefined;
    try {
      const applied = applyManualCorrection(correctionSession, {
        revision: draft.revision,
        edits,
        ...(explicitTermCandidate ? { explicitTermCandidate } : {}),
      });
      translatedText = applied.correction.correctedTranslation;
      term = applied.correction.termCandidateDraft
        ? {
            source: applied.correction.termCandidateDraft.source,
            target: applied.correction.termCandidateDraft.target,
            scope: termScope.value as TranslationCorrectionTermInput['scope'],
          }
        : undefined;
    } catch (error) {
      feedback.textContent = error instanceof ManualCorrectionError
        ? error.code === 'NO_CHANGES'
          ? '译文没有变化'
          : error.code === 'LATEX_CHANGED'
            ? '公式已锁定，请只修改文字'
            : error.code === 'INVALID_TERM_CANDIDATE'
              ? '请完整填写不含公式的简短术语和固定译法'
              : '修正内容不完整，请检查'
        : '无法保存修正';
      return;
    }
    panel.setAttribute('aria-busy', 'true');
    save.disabled = true;
    cancel.disabled = true;
    scope.disabled = true;
    termScope.disabled = true;
    for (const input of inputs.values()) input.disabled = true;
    source.disabled = true;
    target.disabled = true;
    feedback.textContent = '正在保存…';
    void (async () => {
      const response = await browser.runtime.sendMessage({
        type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT',
        payload: {
          tabId: session.tabId,
          expectedRequestId: session.requestId,
          expectedResultRequestId: sessionResult.requestId,
          translatedText,
          scope: selectedScope,
          ...(term ? { term } : {}),
        },
      } satisfies RuntimeMessage) as RuntimeResponse<TranslationSessionResult>;
      if (!isSamePdfSidePanelSession(currentSession, session)) return;
      if (!response.ok) {
        throw new Error(
          translationCorrectionErrorMessage(response.error.code, response.error.message),
        );
      }
      currentSession = {
        ...session,
        result: response.data.result,
        partialText: response.data.result.translatedText,
        ...(response.data.correctionReceipt
          ? { correctionReceipt: response.data.correctionReceipt }
          : {}),
      };
      render(currentSession);
      queueMicrotask(() => undoCorrection.focus());
    })().catch((error: unknown) => {
      if (!isSamePdfSidePanelSession(currentSession, session)) return;
      panel.removeAttribute('aria-busy');
      save.disabled = false;
      cancel.disabled = false;
      scope.disabled = false;
      for (const input of inputs.values()) input.disabled = false;
      source.disabled = false;
      target.disabled = false;
      termScope.disabled = false;
      feedback.textContent = error instanceof Error ? error.message : '保存失败，请重试';
    });
  });
  queueMicrotask(() => (inputs.values().next().value ?? scope).focus());
}

function undoCurrentCorrection(): void {
  const session = activeSession();
  if (!session?.correctionReceipt || !session.result) return;
  const sessionResult = session.result;
  const correctionReceipt = session.correctionReceipt;
  undoCorrection.disabled = true;
  setStatus('正在撤销修正');
  void (async () => {
    const response = await browser.runtime.sendMessage({
      type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT',
      payload: {
        tabId: session.tabId,
        expectedRequestId: session.requestId,
        expectedResultRequestId: sessionResult.requestId,
        expectedCorrectedRequestId: correctionReceipt.correctedRequestId,
      },
    } satisfies RuntimeMessage) as RuntimeResponse<TranslationSessionResult>;
    if (!isSamePdfSidePanelSession(currentSession, session)) return;
    if (!response.ok) {
      throw new Error(
        translationCorrectionErrorMessage(response.error.code, response.error.message),
      );
    }
    const { correctionReceipt: _receipt, ...withoutReceipt } = session;
    currentSession = {
      ...withoutReceipt,
      result: response.data.result,
      partialText: response.data.result.translatedText,
    };
    render(currentSession);
    queueMicrotask(() => correct.focus());
    const rollbackSkipped = Boolean(response.data.termRollbackSkipped);
    setStatus(
      rollbackSkipped
        ? '译文已撤销；术语后来被修改，未自动覆盖'
        : '已撤销修正',
      rollbackSkipped ? 8_000 : 2_200,
    );
  })().catch((error: unknown) => {
    undoCorrection.disabled = false;
    setStatus(error instanceof Error ? error.message : '撤销失败', 6_000);
  });
}

function openFullSettings(
  focus?: SettingsFocus,
  recovery?: SettingsRecoveryRequest,
): void {
  void (async () => {
    const response = await browser.runtime.sendMessage({
      type: 'OPEN_OPTIONS_PAGE',
      ...(focus || recovery
        ? {
            payload: {
              ...(focus ? { focus } : {}),
              ...(recovery ? { recovery } : {}),
            },
          }
        : {}),
    } satisfies RuntimeMessage) as OpenOptionsPageResponse;
    if (!response.ok) setStatus('无法打开完整设置，请从扩展菜单进入 Pi Translator 设置');
  })().catch(() => setStatus('无法打开完整设置，请从扩展菜单进入 Pi Translator 设置'));
}

openSettings.addEventListener('click', () => openFullSettings());
emptyAction.addEventListener('click', () => {
  if (emptyContext.kind === 'loading') return;
  const revision = emptyContextRevision;
  const sourceUrl = emptyContext.kind === 'pdf' ? emptyContext.sourceUrl : undefined;
  const pageNumber = emptyContext.kind === 'pdf' ? emptyContext.pageNumber : undefined;
  const idleLabel = emptyAction.textContent;
  emptyAction.disabled = true;
  emptyAction.setAttribute('aria-busy', 'true');
  emptyAction.textContent = '正在打开…';
  setEmptyStatus('');
  void (async () => {
    if (sourceUrl && !await requestEmptyPdfSourceAccess(sourceUrl)) return;
    if (revision !== emptyContextRevision) return;
    const response = await browser.runtime.sendMessage({
      type: 'OPEN_PDF_VIEWER',
      ...(sourceUrl
        ? { payload: { url: sourceUrl, ...(pageNumber ? { page: pageNumber } : {}) } }
        : {}),
    } satisfies RuntimeMessage) as RuntimeResponse<{ opened: true }> | undefined;
    if (!response?.ok) throw new Error(response?.error.message ?? 'PDF reader did not open.');
  })().catch((error: unknown) => {
    if (revision !== emptyContextRevision) return;
    setEmptyStatus(error instanceof Error ? error.message : '无法打开 Pi PDF 阅读器。', true);
  }).finally(() => {
    if (revision !== emptyContextRevision) return;
    emptyAction.disabled = false;
    emptyAction.removeAttribute('aria-busy');
    emptyAction.textContent = idleLabel;
  });
});
errorSettings.addEventListener('click', () => {
  const session = activeSession();
  if (!session) return;
  const focus = errorSettings.dataset.settingsFocus as SettingsFocus | undefined;
  openFullSettings(focus || undefined, settingsRecoveryRequest(session));
});
formulaView.addEventListener('click', () => {
  if (!currentSession?.result?.translatedText) return;
  const rendered = formulaRenderOverride ?? autoRenderLatex;
  formulaRenderOverride = !rendered;
  render(currentSession);
});

retry.addEventListener('click', () => {
  const session = activeSession();
  if (!session) return;
  if (session.settingsRecoveryConfirmation?.failedRequestId === session.requestId) {
    setStatus('正在使用刚保存的配置重新翻译');
  }
  retryFocusPending = document.activeElement === retry;
  retryStatusFocusPending = retryFocusPending;
  retryFocusTabId = retryFocusPending ? session.tabId : undefined;
  retry.disabled = true;
  void (async () => {
    const response = (await browser.runtime.sendMessage({
      type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: session.tabId, expectedRequestId: session.requestId },
    } satisfies RuntimeMessage)) as RuntimeResponse<{ started: true }>;
    if (currentSession?.tabId !== session.tabId || activeTabId !== session.tabId) return;
    if (!response.ok) {
      retry.disabled = false;
      retryFocusPending = false;
      retryStatusFocusPending = false;
      retryFocusTabId = undefined;
      setStatus(translationErrorMessage(response.error.code, response.error.message));
      queueMicrotask(() => retry.focus({ preventScroll: true }));
    }
  })().catch(() => {
    retry.disabled = false;
    retryFocusPending = false;
    retryStatusFocusPending = false;
    retryFocusTabId = undefined;
    setStatus('无法重新开始 PDF 翻译');
    queueMicrotask(() => retry.focus({ preventScroll: true }));
  });
});

stopTranslation.addEventListener('click', () => {
  const session = activeSession();
  if (!session || session.status !== 'translating' || stopPendingRequestId) return;
  stopPendingRequestId = session.requestId;
  render(session);
  void (async () => {
    const response = (await browser.runtime.sendMessage({
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: session.tabId, expectedRequestId: session.requestId },
    } satisfies RuntimeMessage)) as RuntimeResponse<{ cancelled: boolean }>;
    if (
      currentSession?.tabId !== session.tabId ||
      currentSession.requestId !== session.requestId ||
      activeTabId !== session.tabId
    ) return;
    if (!response.ok || !response.data.cancelled) {
      stopPendingRequestId = undefined;
      render(currentSession);
      setStatus(response.ok
        ? '翻译任务已经结束，无需再次停止'
        : translationErrorMessage(response.error.code, response.error.message));
      return;
    }
    if (currentSession.status === 'translating') {
      await loadActiveSession();
    }
  })().catch(() => {
    if (
      currentSession?.tabId !== session.tabId ||
      currentSession.requestId !== session.requestId
    ) return;
    stopPendingRequestId = undefined;
    render(currentSession);
    setStatus('暂时无法停止翻译，请稍后重试');
  });
});

copy.addEventListener('click', () => {
  const session = currentSession;
  const text = session?.result?.translatedText ??
    (session?.status === 'error' ? session.partialText : undefined);
  if (!session || !text) return;
  void navigator.clipboard.writeText(
    normalizeLatexForClipboard(presentationText(session, text)),
  )
    .then(() => showCopySuccess(session))
    .catch(() => {
      if (currentSession !== session) return;
      clearCopyFeedback();
      copy.textContent = copyActionLabel(session);
      setStatus('复制失败', 4_000);
    });
});

sourceToggle.addEventListener('click', () => {
  const session = activeSession();
  if (!session || !sourceCanExpand) return;
  sourceExpanded = !sourceExpanded;
  syncSourceDisclosure(session, translationRenderRevision);
});
window.addEventListener('resize', () => {
  const session = currentSession;
  if (!session) return;
  syncSourceDisclosure(session, translationRenderRevision);
});
correct.addEventListener('click', openCorrectionEditor);
undoCorrection.addEventListener('click', undoCurrentCorrection);

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
  showEmptyContext({ kind: 'loading' });
  render(undefined);
  void loadActiveSession(activated)
    .catch(() => setEmptyStatus('无法读取当前 PDF 会话。', true));
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId || !changeInfo.url || currentSession) return;
  sessionLoadGate.invalidate();
  showEmptyContext(emptyContextForTabUrl(changeInfo.url));
  void loadActiveSession({ tabId, windowId: tab.windowId })
    .catch(() => setEmptyStatus('无法刷新当前页面状态。', true));
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
  setEmptyStatus('无法读取当前 PDF 会话，请重新加载扩展后重试。', true);
});
