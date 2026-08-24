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
  TranslationHistoryEntry,
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
import {
  isInjectableWebUrl,
  VISIBLE_TAB_CAPTURE_PERMISSION,
} from '../../core/settings/site-access';
import { containsRenderableLatex } from '../../core/translation/latex-display';
import { normalizeVisionLatexText } from '../../core/translation/formula-output-validation';
import {
  renderTranslationContent,
  renderTranslationContents,
  type TranslationContentTarget,
  type TranslationRenderPerformance,
} from '../../ui/translation-content';
import {
  shouldFollowStreamPreview,
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
import { normalizedSpeechLanguage, selectLocalSpeechVoice } from '../../ui/local-speech';
import {
  getTranslationHistory,
  TRANSLATION_HISTORY_STORAGE_KEY,
} from '../../core/translation/history-repository';

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
const appSubtitle = element<HTMLElement>('app-subtitle');
const appHeader = document.querySelector<HTMLElement>('.app-header')!;
const startWebRegion = element<HTMLButtonElement>('start-web-region');
const startWebRegionLabel = element<HTMLElement>('start-web-region-label');
const sessionSection = element<HTMLElement>('session');
const sourceKindLabel = element<HTMLElement>('source-kind-label');
const sourceLabel = element<HTMLElement>('source-label');
const sourceSection = element<HTMLElement>('source-section');
const sourceText = element<HTMLElement>('source-text');
const sourceToggle = element<HTMLButtonElement>('source-toggle');
const translationState = element<HTMLElement>('translation-state');
const translationHeading = element<HTMLElement>('translation-heading');
const resultSection = element<HTMLElement>('result-section');
const stopTranslation = element<HTMLButtonElement>('stop-translation');
const translationText = element<HTMLElement>('translation-text');
const lexicalLookup = element<HTMLElement>('lexical-lookup');
const lexicalPronunciation = element<HTMLElement>('lexical-pronunciation');
const lexicalPartOfSpeech = element<HTMLElement>('lexical-part-of-speech');
const lexicalSenses = element<HTMLElement>('lexical-senses');
const speakSource = element<HTMLButtonElement>('speak-source');
const errorMessage = element<HTMLElement>('error-message');
const translationViewSwitch = element<HTMLElement>('translation-view-switch');
const translationViewFull = element<HTMLButtonElement>('translation-view-full');
const translationViewAligned = element<HTMLButtonElement>('translation-view-aligned');
const formulaView = element<HTMLButtonElement>('formula-view');
const progressTrack = element<HTMLElement>('progress-track');
const errorActions = element<HTMLElement>('error-actions');
const retry = element<HTMLButtonElement>('retry');
const copy = element<HTMLButtonElement>('copy');
const copyFeedback = element<HTMLElement>('copy-feedback');
const correct = element<HTMLButtonElement>('correct');
const correctionUndo = element<HTMLElement>('correction-undo');
const correctionUndoMessage = element<HTMLElement>('correction-undo-message');
const undoCorrection = element<HTMLButtonElement>('undo-correction');
const readingNavigation = element<HTMLElement>('reading-navigation');
const readingProgress = element<HTMLOutputElement>('reading-progress');
const readingTop = element<HTMLButtonElement>('reading-top');
const readingBottom = element<HTMLButtonElement>('reading-bottom');
const status = element<HTMLElement>('status');
const sessionActions = element<HTMLElement>('session-actions');
const openPiReader = element<HTMLButtonElement>('open-pi-reader');
const webHistoryNavigation = element<HTMLElement>('web-history-navigation');
const webHistoryOlder = element<HTMLButtonElement>('web-history-older');
const webHistoryCounter = element<HTMLOutputElement>('web-history-counter');
const webHistoryNewer = element<HTMLButtonElement>('web-history-newer');
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
let activeTabUrl: string | undefined;
let currentSession: PdfSidePanelSession | undefined;
let latestWebSession: PdfSidePanelSession | undefined;
let webHistory: TranslationHistoryEntry[] = [];
let webHistoryIndex = 0;
let webHistoryLimit = 5;
let webHistoryLoadRevision = 0;
let viewingWebHistory = false;
type SidePanelEmptyContext =
  | { kind: 'loading' }
  | { kind: 'pdf'; sourceUrl?: string; pageNumber?: number }
  | { kind: 'web' }
  | { kind: 'other' };
let emptyContext: SidePanelEmptyContext = { kind: 'loading' };
let emptyContextRevision = 0;
let autoRenderLatex = true;
let formulaRenderOverride: boolean | undefined;
let alignedViewPreferred = false;
let retryFocusPending = false;
let retryStatusFocusPending = false;
let retryFocusTabId: number | undefined;
let stopPendingRequestId: string | undefined;
let copyResetTimer: number | undefined;
let sourceExpanded = false;
let sourceCanExpand = false;
let sourceLayoutFrame: number | undefined;
let webRegionStartPending = false;
let webRegionFeedbackTimer: number | undefined;
const sessionLoadGate = createLatestRequestGate();
let activeProgressIdentity: TranslationProgressIdentity | undefined;
let activeProgressStage: TranslationProgressStage | undefined;
let activeProgressFeedback: TranslationProgressFeedback | undefined;
let translationRenderRevision = 0;
let activeSpeechRequestId: string | undefined;
type ReadingRenderIntent = 'automatic' | 'start' | 'restore';
type ResolvedReadingRenderIntent = Exclude<ReadingRenderIntent, 'automatic'> | 'none';
interface SidePanelReadingPosition {
  progress: number;
  scrollTop: number;
  atBottom: boolean;
  segmentId?: string;
  segmentOffset?: number;
}
const readingPositions = new Map<string, SidePanelReadingPosition>();
let pendingReadingStartIdentity: string | undefined;
let pendingReadingStartInteractionRevision = 0;
let readingInteractionRevision = 0;
let programmaticReadingScroll = false;
let programmaticReadingScrollRevision = 0;

function resetWebHistoryState(): void {
  webHistoryLoadRevision += 1;
  latestWebSession = undefined;
  webHistory = [];
  webHistoryIndex = 0;
  viewingWebHistory = false;
  webHistoryNavigation.hidden = true;
}

function webNavigationHistory(): TranslationHistoryEntry[] {
  const latestResult = latestWebSession?.status === 'complete'
    ? latestWebSession.result
    : undefined;
  const candidates: TranslationHistoryEntry[] = [
    ...(latestResult && latestWebSession
      ? [{
          ...latestResult,
          historyId: `current-${latestResult.requestId}`,
          createdAt: latestWebSession.startedAt,
        }]
      : []),
    ...webHistory,
  ];
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    if (seen.has(entry.requestId)) return false;
    seen.add(entry.requestId);
    return true;
  }).slice(0, webHistoryLimit);
}

