import type {
  OpenOptionsPageResponse,
  PdfSidePanelSession,
  RuntimeMessage,
  RuntimeResponse,
  SettingsRecoveryRequest,
  TranslationSessionResult,
} from '../../core/messaging/messages';
import type { GlossaryEntry, TranslationRevisionScope } from '../../core/translation/types';
import {
  translationErrorMessage,
  translationErrorRecovery,
  type SettingsFocus,
  type TranslationProviderRole,
} from '../../core/messaging/user-facing-error';
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
const correct = element<HTMLButtonElement>('correct');
const correctionUndo = element<HTMLElement>('correction-undo');
const undoCorrection = element<HTMLButtonElement>('undo-correction');
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

function setStatus(message: string, timeoutMs = 2_200): void {
  status.textContent = message;
  if (!message || timeoutMs <= 0) return;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, timeoutMs);
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
  if (!session) {
    correct.hidden = true;
    correctionUndo.hidden = true;
    return;
  }

  sourceLabel.textContent = session.sourceLabel;
  sourceLabel.title = session.sourceLabel;
  sourceText.textContent = presentationText(session, session.sourceText);
  const pdfSource = parsePdfSourceUrl(session.pageUrl);
  const pageNumber = session.pageNumber ?? pdfInitialPage(session.pageUrl);
  readerHintText.textContent = session.providerContext?.role === 'vision'
    ? `Edge 原生阅读器未提供选区图像；本次只传递选中文字。复杂公式可用 Pi 打开后截图识别${pageNumber ? `，并定位到第 ${pageNumber} 页` : ''}。`
    : pdfSource
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
  retry.hidden = false;
  retry.disabled = false;
  retry.textContent = '重试';
  retry.title = '';
  retry.classList.remove('primary');
  errorSettings.hidden = false;
  errorSettings.textContent = '检查设置';
  errorSettings.classList.remove('primary');
  errorSettings.classList.add('secondary');
  copy.disabled = session.status !== 'complete' || !session.result?.translatedText;
  correct.hidden = session.status !== 'complete' || !session.result?.translatedText;
  correct.disabled = correct.hidden;
  correctionUndo.hidden = !session.correctionReceipt || session.status !== 'complete';
  undoCorrection.disabled = correctionUndo.hidden;
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
      const preservedPartial = session.partialText?.trim();
      translationText.textContent = preservedPartial
        ? `${presentationText(session, preservedPartial)}\n\n配置已完成。上方部分译文已保留；为避免重复调用 API，请确认后再重新翻译。`
        : '配置已完成。为避免意外调用 API，请确认后再重新翻译。';
      return;
    }
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
  scopeLabel.append('保存方式');
  const scope = document.createElement('select');
  scope.ariaLabel = '修正后的使用范围';
  const stableDocument = Boolean(session.pageUrl.trim() || session.result.documentId);
  for (const [value, label] of [
    ['current', '仅修正本次'],
    ['document', '用于本文并固定术语'],
    ['global', '同时固定为全局术语'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.disabled = value === 'document' && !stableDocument;
    scope.append(option);
  }
  scopeLabel.append(scope);
  const termFields = document.createElement('fieldset');
  termFields.className = 'correction-term-fields';
  termFields.hidden = true;
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
  termFields.append(sourceLabel, targetLabel);
  scope.addEventListener('change', () => {
    termFields.hidden = scope.value === 'current';
  });
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
  panel.append(parts, note, scopeLabel, termFields, actions);
  translationText.replaceChildren(panel);
  formulaView.hidden = true;
  copy.disabled = true;
  correct.hidden = true;
  correctionUndo.hidden = true;

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
    const selectedScope = scope.value as TranslationRevisionScope;
    const edits: ManualCorrectionEdit[] = [...inputs].map(([partId, input]) => ({
      partId,
      text: input.value,
    }));
    const explicitTermCandidate = selectedScope === 'current'
      ? undefined
      : { source: source.value, target: target.value };
    let translatedText: string;
    let term: GlossaryEntry | undefined;
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
          }
        : undefined;
    } catch (error) {
      feedback.textContent = error instanceof ManualCorrectionError
        ? error.code === 'NO_CHANGES'
          ? '译文没有变化'
          : error.code === 'LATEX_CHANGED'
            ? '公式已锁定，请只修改文字'
            : error.code === 'INVALID_TERM_CANDIDATE'
              ? '请填写不含公式的简短术语和固定译法'
              : '修正内容不完整，请检查'
        : '无法保存修正';
      return;
    }
    panel.setAttribute('aria-busy', 'true');
    save.disabled = true;
    cancel.disabled = true;
    scope.disabled = true;
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
        throw new Error(translationErrorMessage(response.error.code, response.error.message));
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
      throw new Error(translationErrorMessage(response.error.code, response.error.message));
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
    setStatus(error instanceof Error ? error.message : '撤销失败');
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
  retry.disabled = true;
  void (async () => {
    const response = (await browser.runtime.sendMessage({
      type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION',
      payload: { tabId: session.tabId, expectedRequestId: session.requestId },
    } satisfies RuntimeMessage)) as RuntimeResponse<{ started: true }>;
    if (currentSession?.tabId !== session.tabId || activeTabId !== session.tabId) return;
    if (!response.ok) {
      retry.disabled = false;
      setStatus(translationErrorMessage(response.error.code, response.error.message));
    }
  })().catch(() => {
    retry.disabled = false;
    setStatus('无法重新开始 PDF 翻译');
  });
});

copy.addEventListener('click', () => {
  const session = currentSession;
  const text = session?.result?.translatedText;
  if (!session || !text) return;
  void navigator.clipboard.writeText(presentationText(session, text))
    .then(() => setStatus('已复制'))
    .catch(() => setStatus('复制失败'));
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