function historicalWebSession(entry: TranslationHistoryEntry): PdfSidePanelSession | undefined {
  if (!latestWebSession) return undefined;
  const {
    error: _error,
    progressStage: _progressStage,
    settingsRecoveryConfirmation: _settingsRecoveryConfirmation,
    correctionReceipt: _correctionReceipt,
    ...base
  } = latestWebSession;
  const chunkCount = entry.chunkCount ?? 1;
  return {
    ...base,
    requestId: entry.requestId,
    sourceText: entry.originalText,
    status: 'complete',
    startedAt: entry.createdAt,
    partialText: entry.translatedText,
    completedChunks: chunkCount,
    totalChunks: chunkCount,
    result: entry,
  };
}

function syncWebHistoryNavigation(session: PdfSidePanelSession | undefined): void {
  const history = webNavigationHistory();
  const index = session?.sourceKind === 'web' && session.status === 'complete'
    ? history.findIndex((entry) => entry.requestId === session.requestId)
    : -1;
  const visible = index >= 0 && history.length > 1;
  webHistoryNavigation.hidden = !visible;
  if (!visible) return;
  webHistoryIndex = index;
  viewingWebHistory = index > 0;
  webHistoryCounter.value = `${index + 1} / ${history.length}`;
  webHistoryCounter.textContent = webHistoryCounter.value;
  webHistoryCounter.setAttribute(
    'aria-label',
    `第 ${index + 1} 条，共 ${history.length} 条最近译文`,
  );
  webHistoryOlder.disabled = index >= history.length - 1;
  webHistoryNewer.disabled = index <= 0;
}

function showWebHistoryEntry(index: number): void {
  const history = webNavigationHistory();
  const entry = history[index];
  if (!entry || !latestWebSession) return;
  const session = index === 0 && latestWebSession.result?.requestId === entry.requestId
    ? latestWebSession
    : historicalWebSession(entry);
  if (!session) return;
  webHistoryIndex = index;
  viewingWebHistory = index > 0;
  render(session, 'restore');
}

async function refreshWebHistory(tabId: number): Promise<void> {
  const revision = ++webHistoryLoadRevision;
  const viewedRequestId = currentSession?.sourceKind === 'web'
    ? currentSession.requestId
    : undefined;
  const history = await getTranslationHistory(tabId);
  if (revision !== webHistoryLoadRevision || activeTabId !== tabId) return;
  webHistory = history.slice(0, webHistoryLimit);
  if (!latestWebSession || latestWebSession.tabId !== tabId) return;
  if (latestWebSession.status !== 'complete') {
    syncWebHistoryNavigation(currentSession);
    return;
  }
  const navigation = webNavigationHistory();
  const preservedIndex = viewedRequestId
    ? navigation.findIndex((entry) => entry.requestId === viewedRequestId)
    : -1;
  showWebHistoryEntry(preservedIndex >= 0 ? preservedIndex : 0);
}

function renderIncomingSession(session: PdfSidePanelSession | null | undefined): void {
  if (session?.sourceKind === 'web') {
    latestWebSession = session;
    webHistoryIndex = 0;
    viewingWebHistory = false;
    render(session);
    if (session.status === 'complete') {
      void refreshWebHistory(session.tabId).catch(() => undefined);
    }
    return;
  }
  resetWebHistoryState();
  render(session);
}

function stopSpeaking(): void {
  if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
  activeSpeechRequestId = undefined;
  speakSource.classList.remove('active');
  speakSource.setAttribute('aria-pressed', 'false');
}

function renderLexicalLookup(session: PdfSidePanelSession): void {
  const result = session.result;
  const lookup = result?.lexicalLookup;
  translationHeading.textContent = lookup ? '当前语境' : '译文';
  lexicalLookup.hidden = !lookup;
  if (!lookup) {
    lexicalPronunciation.textContent = '';
    lexicalPartOfSpeech.textContent = '';
    lexicalSenses.replaceChildren();
    stopSpeaking();
    return;
  }
  lexicalPronunciation.textContent = lookup.pronunciation ?? '';
  lexicalPronunciation.hidden = !lookup.pronunciation;
  lexicalPartOfSpeech.textContent = lookup.partOfSpeech ?? '';
  lexicalPartOfSpeech.hidden = !lookup.partOfSpeech;
  speakSource.hidden = typeof window.speechSynthesis === 'undefined' ||
    typeof SpeechSynthesisUtterance === 'undefined';
  const primary = result.translatedText.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
  const senses = lookup.senses.filter((sense) => (
    sense.meaning.trim().replace(/\s+/gu, ' ').toLocaleLowerCase() !== primary
  ));
  lexicalSenses.replaceChildren(...senses.map((sense) => {
    const row = document.createElement('div');
    row.className = 'lexical-sense';
    const part = document.createElement('span');
    part.textContent = sense.partOfSpeech ?? lookup.partOfSpeech ?? '释义';
    const meaning = document.createElement('span');
    meaning.textContent = sense.meaning;
    row.append(part, meaning);
    return row;
  }));
  lexicalSenses.hidden = !senses.length;
}

function emptyContextForTabUrl(tabUrl: string | undefined): SidePanelEmptyContext {
  if (!isEdgeNativePdfContext({ ...(tabUrl ? { tabUrl } : {}) })) {
    return tabUrl && /^https?:/iu.test(tabUrl) ? { kind: 'web' } : { kind: 'other' };
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
  _tabId: number | undefined,
  tabUrl: string | undefined,
): Promise<SidePanelEmptyContext> {
  // Once ordinary webpages can use the same native side panel, an enabled
  // tab-specific panel no longer proves that an unavailable URL belongs to a
  // native PDF. Keep the empty state neutral until the tab URL or a session
  // identifies the source.
  return emptyContextForTabUrl(tabUrl);
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
  syncWebRegionAction(context.kind === 'web');
  if (context.kind === 'loading') {
    appSubtitle.textContent = '网页与 PDF 翻译';
    emptyTitle.textContent = '正在检查当前页面…';
    emptyDescription.textContent = '确认当前标签页可以使用哪种翻译方式。';
    emptyAction.hidden = true;
    return;
  }
  emptyAction.hidden = false;
  if (context.kind === 'pdf') {
    appSubtitle.textContent = 'PDF 划词翻译';
    emptyTitle.textContent = '当前 PDF 已就绪';
    emptyDescription.textContent = '选择文字后右键翻译；需要浮动按钮或更顺畅的跨行选择时，可改用 Pi PDF。';
    emptyAction.textContent = context.sourceUrl ? '用 Pi 打开当前 PDF' : '打开 Pi PDF 阅读器';
    return;
  }
  if (context.kind === 'web') {
    appSubtitle.textContent = '网页划词翻译';
    emptyTitle.textContent = '浏览器侧栏已就绪';
    emptyDescription.textContent = '可直接从顶部框选当前网页；划选文字后，译文也会连续显示在这里。';
    emptyAction.textContent = '改用网页浮动侧栏';
    return;
  }
  appSubtitle.textContent = '网页与 PDF 翻译';
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
    ...(session.sourceKind === 'web' ? {} : { nativePdfTabId: session.tabId }),
  };
}

function syncWebRegionAction(available: boolean): void {
  startWebRegion.hidden = !available;
  if (available || webRegionStartPending) return;
  if (webRegionFeedbackTimer !== undefined) window.clearTimeout(webRegionFeedbackTimer);
  webRegionFeedbackTimer = undefined;
  startWebRegion.disabled = false;
  startWebRegion.removeAttribute('aria-busy');
  startWebRegionLabel.textContent = '框选网页';
  startWebRegion.title = '在当前网页拖动框选文字、公式、图表或图像';
}

function setWebRegionFeedback(message: string, error = false): void {
  if (currentSession) setStatus(message);
  else setEmptyStatus(message, error);
}

async function startCurrentWebRegionSelection(): Promise<void> {
  if (webRegionStartPending || startWebRegion.hidden || activeTabId === undefined) return;
  webRegionStartPending = true;
  if (webRegionFeedbackTimer !== undefined) window.clearTimeout(webRegionFeedbackTimer);
  webRegionFeedbackTimer = undefined;
  startWebRegion.disabled = true;
  startWebRegion.setAttribute('aria-busy', 'true');
  startWebRegionLabel.textContent = '检查权限…';
  setWebRegionFeedback('首次使用时，Edge 会询问是否允许 Pi Translator 截取网页框内画面');
  try {
    if (!activeTabUrl || !isInjectableWebUrl(activeTabUrl)) {
      throw new Error('当前标签页不支持网页框选。');
    }
    // Keep this as the first asynchronous browser call in the click path so
    // Edge preserves the user's activation for the optional permission prompt.
    // captureVisibleTab cannot use activeTab granted by a click inside the
    // browser side panel, so this direct entry needs the declared broad web
    // permission. It remains optional and is requested only from this gesture.
    const granted = await browser.permissions.request({
      origins: [VISIBLE_TAB_CAPTURE_PERMISSION],
    });
    if (!granted) {
      throw new Error(
        '未获得网页截图权限。请再次点击并在 Edge 提示中选择允许；也可从工具栏面板进行一次性框选。',
      );
    }
    startWebRegionLabel.textContent = '启动中…';
    setWebRegionFeedback('');
    const response = await browser.runtime.sendMessage({
      type: 'START_WEB_REGION_SELECTION',
    } satisfies RuntimeMessage) as RuntimeResponse<{ started: true }>;
    if (!response.ok) {
      throw new Error(translationErrorMessage(response.error.code, response.error.message));
    }
    startWebRegionLabel.textContent = '已进入框选';
    setWebRegionFeedback('请在当前网页拖动框选；按 Esc 可取消');
    webRegionFeedbackTimer = window.setTimeout(() => {
      webRegionFeedbackTimer = undefined;
      if (startWebRegion.hidden) return;
      startWebRegionLabel.textContent = '框选网页';
    }, 1_200);
  } catch (error) {
    const message = error instanceof Error ? error.message : '当前网页无法开始框选。';
    startWebRegionLabel.textContent = '重试框选';
    startWebRegion.title = message;
    setWebRegionFeedback(message, true);
  } finally {
    webRegionStartPending = false;
    startWebRegion.disabled = false;
    startWebRegion.removeAttribute('aria-busy');
  }
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

function alignedSegments(session: PdfSidePanelSession) {
  const segments = session.result?.alignedSegments;
  if (!segments?.length || segments.some((segment) => (
    !segment.originalText.trim() || !segment.translatedText.trim()
  ))) {
    return [];
  }
  return segments;
}

function renderAlignedTranslation(
  session: PdfSidePanelSession,
  renderLatex: boolean,
  requestId: string,
): Promise<TranslationRenderPerformance> {
  const targets: TranslationContentTarget[] = [];
  const rows = alignedSegments(session).map((segment, index) => {
    const row = document.createElement('article');
    row.className = 'aligned-segment';
    row.dataset.segmentId = segment.id;
    const source = document.createElement('div');
    source.className = 'aligned-segment-source';
    source.setAttribute('aria-label', `第 ${index + 1} 句原文`);
    source.textContent = presentationText(session, segment.originalText);
    const target = document.createElement('div');
    target.className = 'aligned-segment-target';
    target.setAttribute('aria-label', `第 ${index + 1} 句译文`);
    targets.push({
      container: target,
      text: presentationText(session, segment.translatedText),
      renderLatex,
    });
    row.append(source, target);
    return row;
  });
  translationText.replaceChildren(...rows);
  return renderTranslationContents(
    targets,
    (metrics) => recordResultRenderPerformance(requestId, metrics),
  );
}

function syncTranslationViewSwitch(session: PdfSidePanelSession): boolean {
  const available = session.status === 'complete' && alignedSegments(session).length > 0;
  translationViewSwitch.hidden = !available;
  const aligned = available && alignedViewPreferred;
  translationViewFull.classList.toggle('active', !aligned);
  translationViewFull.setAttribute('aria-pressed', String(!aligned));
  translationViewAligned.classList.toggle('active', aligned);
  translationViewAligned.setAttribute('aria-pressed', String(aligned));
  translationText.classList.toggle('aligned-view', aligned);
  sourceSection.hidden = aligned;
  return aligned;
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
  if (!sourceExpanded) sourceText.scrollTop = 0;
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

function scheduleStreamViewportFollow(
  session: PdfSidePanelSession,
  renderRevision: number,
  shouldFollow: boolean,
): void {
  if (!shouldFollow) return;
  queueMicrotask(() => {
    const scrollRoot = document.scrollingElement;
    if (
      !scrollRoot
      || renderRevision !== translationRenderRevision
      || !isSamePdfSidePanelSession(currentSession, session)
    ) return;
    setReadingScrollTop(scrollRoot.scrollHeight);
  });
}

function readingIdentity(session: PdfSidePanelSession | null | undefined): string | undefined {
  if (!session) return undefined;
  return `${session.tabId}:${session.result?.requestId ?? session.requestId}`;
}

function readingBounds(): {
  top: number;
  bottom: number;
  range: number;
  viewportTop: number;
} | undefined {
  const scrollRoot = document.scrollingElement;
  if (!scrollRoot || resultSection.hidden) return undefined;
  const historyHeight = webHistoryNavigation.hidden
    ? 0
    : webHistoryNavigation.getBoundingClientRect().height;
  const viewportTop = appHeader.getBoundingClientRect().bottom + historyHeight + 8;
  const absoluteResultTop = scrollRoot.scrollTop + resultSection.getBoundingClientRect().top;
  const bottom = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
  const top = Math.min(bottom, Math.max(0, absoluteResultTop - viewportTop));
  return { top, bottom, range: Math.max(0, bottom - top), viewportTop };
}

function setReadingScrollTop(scrollTop: number): void {
  const scrollRoot = document.scrollingElement;
  if (!scrollRoot) return;
  const revision = ++programmaticReadingScrollRevision;
  programmaticReadingScroll = true;
  scrollRoot.scrollTop = Math.max(0, Math.min(
    scrollTop,
    scrollRoot.scrollHeight - scrollRoot.clientHeight,
  ));
  window.requestAnimationFrame(() => {
    if (revision === programmaticReadingScrollRevision) programmaticReadingScroll = false;
  });
}

function rememberCurrentReadingPosition(): void {
  const session = currentSession;
  const identity = readingIdentity(session);
  const scrollRoot = document.scrollingElement;
  const bounds = readingBounds();
  if (
    !session
    || session.status !== 'complete'
    || !identity
    || !scrollRoot
    || !bounds
    || translationText.classList.contains('correction-mode')
    || pendingReadingStartIdentity === identity
  ) return;
  const progress = bounds.range > 0
    ? Math.min(1, Math.max(0, (scrollRoot.scrollTop - bounds.top) / bounds.range))
    : 0;
  const position: SidePanelReadingPosition = {
    progress,
    scrollTop: scrollRoot.scrollTop,
    atBottom: bounds.bottom - scrollRoot.scrollTop <= 1,
  };
  const segment = [...translationText.querySelectorAll<HTMLElement>('.aligned-segment')]
    .find((candidate) => candidate.getBoundingClientRect().bottom > bounds.viewportTop + 1);
  if (segment?.dataset.segmentId) {
    position.segmentId = segment.dataset.segmentId;
    position.segmentOffset = segment.getBoundingClientRect().top - bounds.viewportTop;
  }
  readingPositions.delete(identity);
  readingPositions.set(identity, position);
  while (readingPositions.size > 40) {
    const oldest = readingPositions.keys().next().value as string | undefined;
    if (!oldest) break;
    readingPositions.delete(oldest);
  }
}

function resolveReadingRenderIntent(
  session: PdfSidePanelSession | null | undefined,
  requested: ReadingRenderIntent,
  previousIdentity: string | undefined,
  previousComplete: boolean,
): ResolvedReadingRenderIntent {
  const nextIdentity = readingIdentity(session);
  if (!nextIdentity) return 'none';
  const markPendingStart = () => {
    if (pendingReadingStartIdentity === nextIdentity) return;
    pendingReadingStartIdentity = nextIdentity;
    pendingReadingStartInteractionRevision = readingInteractionRevision;
  };
  const clearPendingStart = () => {
    if (pendingReadingStartIdentity !== nextIdentity) return;
    pendingReadingStartIdentity = undefined;
    pendingReadingStartInteractionRevision = readingInteractionRevision;
  };
  if (requested === 'start') {
    markPendingStart();
    return 'start';
  }
  if (requested === 'restore') {
    if (readingPositions.has(nextIdentity)) {
      clearPendingStart();
      return 'restore';
    }
    markPendingStart();
    return 'start';
  }
  if (pendingReadingStartIdentity === nextIdentity && session?.status === 'complete') {
    if (pendingReadingStartInteractionRevision !== readingInteractionRevision) {
      clearPendingStart();
      return 'none';
    }
    return 'start';
  }
  if (nextIdentity !== previousIdentity) {
    if (readingPositions.has(nextIdentity)) {
      clearPendingStart();
      return 'restore';
    }
    markPendingStart();
    return 'start';
  }
  if (previousComplete && session?.status === 'complete') {
    return readingPositions.has(nextIdentity) ? 'restore' : 'start';
  }
  if (!previousComplete && session?.status === 'complete') {
    if (readingPositions.has(nextIdentity)) return 'restore';
    markPendingStart();
    return 'start';
  }
  return 'none';
}

function updateReadingNavigation(): void {
  const scrollRoot = document.scrollingElement;
  const bounds = readingBounds();
  const longResult = Boolean(
    currentSession?.status === 'complete'
    && !translationText.classList.contains('correction-mode')
    && scrollRoot
    && bounds
    && bounds.range > Math.max(24, scrollRoot.clientHeight * .08)
  );
  const visibilityChanged = readingNavigation.hidden === longResult;
  readingNavigation.hidden = !longResult;
  if (!longResult || !scrollRoot || !bounds) {
    readingTop.disabled = true;
    readingBottom.disabled = true;
    return;
  }
  const ratio = bounds.range > 0
    ? Math.min(1, Math.max(0, (scrollRoot.scrollTop - bounds.top) / bounds.range))
    : 0;
  const percentage = Math.round(ratio * 100);
  const atTop = scrollRoot.scrollTop <= bounds.top + 1;
  const atBottom = bounds.bottom - scrollRoot.scrollTop <= 1;
  readingProgress.value = atTop ? '顶部' : atBottom ? '底部' : `${percentage}%`;
  readingProgress.textContent = readingProgress.value;
  readingProgress.setAttribute('aria-label', `译文阅读进度 ${percentage}%`);
  readingTop.disabled = atTop;
  readingBottom.disabled = atBottom;
  if (visibilityChanged) window.requestAnimationFrame(updateReadingNavigation);
}

function applyReadingPosition(
  session: PdfSidePanelSession,
  intent: ResolvedReadingRenderIntent,
): void {
  if (intent === 'none') return;
  const identity = readingIdentity(session);
  const bounds = readingBounds();
  const scrollRoot = document.scrollingElement;
  if (!identity || !bounds || !scrollRoot) return;
  const position = intent === 'restore' ? readingPositions.get(identity) : undefined;
  if (!position) {
    setReadingScrollTop(bounds.top);
    if (session.status === 'complete' && pendingReadingStartIdentity === identity) {
      pendingReadingStartIdentity = undefined;
    }
    return;
  }
  if (position.atBottom) {
    setReadingScrollTop(bounds.bottom);
    return;
  }
  const segment = position.segmentId
    ? [...translationText.querySelectorAll<HTMLElement>('.aligned-segment')]
      .find((candidate) => candidate.dataset.segmentId === position.segmentId)
    : undefined;
  if (segment && position.segmentOffset !== undefined) {
    setReadingScrollTop(
      scrollRoot.scrollTop
      + segment.getBoundingClientRect().top
      - bounds.viewportTop
      - position.segmentOffset,
    );
    return;
  }
  setReadingScrollTop(
    bounds.range > 0 ? bounds.top + position.progress * bounds.range : position.scrollTop,
  );
}

function scheduleReadingState(
  session: PdfSidePanelSession,
  renderRevision: number,
  intent: ResolvedReadingRenderIntent,
  interactionRevision: number,
): void {
  window.requestAnimationFrame(() => {
    if (
      renderRevision !== translationRenderRevision
      || readingIdentity(currentSession) !== readingIdentity(session)
    ) return;
    if (interactionRevision === readingInteractionRevision) {
      applyReadingPosition(session, intent);
    }
    updateReadingNavigation();
  });
}

function scrollReadingToEdge(edge: 'top' | 'bottom'): void {
  const bounds = readingBounds();
  if (!bounds || readingNavigation.hidden) return;
  const moveFocus = document.activeElement === readingTop || document.activeElement === readingBottom;
  readingInteractionRevision += 1;
  setReadingScrollTop(edge === 'top' ? bounds.top : bounds.bottom);
  rememberCurrentReadingPosition();
  updateReadingNavigation();
  if (moveFocus) {
    window.queueMicrotask(() => (edge === 'top' ? readingBottom : readingTop)
      .focus({ preventScroll: true }));
  }
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

function render(
  session: PdfSidePanelSession | null | undefined,
  readingIntent: ReadingRenderIntent = 'automatic',
): void {
  const previousIdentity = readingIdentity(currentSession);
  const previousComplete = currentSession?.status === 'complete';
  if (previousComplete) rememberCurrentReadingPosition();
  const resolvedReadingIntent = resolveReadingRenderIntent(
    session,
    readingIntent,
    previousIdentity,
    previousComplete,
  );
  const readingInteractionAtRender = readingInteractionRevision;
  const sameSession = Boolean(session && isSamePdfSidePanelSession(currentSession, session));
  const scrollRoot = document.scrollingElement;
  const followStreamOutput = Boolean(
    sameSession
    && currentSession?.status === 'translating'
    && scrollRoot
    && shouldFollowStreamPreview({
      scrollTop: scrollRoot.scrollTop,
      scrollHeight: scrollRoot.scrollHeight,
      clientHeight: scrollRoot.clientHeight,
    }),
  );
  if (!sameSession) {
    formulaRenderOverride = undefined;
    sourceExpanded = false;
    sourceCanExpand = false;
  }
  if (sourceLayoutFrame !== undefined) window.cancelAnimationFrame(sourceLayoutFrame);
  sourceLayoutFrame = undefined;
  clearCopyFeedback();
  translationText.classList.remove('correction-mode');
  translationText.classList.remove('aligned-view');
  translationViewSwitch.hidden = true;
  sourceSection.hidden = false;
  readingNavigation.hidden = true;
  currentSession = session ?? undefined;
  syncWebHistoryNavigation(currentSession);
  const renderRevision = ++translationRenderRevision;
  if (session) {
    scheduleStreamViewportFollow(
      session,
      renderRevision,
      followStreamOutput && resolvedReadingIntent === 'none',
    );
    scheduleReadingState(
      session,
      renderRevision,
      resolvedReadingIntent,
      readingInteractionAtRender,
    );
  }
  emptyState.hidden = Boolean(session);
  sessionSection.hidden = !session;
  if (!session) {
    translationHeading.textContent = '译文';
    lexicalLookup.hidden = true;
    stopSpeaking();
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
  const isWebSession = session.sourceKind === 'web';
  syncWebRegionAction(isWebSession);
  const historicalWebResult = isWebSession && viewingWebHistory;
  appSubtitle.textContent = isWebSession ? '网页划词翻译' : 'PDF 划词翻译';
  sourceKindLabel.textContent = isWebSession ? '当前网页' : '当前 PDF';
  sourceText.textContent = presentationText(session, session.sourceText);
  syncSourceDisclosure(session, renderRevision);
  const pdfSource = isWebSession ? undefined : parsePdfSourceUrl(session.pageUrl);
  const pageNumber = session.pageNumber ?? pdfInitialPage(session.pageUrl);
  const needsVisionHint = session.providerContext?.role === 'vision';
  readerHintText.hidden = isWebSession || !needsVisionHint;
  readerHintText.textContent = needsVisionHint
    ? `Edge 原生阅读器未提供选区图像；本次只传递选中文字。复杂公式可用 Pi 打开后截图识别${pageNumber ? `，并定位到第 ${pageNumber} 页` : ''}。`
    : '';
  openPiReader.textContent = isWebSession
    ? '改用浮动侧栏'
    : pdfSource
      ? '用 Pi 打开'
      : '解决 PDF 读取权限';
  if (isWebSession || pdfSource) hidePdfAccessAlert();
  else showHiddenPdfSourceAlert();

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
  correct.hidden = historicalWebResult || session.status !== 'complete' || !session.result?.translatedText;
  correct.disabled = correct.hidden;
  correctionUndo.hidden = historicalWebResult || !session.correctionReceipt || session.status !== 'complete';
  correctionUndo.classList.remove('is-error');
  correctionUndo.removeAttribute('aria-busy');
  correctionUndo.setAttribute('role', 'status');
  correctionUndo.setAttribute('aria-live', 'polite');
  correctionUndoMessage.textContent = '已修正 ·';
  undoCorrection.disabled = correctionUndo.hidden;
  undoCorrection.textContent = '撤销';
  syncSessionActions();
  translationText.classList.toggle('pending', isTranslating && !session.partialText);
  translationText.classList.toggle(
    'error',
    session.status === 'error' && !preservedPartial && !explicitlyStopped,
  );
  if (session.status !== 'complete') {
    translationHeading.textContent = '译文';
    lexicalLookup.hidden = true;
    stopSpeaking();
  }

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
  renderLexicalLookup(session);
  translationState.textContent = completedState;
  const translatedText = presentationText(
    session,
    session.result?.translatedText ?? session.partialText ?? '',
  );
  const hasLatex = containsRenderableLatex(translatedText);
  const renderLatex = formulaRenderOverride ?? autoRenderLatex;
  const renderAligned = syncTranslationViewSwitch(session);
  formulaView.hidden = !hasLatex;
  formulaView.textContent = renderLatex ? '源码' : '公式';
  formulaView.title = renderLatex ? '显示可编辑的 LaTeX 源码' : '渲染译文中的 LaTeX 公式';
  formulaView.setAttribute('aria-pressed', String(renderLatex));
  const resultRequestId = session.result?.requestId ?? session.requestId;
  const renderPromise = renderAligned
    ? renderAlignedTranslation(session, hasLatex && renderLatex, resultRequestId)
    : renderTranslationText(translatedText, hasLatex && renderLatex, resultRequestId);
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
      scheduleReadingState(
        session,
        renderRevision,
        resolvedReadingIntent,
        readingInteractionAtRender,
      );
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

speakSource.addEventListener('click', () => {
  const result = currentSession?.result;
  if (!result || typeof window.speechSynthesis === 'undefined' ||
      typeof SpeechSynthesisUtterance === 'undefined') return;
  if (activeSpeechRequestId === result.requestId) {
    stopSpeaking();
    return;
  }
  stopSpeaking();
  const language = normalizedSpeechLanguage(result.detectedLanguage);
  const voice = selectLocalSpeechVoice(window.speechSynthesis.getVoices(), language);
  if (!voice) {
    setStatus('当前没有可用的本地语音，原文未发送到语音服务');
    return;
  }
  activeSpeechRequestId = result.requestId;
  speakSource.classList.add('active');
  speakSource.setAttribute('aria-pressed', 'true');
  const utterance = new SpeechSynthesisUtterance(result.originalText);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  const finish = (): void => {
    if (activeSpeechRequestId !== result.requestId) return;
    activeSpeechRequestId = undefined;
    speakSource.classList.remove('active');
    speakSource.setAttribute('aria-pressed', 'false');
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
});

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
  if (activeTabId !== requestedTabId) resetWebHistoryState();
  activeTabId = requestedTabId;
  activeTabUrl = requestedTabUrl;
  const nextEmptyContext = await resolveEmptyContext(requestedTabId, requestedTabUrl);
  if (!isCurrentLoad()) return;
  showEmptyContext(nextEmptyContext);
  if (requestedTabId === undefined) {
    render(undefined);
    return;
  }
  if (nextEmptyContext.kind === 'web') {
    void browser.tabs.sendMessage(requestedTabId, {
      type: 'BROWSER_SIDEBAR_ACTIVE',
    } satisfies RuntimeMessage).catch(() => undefined);
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
  renderIncomingSession(response.data.session);
}

function activeSession(): PdfSidePanelSession | undefined {
  if (currentSession?.tabId === activeTabId) return currentSession;
  setStatus('当前标签页已切换，正在刷新翻译会话');
  void loadActiveSession().catch(() => setStatus('无法读取当前翻译会话'));
  return undefined;
}

webHistoryOlder.addEventListener('click', () => {
  showWebHistoryEntry(webHistoryIndex + 1);
});

webHistoryNewer.addEventListener('click', () => {
  showWebHistoryEntry(webHistoryIndex - 1);
});

function openCorrectionEditor(): void {
  const session = activeSession();
  if (!session?.result || session.status !== 'complete') return;
  rememberCurrentReadingPosition();
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
  feedback.id = 'pi-pdf-side-panel-correction-status';
  feedback.className = 'correction-feedback';
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
  for (const input of inputs.values()) input.setAttribute('aria-describedby', feedback.id);
  source.setAttribute('aria-describedby', feedback.id);
  target.setAttribute('aria-describedby', feedback.id);
  translationText.classList.add('correction-mode');
  translationText.replaceChildren(panel);
  translationViewSwitch.hidden = true;
  sourceSection.hidden = false;
  readingNavigation.hidden = true;
  formulaView.hidden = true;
  copy.hidden = true;
  copy.disabled = true;
  correct.hidden = true;
  correctionUndo.hidden = true;
  syncSessionActions();

  cancel.addEventListener('click', () => {
    if (!isSamePdfSidePanelSession(currentSession, session)) return;
    render(currentSession, 'restore');
    queueMicrotask(() => correct.focus());
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel.click();
  });
  panel.addEventListener('focusin', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLElement) || actions.contains(control)) return;
    window.requestAnimationFrame(() => {
      if (!control.isConnected) return;
      const overlap = control.getBoundingClientRect().bottom
        - actions.getBoundingClientRect().top
        + 8;
      if (overlap > 0) window.scrollBy({ top: overlap, behavior: 'auto' });
    });
  });
  const setCorrectionStatus = (message: string, isError = false): void => {
    feedback.textContent = message;
    feedback.classList.toggle('is-error', isError);
    feedback.setAttribute('role', isError ? 'alert' : 'status');
    feedback.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  };
  const showSaveFailure = (message: string): void => {
    setCorrectionStatus(message, true);
    save.textContent = '重试';
    queueMicrotask(() => {
      feedback.scrollIntoView({ block: 'nearest' });
      save.focus({ preventScroll: true });
    });
  };
  const resetSaveError = (): void => {
    if (!feedback.classList.contains('is-error')) return;
    setCorrectionStatus('');
    save.textContent = '保存';
  };
  const clearTermErrors = (): void => {
    source.removeAttribute('aria-invalid');
    target.removeAttribute('aria-invalid');
  };
  const updateTermSummary = (): void => {
    const hasSource = Boolean(source.value.trim());
    const hasTarget = Boolean(target.value.trim());
    termDisclosure.classList.toggle('has-value', hasSource && hasTarget);
    termDisclosure.classList.toggle('has-error', hasSource !== hasTarget);
    termSummary.textContent = hasSource && hasTarget
      ? '✓ 已填写固定术语'
      : hasSource !== hasTarget
        ? '！固定术语待补充'
        : '＋ 固定术语（可选）';
  };
  const showTermValidationFailure = (): void => {
    const sourceMissing = !source.value.trim();
    const targetMissing = !target.value.trim();
    const pairInvalid = !sourceMissing && !targetMissing;
    source.setAttribute('aria-invalid', String(sourceMissing || pairInvalid));
    target.setAttribute('aria-invalid', String(targetMissing || pairInvalid));
    termDisclosure.classList.remove('has-value');
    termDisclosure.classList.add('has-error');
    termSummary.textContent = '！固定术语需检查';
    termDisclosure.open = true;
    queueMicrotask(() => (sourceMissing ? source : targetMissing ? target : source)
      .focus({ preventScroll: true }));
  };
  const focusFirstTextPart = (): void => {
    queueMicrotask(() => (inputs.values().next().value ?? scope).focus());
  };
  for (const input of inputs.values()) input.addEventListener('input', resetSaveError);
  const onTermInput = (): void => {
    clearTermErrors();
    updateTermSummary();
    resetSaveError();
  };
  source.addEventListener('input', onTermInput);
  target.addEventListener('input', onTermInput);
  save.addEventListener('click', () => {
    const selectedScope = scope.value as TranslationMemoryScope;
    const edits: ManualCorrectionEdit[] = [...inputs].map(([partId, input]) => ({
      partId,
      text: input.value,
    }));
    const hasTermInput = Boolean(source.value.trim() || target.value.trim());
    const explicitTermCandidate = hasTermInput
      ? { source: source.value, target: target.value }
      : undefined;
    let translatedText: string;
    let term: TranslationCorrectionTermInput | undefined;
    clearTermErrors();
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
      setCorrectionStatus(error instanceof ManualCorrectionError
        ? error.code === 'NO_CHANGES'
          ? '译文没有变化'
          : error.code === 'LATEX_CHANGED'
            ? '公式已锁定，请只修改文字'
            : error.code === 'INVALID_TERM_CANDIDATE'
              ? '请完整填写不含公式的简短术语和固定译法'
              : '修正内容不完整，请检查'
        : '无法保存修正', true);
      if (error instanceof ManualCorrectionError && error.code === 'INVALID_TERM_CANDIDATE') {
        showTermValidationFailure();
      } else {
        focusFirstTextPart();
      }
      return;
    }
    save.textContent = '保存';
    panel.setAttribute('aria-busy', 'true');
    save.disabled = true;
    cancel.disabled = true;
    scope.disabled = true;
    termScope.disabled = true;
    for (const input of inputs.values()) input.disabled = true;
    source.disabled = true;
    target.disabled = true;
    setCorrectionStatus('正在保存…');
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
      showSaveFailure(error instanceof Error ? error.message : '保存失败，请重试');
    });
  });
  queueMicrotask(() => (inputs.values().next().value ?? scope).focus());
}

function undoCurrentCorrection(): void {
  const session = activeSession();
  if (!session?.correctionReceipt || !session.result) return;
  const sessionResult = session.result;
  const correctionReceipt = session.correctionReceipt;
  correctionUndo.classList.remove('is-error');
  correctionUndo.setAttribute('aria-busy', 'true');
  correctionUndo.setAttribute('role', 'status');
  correctionUndo.setAttribute('aria-live', 'polite');
  correctionUndoMessage.textContent = '正在撤销…';
  undoCorrection.textContent = '撤销';
  undoCorrection.disabled = true;
  setStatus('');
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
    correctionUndo.removeAttribute('aria-busy');
    undoCorrection.disabled = false;
    undoCorrection.textContent = '重试';
    correctionUndo.classList.add('is-error');
    correctionUndo.setAttribute('role', 'alert');
    correctionUndo.setAttribute('aria-live', 'assertive');
    correctionUndoMessage.textContent = error instanceof Error
      ? `${error.message} ·`
      : '撤销失败 ·';
    queueMicrotask(() => {
      correctionUndo.scrollIntoView({ block: 'nearest' });
      undoCorrection.focus({ preventScroll: true });
    });
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
startWebRegion.addEventListener('click', () => {
  void startCurrentWebRegionSelection();
});
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
    if (emptyContext.kind === 'web') {
      const response = await browser.runtime.sendMessage({
        type: 'USE_FLOATING_SIDEBAR',
        ...(activeTabId === undefined ? {} : { payload: { tabId: activeTabId } }),
      } satisfies RuntimeMessage) as RuntimeResponse<{ opened: true }>;
      if (!response.ok) throw new Error(response.error.message);
      return;
    }
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
    setEmptyStatus(
      error instanceof Error
        ? error.message
        : emptyContext.kind === 'web'
          ? '无法切换到网页浮动侧栏。'
          : '无法打开 Pi PDF 阅读器。',
      true,
    );
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
  render(currentSession, 'restore');
});

translationViewFull.addEventListener('click', () => {
  if (!currentSession || translationViewSwitch.hidden) return;
  alignedViewPreferred = false;
  render(currentSession, 'restore');
});

translationViewAligned.addEventListener('click', () => {
  if (!currentSession || translationViewSwitch.hidden) return;
  alignedViewPreferred = true;
  render(currentSession, 'restore');
});

readingTop.addEventListener('click', () => scrollReadingToEdge('top'));
readingBottom.addEventListener('click', () => scrollReadingToEdge('bottom'));

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
    setStatus('无法重新开始翻译');
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
  window.requestAnimationFrame(updateReadingNavigation);
});
window.addEventListener('scroll', () => {
  if (!programmaticReadingScroll) readingInteractionRevision += 1;
  rememberCurrentReadingPosition();
  updateReadingNavigation();
}, { passive: true });
window.addEventListener('keydown', (event) => {
  if (
    readingNavigation.hidden
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || (event.key !== 'Home' && event.key !== 'End')
  ) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) return;
  event.preventDefault();
  scrollReadingToEdge(event.key === 'Home' ? 'top' : 'bottom');
});
correct.addEventListener('click', openCorrectionEditor);
undoCorrection.addEventListener('click', undoCurrentCorrection);

openPiReader.addEventListener('click', () => {
  void (async () => {
    const session = activeSession();
    if (!session) return;
    if (session.sourceKind === 'web') {
      const response = await browser.runtime.sendMessage({
        type: 'USE_FLOATING_SIDEBAR',
        payload: { tabId: session.tabId },
      } satisfies RuntimeMessage) as RuntimeResponse<{ opened: true }>;
      if (!response.ok) throw new Error(response.error.message);
      return;
    }
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
    renderIncomingSession(typed.payload);
  }
});

browser.tabs.onActivated.addListener((activated) => {
  if (activeWindowId !== undefined && activated.windowId !== activeWindowId) return;
  const previousTabId = activeTabId;
  if (previousTabId !== undefined && previousTabId !== activated.tabId) {
    void browser.tabs.sendMessage(previousTabId, {
      type: 'BROWSER_SIDEBAR_CLOSED',
    } satisfies RuntimeMessage).catch(() => undefined);
  }
  sessionLoadGate.invalidate();
  resetWebHistoryState();
  activeTabId = activated.tabId;
  activeTabUrl = undefined;
  showEmptyContext({ kind: 'loading' });
  render(undefined);
  void loadActiveSession(activated)
    .catch(() => setEmptyStatus('无法读取当前翻译会话。', true));
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId || !changeInfo.url) return;
  activeTabUrl = changeInfo.url;
  if (currentSession) return;
  sessionLoadGate.invalidate();
  showEmptyContext(emptyContextForTabUrl(changeInfo.url));
  void loadActiveSession({ tabId, windowId: tab.windowId })
    .catch(() => setEmptyStatus('无法刷新当前页面状态。', true));
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes[TRANSLATION_HISTORY_STORAGE_KEY]) {
    if (activeTabId !== undefined && latestWebSession?.tabId === activeTabId) {
      void refreshWebHistory(activeTabId).catch(() => undefined);
    }
    return;
  }
  if (areaName !== 'local' || !changes.extensionSettings) return;
  void getSettings().then((settings) => {
    autoRenderLatex = settings.autoRenderLatex;
    webHistoryLimit = settings.historyLimit;
    formulaRenderOverride = undefined;
    if (activeTabId !== undefined && latestWebSession?.tabId === activeTabId) {
      void refreshWebHistory(activeTabId).catch(() => undefined);
    } else {
      render(currentSession);
    }
  });
});

window.addEventListener('pagehide', () => {
  if (activeTabId === undefined) return;
  void browser.tabs.sendMessage(activeTabId, {
    type: 'BROWSER_SIDEBAR_CLOSED',
  } satisfies RuntimeMessage).catch(() => undefined);
});

void getSettings().then((settings) => {
  autoRenderLatex = settings.autoRenderLatex;
  webHistoryLimit = settings.historyLimit;
  if (activeTabId !== undefined && latestWebSession?.tabId === activeTabId) {
    void refreshWebHistory(activeTabId).catch(() => undefined);
  } else {
    render(currentSession);
  }
});
void loadActiveSession().catch(() => {
  render(undefined);
  setEmptyStatus('无法读取当前翻译会话，请重新加载扩展后重试。', true);
});
