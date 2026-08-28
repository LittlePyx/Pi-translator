import {
  activateApiProfile,
  getSettings,
  hasApiKey,
  mutateSettings,
} from '../../core/settings/repository';
import { apiOriginPattern } from '../../core/settings/api-access';
import type { ApiProfile, ExtensionSettings } from '../../core/settings/schema';
import {
  textApiReadiness,
  visionApiReadiness,
  type ApiReadinessStatus,
  type ProviderReadinessSnapshot,
} from '../../core/settings/api-readiness';
import { getApiModelCapabilities } from '../../core/translation/api-capability-repository';
import type {
  ActivePdfSourceResponse,
  BilingualPageStateResponse,
  RuntimeMessage,
  RuntimeResponse,
} from '../../core/messaging/messages';
import {
  bilingualPageLanguageSwitchConfirmation,
  EMPTY_BILINGUAL_PAGE_STATE,
  type BilingualPageAction,
  type BilingualPageState,
} from '../../core/translation/bilingual-page';
import {
  isSupportedTargetLanguage,
  supportedTargetLanguageLabel,
  type SupportedTargetLanguage,
} from '../../core/language/supported-target-languages';
import {
  getPausedSiteHosts,
  isSiteHostPaused,
  setSitePaused,
  siteHostFromUrl,
} from '../../core/settings/site-pause';
import {
  edgePdfSourceUrl,
  isEdgeNativePdfContext,
  parsePdfSourceUrl,
  pdfInitialPage,
  pdfPermissionPattern,
} from '../../core/pdf/source';
import { isInjectableWebUrl, isOverleafProjectUrl } from '../../core/settings/site-access';
import {
  popupPageState,
  popupReadiness,
  type PopupReadinessAction,
  type PopupShortcutState,
} from '../../core/settings/popup-readiness';
import { assignedTranslationShortcut } from '../../core/commands/translation-shortcut';
import type { SettingsFocus } from '../../core/messaging/user-facing-error';
import {
  completeFeatureDiscovery,
  dismissFeatureDiscovery,
  featureDiscoveryModel,
  featureDiscoverySceneForPage,
  getFeatureDiscoveryProgress,
  type FeatureDiscoveryFeature,
  type FeatureDiscoveryProgress,
  type FeatureDiscoveryScene,
} from '../../core/settings/feature-discovery';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing popup element #${id}`);
  return value as T;
}

const targetLanguage = element<HTMLSelectElement>('target-language');
const bilingualLanguageConfirmation = element<HTMLElement>('bilingual-language-confirmation');
const bilingualLanguageMessage = element<HTMLElement>('bilingual-language-message');
const bilingualLanguageCancel = element<HTMLButtonElement>('bilingual-language-cancel');
const bilingualLanguageConfirm = element<HTMLButtonElement>('bilingual-language-confirm');
const apiProfileField = element<HTMLElement>('api-profile-field');
const apiProfile = element<HTMLSelectElement>('api-profile');
const siteControl = element<HTMLElement>('site-control');
const siteName = element<HTMLElement>('site-name');
const pauseSite = element<HTMLInputElement>('pause-site');
const status = element<HTMLParagraphElement>('status');
const quickActions = element<HTMLElement>('quick-actions');
const openSettings = element<HTMLButtonElement>('open-settings');
const translatePage = element<HTMLButtonElement>('translate-page');
const openSidebar = element<HTMLButtonElement>('open-sidebar');
const openWebRegion = element<HTMLButtonElement>('open-web-region');
const openPdf = element<HTMLButtonElement>('open-pdf');
const pdfAccessAlert = element<HTMLElement>('pdf-access-alert');
const pdfAccessTitle = element<HTMLElement>('pdf-access-title');
const pdfAccessMessage = element<HTMLElement>('pdf-access-message');
const pdfAccessSteps = element<HTMLOListElement>('pdf-access-steps');
const openExtensionManagement = element<HTMLButtonElement>('open-extension-management');
const retryPdfAccess = element<HTMLButtonElement>('retry-pdf-access');
const textApiStatus = element<HTMLButtonElement>('text-api-status');
const visionApiStatus = element<HTMLButtonElement>('vision-api-status');
const readinessPanel = element<HTMLElement>('readiness-panel');
const readinessTitle = element<HTMLElement>('readiness-title');
const readinessNote = element<HTMLParagraphElement>('readiness-note');
const readinessIssues = element<HTMLElement>('readiness-issues');
const pageContext = element<HTMLParagraphElement>('page-context');
const featureGuideToggle = element<HTMLButtonElement>('feature-guide-toggle');
const featureGuide = element<HTMLElement>('feature-guide');
const featureGuideEyebrow = element<HTMLElement>('feature-guide-eyebrow');
const featureGuideTitle = element<HTMLElement>('feature-guide-title');
const featureGuideDescription = element<HTMLParagraphElement>('feature-guide-description');
const featureGuideSteps = element<HTMLOListElement>('feature-guide-steps');
const featureGuideProgress = element<HTMLParagraphElement>('feature-guide-progress');
const featureGuideDismiss = element<HTMLButtonElement>('feature-guide-dismiss');

let activeUrl: string | undefined;
let activeTabId: number | undefined;
let activePdfSourceUrl: string | undefined;
let activePdfPage: number | undefined;
let activePdfContext: 'native' | 'overleaf' | undefined;
let sidebarMode: 'floating' | 'browser' = 'floating';
let generalPageMode: ExtensionSettings['generalPageMode'] = 'on-demand';
let textApiSettingsFocus: ApiReadinessStatus['settingsFocus'] = 'api';
let visionApiSettingsFocus: ApiReadinessStatus['settingsFocus'] = 'vision';
let popupShortcutState: PopupShortcutState = 'unknown';
let assignedShortcutLabel: string | undefined;
let featureGuideProgressState: FeatureDiscoveryProgress = { completed: {}, dismissed: {} };
let featureGuideScene: FeatureDiscoveryScene | undefined;
let featureGuideRevealOverride = false;
let statusTimer: number | undefined;
let bilingualPageState: BilingualPageState = { ...EMPTY_BILINGUAL_PAGE_STATE };
let configuredTargetLanguage: SupportedTargetLanguage = 'zh-CN';
let pendingBilingualLanguageSwitch: SupportedTargetLanguage | undefined;
let targetLanguageUpdatePending = false;

type PopupStatusTone = 'progress' | 'success' | 'error';

function setStatus(message: string, tone: PopupStatusTone = 'success'): void {
  if (statusTimer !== undefined) {
    window.clearTimeout(statusTimer);
    statusTimer = undefined;
  }
  if (!message) {
    status.textContent = '';
    status.removeAttribute('data-tone');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return;
  }
  status.dataset.tone = tone;
  status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  status.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  status.textContent = message;
  if (tone === 'success') {
    statusTimer = window.setTimeout(() => {
      if (status.textContent !== message) return;
      setStatus('');
    }, 2_200);
  }
}

function setControlPending(control: HTMLInputElement | HTMLSelectElement, pending: boolean): void {
  control.disabled = pending;
  control.toggleAttribute('aria-busy', pending);
}

async function providerReadinessSnapshot(
  profile: ApiProfile | undefined,
  model: string,
): Promise<ProviderReadinessSnapshot> {
  let originPattern: string | undefined;
  if (profile) {
    try {
      originPattern = apiOriginPattern(profile.apiBaseUrl);
    } catch {
      originPattern = undefined;
    }
  }
  const [apiKeyConfigured, permissionGranted, capabilities] = await Promise.all([
    profile ? hasApiKey(profile.id).catch(() => false) : Promise.resolve(false),
    originPattern
      ? browser.permissions.contains({ origins: [originPattern] }).catch(() => false)
      : Promise.resolve(false),
    profile && model.trim()
      ? getApiModelCapabilities(profile.apiBaseUrl, model).catch(() => ({}))
      : Promise.resolve({}),
  ]);
  return {
    hasProfile: Boolean(profile),
    hasValidBaseUrl: Boolean(originPattern),
    hasModel: Boolean(model.trim()),
    hasApiKey: apiKeyConfigured,
    hasPermission: permissionGranted,
    capabilities,
  };
}

function renderReadinessStatus(
  control: HTMLButtonElement,
  readiness: ApiReadinessStatus,
): void {
  const label = control.querySelector<HTMLElement>('.capability-label');
  const value = control.querySelector<HTMLElement>('.capability-value');
  if (label) label.textContent = readiness.label;
  if (value) value.textContent = readiness.value;
  control.dataset.tone = readiness.tone;
  control.title = `${readiness.label}：${readiness.detail}`;
  control.setAttribute(
    'aria-label',
    `${readiness.label}：${readiness.value}。${readiness.detail}点击打开对应设置。`,
  );
}

async function refreshApiReadiness(settings: ExtensionSettings): Promise<{
  text: ApiReadinessStatus;
  vision: ApiReadinessStatus;
}> {
  const textProfile = settings.apiProfiles.find(
    (profile) => profile.id === settings.activeApiProfileId,
  );
  const visionProfile = settings.apiProfiles.find(
    (profile) => profile.id === settings.visionApiProfileId,
  );
  const visionModel = settings.visionModel.trim() || visionProfile?.model.trim() || '';
  const [textSnapshot, visionSnapshot] = await Promise.all([
    providerReadinessSnapshot(textProfile, textProfile?.model ?? ''),
    visionProfile
      ? providerReadinessSnapshot(visionProfile, visionModel)
      : Promise.resolve(undefined),
  ]);
  const textReadiness = textApiReadiness(textSnapshot);
  const visionReadiness = visionApiReadiness(visionSnapshot);
  textApiSettingsFocus = textReadiness.settingsFocus;
  visionApiSettingsFocus = visionReadiness.settingsFocus;
  renderReadinessStatus(textApiStatus, textReadiness);
  renderReadinessStatus(visionApiStatus, visionReadiness);
  return { text: textReadiness, vision: visionReadiness };
}

function openSettingsPage(focus?: SettingsFocus): void {
  void browser.runtime.sendMessage({
    type: 'OPEN_OPTIONS_PAGE',
    ...(focus ? { payload: { focus } } : {}),
  } satisfies RuntimeMessage)
    .then((response: RuntimeResponse<{ opened: true }>) => {
      if (!response.ok) {
        setStatus('无法打开完整设置，请在扩展管理页重试。', 'error');
        return;
      }
      window.close();
    })
    .catch(() => setStatus('无法打开完整设置，请在扩展管理页重试。', 'error'));
}

function openShortcutSettings(): void {
  void browser.tabs.create({ url: 'edge://extensions/shortcuts', active: true })
    .then(() => window.close())
    .catch(() => setStatus('请手动打开 edge://extensions/shortcuts 设置快捷键。', 'error'));
}

function runReadinessAction(action: PopupReadinessAction): void {
  if (action.kind === 'shortcuts') {
    openShortcutSettings();
    return;
  }
  openSettingsPage(action.focus);
}

function renderPopupReadiness(
  textApi: ApiReadinessStatus,
  shortcut: PopupShortcutState,
): void {
  const result = popupReadiness({
    textApi,
    shortcut,
    page: popupPageState(activeUrl, generalPageMode, Boolean(activePdfContext)),
  });
  readinessPanel.dataset.state = result.issues.length ? 'issue' : 'ready';
  readinessPanel.removeAttribute('aria-busy');
  readinessTitle.textContent = result.issues.length
    ? `还需处理 ${result.issues.length} 项`
    : result.contextNote
      ? '当前页面不可使用'
      : 'Pi Translator 已就绪';
  readinessNote.textContent = result.contextNote ?? '';
  readinessIssues.replaceChildren(...result.issues.map((issue) => {
    const row = document.createElement('div');
    row.className = 'readiness-issue';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = issue.title;
    const detail = document.createElement('p');
    detail.textContent = issue.detail;
    copy.append(title, detail);
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = issue.actionLabel;
    action.addEventListener('click', () => runReadinessAction(issue.action));
    row.append(copy, action);
    return row;
  }));
  readinessIssues.hidden = result.issues.length === 0;
  readinessPanel.hidden = result.issues.length === 0 && !result.contextNote;
}

function hidePdfAccessAlert(): void {
  pdfAccessAlert.hidden = true;
  openExtensionManagement.hidden = false;
}

function showPdfAccessAlert(
  title: string,
  message: string,
  steps: string[],
  showManagement = true,
): void {
  pdfAccessTitle.textContent = title;
  pdfAccessMessage.textContent = message;
  pdfAccessSteps.replaceChildren(...steps.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  openExtensionManagement.hidden = !showManagement;
  pdfAccessAlert.hidden = false;
}

function showUnavailablePdfSource(): void {
  if (activePdfContext === 'overleaf') {
    showPdfAccessAlert(
      '无法直接继承当前 Overleaf 预览',
      '检测到了 PDF 预览，但 Overleaf 没有暴露可由 Pi PDF 读取的地址。',
      ['在 Overleaf 下载当前编译 PDF。', '再在 Pi PDF 中选择刚下载的文件。'],
      false,
    );
    return;
  }
  showPdfAccessAlert(
    'Edge 没有提供原 PDF 地址',
    '如果这是本地 PDF，通常是 Pi Translator 尚未获准访问文件 URL。',
    [
      '打开 Edge 扩展管理页并进入 Pi Translator 详情。',
      '开启“允许访问文件 URL”，返回 PDF 后再点“重新检测”。',
    ],
  );
}

function sidebarAvailableForActivePage(): boolean {
  if (activePdfContext) return true;
  if (!activeUrl) return false;
  if (isOverleafProjectUrl(activeUrl)) return true;
  return generalPageMode !== 'off' && isInjectableWebUrl(activeUrl);
}

function renderFeatureGuide(): void {
  featureGuideScene = featureDiscoverySceneForPage({
    ...(activeUrl ? { url: activeUrl } : {}),
    ...(activePdfContext ? { pdfContext: activePdfContext } : {}),
    pdfReaderUrl: browser.runtime.getURL('/pdf.html'),
  });
  if (!featureGuideScene) {
    featureGuide.hidden = true;
    featureGuideToggle.hidden = true;
    return;
  }
  const model = featureDiscoveryModel(
    featureGuideScene,
    featureGuideProgressState,
    featureGuideRevealOverride,
  );
  featureGuide.hidden = !model.shouldShow;
  featureGuideToggle.hidden = model.shouldShow;
  featureGuideToggle.textContent = model.completedCount === model.steps.length
    ? '查看用法'
    : '使用提示';
  if (!model.shouldShow) return;
  featureGuideEyebrow.textContent = model.eyebrow;
  featureGuideTitle.textContent = model.title;
  featureGuideDescription.textContent = model.description;
  featureGuideSteps.replaceChildren(...model.steps.map((step) => {
    const item = document.createElement('li');
    item.className = 'feature-guide-step';
    item.dataset.completed = String(step.completed);
    const mark = document.createElement('span');
    mark.className = 'feature-guide-step-mark';
    mark.textContent = step.completed ? '✓' : '';
    mark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = step.label;
    const detail = document.createElement('span');
    detail.textContent = step.detail;
    if (
      assignedShortcutLabel &&
      (step.id === 'web-selection' || step.id === 'overleaf-selection')
    ) {
      detail.textContent = `${step.detail} 也可按 ${assignedShortcutLabel}。`;
    }
    copy.append(label, detail);
    item.append(mark, copy);
    return item;
  }));
  featureGuideProgress.textContent = model.completedCount
    ? `已熟悉 ${model.completedCount} / ${model.steps.length}`
    : '完成后会自动记住，仅保存在本机';
  featureGuideDismiss.setAttribute(
    'aria-label',
    featureGuideRevealOverride ? '关闭使用提示' : '不再提示当前页面的用法',
  );
}

async function markFeatureGuideComplete(
  feature: FeatureDiscoveryFeature | undefined,
): Promise<void> {
  if (!feature || featureGuideProgressState.completed[feature]) return;
  await completeFeatureDiscovery(feature);
  featureGuideProgressState.completed[feature] = true;
  renderFeatureGuide();
}

function sidebarDiscoveryFeature(): FeatureDiscoveryFeature | undefined {
  if (featureGuideScene === 'web') return 'web-sidebar';
  return undefined;
}

function regionDiscoveryFeature(): FeatureDiscoveryFeature | undefined {
  if (featureGuideScene === 'web') return 'web-region';
  if (featureGuideScene === 'overleaf') return 'overleaf-region';
  return undefined;
}

function pdfDiscoveryFeature(): FeatureDiscoveryFeature {
  return featureGuideScene === 'overleaf' ? 'overleaf-pdf' : 'pdf-reader';
}

function bilingualPageAvailable(): boolean {
  return Boolean(
    activeTabId !== undefined &&
    activeUrl &&
    !activePdfContext &&
    !isOverleafProjectUrl(activeUrl) &&
    generalPageMode !== 'off' &&
    isInjectableWebUrl(activeUrl)
  );
}

function bilingualPageAction(): 'start' | BilingualPageAction {
  if (bilingualPageState.phase === 'preview') return 'confirm-start';
  if (bilingualPageState.phase === 'running') return 'pause';
  if (
    bilingualPageState.phase === 'paused' ||
    bilingualPageState.phase === 'stopped' ||
    (bilingualPageState.phase === 'error' && bilingualPageState.total > 0) ||
    (bilingualPageState.phase === 'complete' && bilingualPageState.failed > 0)
  ) return 'resume';
  if (bilingualPageState.phase === 'complete') return 'clear';
  return 'start';
}

function renderBilingualPageAction(): void {
  if (pendingBilingualLanguageSwitch === bilingualPageState.targetLanguage) {
    pendingBilingualLanguageSwitch = undefined;
  }
  const activeTargetLanguage = isSupportedTargetLanguage(bilingualPageState.targetLanguage)
    ? bilingualPageState.targetLanguage
    : undefined;
  targetLanguage.value = activeTargetLanguage ?? configuredTargetLanguage;
  targetLanguage.disabled = targetLanguageUpdatePending;
  const languageConfirmation = pendingBilingualLanguageSwitch
    ? bilingualPageLanguageSwitchConfirmation(
        bilingualPageState,
        pendingBilingualLanguageSwitch,
      )
    : undefined;
  bilingualLanguageConfirmation.hidden = !languageConfirmation;
  bilingualLanguageMessage.textContent = languageConfirmation ?? '';
  bilingualLanguageCancel.disabled = targetLanguageUpdatePending;
  bilingualLanguageConfirm.disabled = targetLanguageUpdatePending;
  if (!languageConfirmation) pendingBilingualLanguageSwitch = undefined;
  translatePage.dataset.phase = bilingualPageState.phase;
  translatePage.textContent = bilingualPageState.phase === 'running'
    ? `暂停正文翻译 · ${bilingualPageState.translated}/${bilingualPageState.total}`
    : bilingualPageState.phase === 'preview'
      ? `确认翻译 ${bilingualPageState.total} 段`
      : bilingualPageState.phase === 'paused'
        ? bilingualPageState.pauseReason === 'interactive'
          ? '划词翻译中 · 正文稍后继续'
          : `继续正文翻译 · ${bilingualPageState.translated}/${bilingualPageState.total}`
        : bilingualPageState.phase === 'stopped'
          ? `继续双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
          : bilingualPageState.phase === 'error' && bilingualPageState.total > 0
            ? `重试双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
            : bilingualPageState.phase === 'complete' && bilingualPageState.failed > 0
              ? `重试 ${bilingualPageState.failed} 段 · ${bilingualPageState.translated}/${bilingualPageState.total}`
              : bilingualPageState.phase === 'complete'
                ? `清除双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
                : '翻译网页正文';
  const restoredHint = bilingualPageState.restored
    ? bilingualPageState.restoredFrom === 'local'
      ? `已从本机恢复 ${bilingualPageState.restored} 段译文。`
      : `已从当前浏览器会话恢复 ${bilingualPageState.restored} 段译文。`
    : '';
  translatePage.title = restoredHint || bilingualPageState.message || (
    bilingualPageState.phase === 'idle'
      ? '保留网页原文，在正文段落下方渐进显示译文'
      : '正文译文只保留在当前标签页，可随时暂停、停止或清除'
  );
  translatePage.disabled = bilingualPageState.pauseReason === 'interactive';
}

async function applyPopupTargetLanguage(
  requestedLanguage: SupportedTargetLanguage,
  restartBilingualPage: boolean,
): Promise<void> {
  if (targetLanguageUpdatePending) return;
  const previousConfiguredLanguage = configuredTargetLanguage;
  const tabId = activeTabId;
  let settingsUpdated = false;
  targetLanguageUpdatePending = true;
  renderBilingualPageAction();
  setStatus(
    restartBilingualPage
      ? `正在清除并改译为${supportedTargetLanguageLabel(requestedLanguage)}…`
      : '正在更新目标语言…',
    'progress',
  );
  try {
    await mutateSettings((settings) => ({
      nextSettings: {
        ...settings,
        targetLanguage: requestedLanguage,
      },
      value: undefined,
    }));
    configuredTargetLanguage = requestedLanguage;
    settingsUpdated = true;
    if (restartBilingualPage && tabId !== undefined) {
      const response = await browser.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId, targetLanguage: requestedLanguage },
      } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
      if (!response?.ok) {
        throw new Error(response?.error.message ?? '当前正文改译失败。');
      }
      if (activeTabId !== tabId) return;
      bilingualPageState = response.data.state;
      pendingBilingualLanguageSwitch = undefined;
      setStatus(`已开始改译为${supportedTargetLanguageLabel(requestedLanguage)}。`);
    } else {
      setStatus('目标语言已更新。');
    }
  } catch (error) {
    if (!settingsUpdated) configuredTargetLanguage = previousConfiguredLanguage;
    setStatus(
      settingsUpdated && restartBilingualPage
        ? `目标语言已保存，但当前正文没有改译：${error instanceof Error ? error.message : '请重试。'}`
        : '目标语言更新失败，已保留原设置。',
      'error',
    );
  } finally {
    targetLanguageUpdatePending = false;
    updateQuickActions();
  }
}

async function refreshBilingualPageState(): Promise<void> {
  if (!bilingualPageAvailable() || activeTabId === undefined) {
    bilingualPageState = { ...EMPTY_BILINGUAL_PAGE_STATE };
    return;
  }
  const response = await browser.runtime.sendMessage({
    type: 'GET_BILINGUAL_PAGE_STATE',
    payload: { tabId: activeTabId },
  } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
  bilingualPageState = response?.ok
    ? response.data.state
    : { ...EMPTY_BILINGUAL_PAGE_STATE };
}

function updateQuickActions(): void {
  openPdf.textContent = activePdfSourceUrl
    ? activePdfContext === 'overleaf'
      ? '用 Pi 打开当前 Overleaf PDF'
      : '用 Pi 打开当前 PDF'
    : activePdfContext === 'overleaf'
      ? '查看 Overleaf PDF 打开指引'
      : activePdfContext === 'native'
        ? '解决 PDF 读取权限'
        : '打开 PDF 阅读器';
  const sidebarAvailable = sidebarAvailableForActivePage();
  const pageTranslationAvailable = bilingualPageAvailable();
  const webRegionAvailable = Boolean(
    activeUrl && (
      isOverleafProjectUrl(activeUrl) ||
      (!activePdfContext && generalPageMode !== 'off' && isInjectableWebUrl(activeUrl))
    ),
  );
  const pdfIsCurrent = Boolean(activePdfContext);
  const pdfIsPrimary = pdfIsCurrent || (!sidebarAvailable && !pageTranslationAvailable);
  const primaryAction = pdfIsPrimary
    ? openPdf
    : pageTranslationAvailable
      ? translatePage
      : openSidebar;
  const secondaryAction = pdfIsPrimary ? openSidebar : openPdf;
  openPdf.classList.remove('primary-action', 'secondary-action');
  openSidebar.classList.remove('primary-action', 'secondary-action');
  translatePage.classList.remove('primary-action');
  openSidebar.classList.toggle('sidebar-action', pageTranslationAvailable);
  primaryAction.classList.add('primary-action');
  if (sidebarAvailable) secondaryAction.classList.add('secondary-action');
  openSidebar.hidden = !sidebarAvailable;
  translatePage.hidden = !pageTranslationAvailable;
  openWebRegion.hidden = !webRegionAvailable;
  renderBilingualPageAction();
  openSidebar.textContent = pdfIsCurrent
    ? '打开翻译侧栏'
    : sidebarMode === 'browser'
      ? '在浏览器侧栏中翻译'
      : '打开翻译侧栏';
  openWebRegion.textContent = '框选当前网页';
  if (pdfIsCurrent) {
    pageContext.textContent = '当前是 PDF：用 Pi PDF 阅读，或直接打开翻译侧栏。';
    pageContext.removeAttribute('data-tone');
  } else if (sidebarAvailable) {
    pageContext.textContent = isOverleafProjectUrl(activeUrl ?? '')
      ? '在 Overleaf 选中文字即可翻译；预览、公式和图表可使用框选。'
      : '长文章可直接开启双语正文；短内容划词，图表和不可选内容使用框选。';
    pageContext.removeAttribute('data-tone');
  } else if (activeUrl && !isInjectableWebUrl(activeUrl)) {
    pageContext.textContent = '当前页面受 Edge 限制，请切换到普通网页、Overleaf 或 PDF。';
    pageContext.dataset.tone = 'restricted';
  } else {
    pageContext.textContent = '打开 PDF 阅读器，或在普通网页中使用划词翻译。';
    pageContext.removeAttribute('data-tone');
  }
  quickActions.dataset.primary = pdfIsCurrent
    ? 'pdf'
    : pageTranslationAvailable
      ? 'article'
      : sidebarAvailable
        ? 'sidebar'
        : 'reader';
  quickActions.prepend(primaryAction);
  quickActions.removeAttribute('aria-busy');
  renderFeatureGuide();
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
        '开启“允许访问文件 URL”，返回当前 PDF 后重新检测。',
      ],
    );
    return false;
  }
  const origin = pdfPermissionPattern(sourceUrl);
  if (!origin) return true;
  let granted = false;
  try {
    // Keep the permission request as the first asynchronous browser call for
    // remote PDFs so Edge can reliably associate it with the user's click.
    // Requesting an already-granted origin simply resolves to true.
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
        '授权后再次点击“用 Pi 打开当前 PDF”。',
      ],
    );
    return false;
  }
  hidePdfAccessAlert();
  return true;
}

async function resolveActivePdfContext(tab: {
  id?: number | undefined;
  url?: string | undefined;
}): Promise<void> {
  activeUrl = tab.url;
  activePdfSourceUrl = undefined;
  activePdfPage = undefined;
  activePdfContext = undefined;
  const pdfContext = { ...(activeUrl ? { tabUrl: activeUrl } : {}) };
  if (isEdgeNativePdfContext(pdfContext)) {
    activePdfContext = 'native';
    activePdfSourceUrl = edgePdfSourceUrl(pdfContext);
    activePdfPage = pdfInitialPage(activeUrl) ?? pdfInitialPage(activePdfSourceUrl);
    return;
  }
  if (!activeUrl || !isOverleafProjectUrl(activeUrl) || tab.id === undefined) return;
  let response: ActivePdfSourceResponse | undefined;
  try {
    response = await browser.tabs.sendMessage(
      tab.id,
      { type: 'GET_ACTIVE_PDF_SOURCE' } satisfies RuntimeMessage,
      { frameId: 0 },
    ) as ActivePdfSourceResponse | undefined;
  } catch {
    return;
  }
  if (!response?.ok || !response.data.detected) return;
  activePdfContext = 'overleaf';
  activePdfSourceUrl = response.data.sourceUrl;
  activePdfPage = pdfInitialPage(activePdfSourceUrl);
}

async function load(): Promise<void> {
  const [settings, tabs, pausedSiteHosts, commands, discoveryProgress] = await Promise.all([
    getSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
    getPausedSiteHosts(),
    browser.commands.getAll().catch(() => undefined),
    getFeatureDiscoveryProgress().catch(() => ({ completed: {}, dismissed: {} })),
  ]);
  featureGuideProgressState = discoveryProgress;
  configuredTargetLanguage = isSupportedTargetLanguage(settings.targetLanguage)
    ? settings.targetLanguage
    : 'zh-CN';
  targetLanguage.value = configuredTargetLanguage;
  apiProfile.replaceChildren(...settings.apiProfiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    return option;
  }));
  apiProfile.value = settings.activeApiProfileId;
  apiProfileField.hidden = settings.apiProfiles.length <= 1;
  generalPageMode = settings.generalPageMode;
  sidebarMode = settings.sidebarMode;
  activeTabId = tabs[0]?.id;
  await resolveActivePdfContext(tabs[0] ?? {});
  await refreshBilingualPageState().catch(() => {
    bilingualPageState = { ...EMPTY_BILINGUAL_PAGE_STATE };
  });
  updateQuickActions();
  if (activePdfContext && !activePdfSourceUrl) showUnavailablePdfSource();
  else hidePdfAccessAlert();
  const hostname = sidebarAvailableForActivePage() && !activePdfContext && activeUrl
    ? siteHostFromUrl(activeUrl)
    : undefined;
  if (!hostname) {
    siteControl.hidden = true;
    siteName.textContent = '';
    pauseSite.checked = false;
    pauseSite.disabled = true;
  } else {
    siteName.textContent = hostname;
    pauseSite.checked = isSiteHostPaused(hostname, pausedSiteHosts);
    pauseSite.disabled = false;
    siteControl.hidden = false;
  }
  const readiness = await refreshApiReadiness(settings);
  assignedShortcutLabel = commands ? assignedTranslationShortcut(commands) : undefined;
  popupShortcutState = commands
    ? assignedShortcutLabel ? 'assigned' : 'missing'
    : 'unknown';
  renderPopupReadiness(readiness.text, popupShortcutState);
  renderFeatureGuide();
}

targetLanguage.addEventListener('change', () => {
  if (!isSupportedTargetLanguage(targetLanguage.value)) {
    renderBilingualPageAction();
    return;
  }
  const requestedLanguage = targetLanguage.value;
  const activeTargetLanguage = isSupportedTargetLanguage(bilingualPageState.targetLanguage)
    ? bilingualPageState.targetLanguage
    : undefined;
  if (!activeTargetLanguage || requestedLanguage === activeTargetLanguage) {
    void applyPopupTargetLanguage(requestedLanguage, false);
    return;
  }
  targetLanguage.value = activeTargetLanguage;
  if (bilingualPageLanguageSwitchConfirmation(bilingualPageState, requestedLanguage)) {
    pendingBilingualLanguageSwitch = requestedLanguage;
    renderBilingualPageAction();
    return;
  }
  void applyPopupTargetLanguage(requestedLanguage, true);
});
bilingualLanguageCancel.addEventListener('click', () => {
  pendingBilingualLanguageSwitch = undefined;
  renderBilingualPageAction();
  const language = isSupportedTargetLanguage(bilingualPageState.targetLanguage)
    ? supportedTargetLanguageLabel(bilingualPageState.targetLanguage)
    : supportedTargetLanguageLabel(configuredTargetLanguage);
  setStatus(`已保留当前${language}正文。`);
});
bilingualLanguageConfirm.addEventListener('click', () => {
  const requestedLanguage = pendingBilingualLanguageSwitch;
  if (!requestedLanguage) return;
  void applyPopupTargetLanguage(requestedLanguage, true);
});

apiProfile.addEventListener('change', () => {
  const requestedProfileId = apiProfile.value;
  setControlPending(apiProfile, true);
  setStatus('正在切换翻译接口…', 'progress');
  void (async () => {
    const settings = await getSettings();
    const profile = settings.apiProfiles.find((candidate) => candidate.id === requestedProfileId);
    if (!profile) throw new Error('The selected API profile no longer exists.');
    const granted = await browser.permissions.request({
      origins: [apiOriginPattern(profile.apiBaseUrl)],
    });
    if (!granted) throw new Error('API access was not granted.');
    await activateApiProfile(requestedProfileId);
    const readiness = await refreshApiReadiness(await getSettings());
    renderPopupReadiness(readiness.text, popupShortcutState);
    setStatus('翻译接口已切换。');
  })().catch(async () => {
    const settings = await getSettings().catch(() => undefined);
    if (settings) apiProfile.value = settings.activeApiProfileId;
    setStatus('未获得该接口的访问权限，仍使用原配置。', 'error');
  }).finally(() => setControlPending(apiProfile, false));
});

pauseSite.addEventListener('change', () => {
  if (!activeUrl) return;
  const requestedPaused = pauseSite.checked;
  setControlPending(pauseSite, true);
  setStatus(requestedPaused ? '正在暂停当前网站…' : '正在恢复当前网站…', 'progress');
  void setSitePaused(activeUrl, requestedPaused)
    .then((hostname) => {
      if (!hostname) pauseSite.checked = !requestedPaused;
      setStatus(
        hostname
          ? requestedPaused
            ? `已暂停 ${hostname} 的自动划词。`
            : `已恢复 ${hostname} 的自动划词。`
          : '当前页面不支持此操作。',
        hostname ? 'success' : 'error',
      );
    })
    .catch(() => {
      pauseSite.checked = !requestedPaused;
      setStatus('当前网站状态更新失败，已恢复原状态。', 'error');
    })
    .finally(() => setControlPending(pauseSite, false));
});

featureGuideToggle.addEventListener('click', () => {
  featureGuideRevealOverride = true;
  renderFeatureGuide();
  featureGuideTitle.focus({ preventScroll: true });
});

featureGuideDismiss.addEventListener('click', () => {
  const scene = featureGuideScene;
  if (!scene) return;
  featureGuideDismiss.disabled = true;
  void (async () => {
    if (!featureGuideRevealOverride) {
      await dismissFeatureDiscovery(scene);
      featureGuideProgressState.dismissed[scene] = true;
    }
    featureGuideRevealOverride = false;
    renderFeatureGuide();
  })().catch(() => {
    setStatus('使用提示状态未能保存，请稍后再试。', 'error');
  }).finally(() => {
    featureGuideDismiss.disabled = false;
  });
});

openSettings.addEventListener('click', () => {
  openSettingsPage();
});

textApiStatus.addEventListener('click', () => openSettingsPage(textApiSettingsFocus));
visionApiStatus.addEventListener('click', () => openSettingsPage(visionApiSettingsFocus));

translatePage.addEventListener('click', () => {
  if (activeTabId === undefined) return;
  if (!isSupportedTargetLanguage(targetLanguage.value)) {
    setStatus('当前目标语言不支持网页正文翻译。', 'error');
    return;
  }
  const action = bilingualPageAction();
  translatePage.disabled = true;
  setStatus(
    action === 'start'
      ? '正在识别网页正文…'
      : action === 'clear'
        ? '正在清除双语正文…'
        : '正在更新正文翻译状态…',
    'progress',
  );
  const request = action === 'start'
    ? browser.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: {
          tabId: activeTabId,
          targetLanguage: targetLanguage.value,
        },
      } satisfies RuntimeMessage)
    : browser.runtime.sendMessage({
        type: 'CONTROL_BILINGUAL_PAGE',
        payload: { tabId: activeTabId, action },
      } satisfies RuntimeMessage);
  void (request as Promise<BilingualPageStateResponse | undefined>)
    .then((response) => {
      if (!response?.ok) throw new Error(response?.error.message ?? '正文翻译操作失败。');
      bilingualPageState = response.data.state;
      updateQuickActions();
      if (bilingualPageState.phase === 'error') {
        setStatus(bilingualPageState.message ?? '当前页面没有识别到可翻译的正文。', 'error');
        return;
      }
      window.close();
    })
    .catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : '正文翻译操作失败。', 'error');
    })
    .finally(() => {
      translatePage.disabled = false;
    });
});

openSidebar.addEventListener('click', () => {
  if (sidebarMode === 'browser' && !activePdfContext && activeTabId !== undefined) {
    void browser.sidePanel.open({ tabId: activeTabId })
      .then(async () => {
        await markFeatureGuideComplete(sidebarDiscoveryFeature()).catch(() => undefined);
        window.close();
      })
      .catch(() => setStatus('当前页面无法打开浏览器侧栏，请刷新后重试。', 'error'));
    return;
  }
  void browser.runtime.sendMessage({ type: 'OPEN_SIDEBAR' } satisfies RuntimeMessage)
    .then(async (response: RuntimeResponse<{ opened: true }> | undefined) => {
      if (!response?.ok) {
        setStatus('当前页面无法打开侧栏，请刷新后重试。', 'error');
        return;
      }
      await markFeatureGuideComplete(sidebarDiscoveryFeature()).catch(() => undefined);
      window.close();
    })
    .catch(() => setStatus('当前页面无法打开侧栏，请刷新后重试。', 'error'));
});

openWebRegion.addEventListener('click', () => {
  setStatus('正在进入网页框选…', 'progress');
  openWebRegion.disabled = true;
  void browser.runtime.sendMessage({
    type: 'START_WEB_REGION_SELECTION',
  } satisfies RuntimeMessage).then(async (response: RuntimeResponse<{ started: true }> | undefined) => {
    if (!response?.ok) {
      setStatus('当前页面无法框选，请刷新页面后重试。', 'error');
      return;
    }
    await markFeatureGuideComplete(regionDiscoveryFeature()).catch(() => undefined);
    window.close();
  }).catch(() => {
    setStatus('当前页面无法框选，请刷新页面后重试。', 'error');
  }).finally(() => {
    openWebRegion.disabled = false;
  });
});

openPdf.addEventListener('click', () => {
  void (async () => {
    const sourceUrl = activePdfSourceUrl;
    if (activePdfContext && !sourceUrl) {
      showUnavailablePdfSource();
      return;
    }
    if (sourceUrl && !await requestPdfSourceAccess(sourceUrl)) return;
    const response = (await browser.runtime.sendMessage({
      type: 'OPEN_PDF_VIEWER',
      ...(sourceUrl
        ? {
            payload: {
              url: sourceUrl,
              ...(activePdfPage ? { page: activePdfPage } : {}),
            },
          }
        : {}),
    } satisfies RuntimeMessage)) as RuntimeResponse<{ opened: true }> | undefined;
    if (!response?.ok) throw new Error(response?.error.message ?? 'PDF reader did not open.');
    await markFeatureGuideComplete(pdfDiscoveryFeature()).catch(() => undefined);
    window.close();
  })().catch(() => setStatus('无法打开 PDF 阅读器，请重新加载扩展后再试。', 'error'));
});

openExtensionManagement.addEventListener('click', () => {
  void browser.tabs.create({
    url: `edge://extensions/?id=${browser.runtime.id}`,
    active: true,
  }).catch(() => setStatus('请手动打开 edge://extensions 并进入 Pi Translator 详情。', 'error'));
});

retryPdfAccess.addEventListener('click', () => {
  void (async () => {
    if (activePdfSourceUrl) {
      if (await requestPdfSourceAccess(activePdfSourceUrl)) {
        setStatus('PDF 读取权限已就绪。');
      }
      return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await resolveActivePdfContext(tab ?? {});
    updateQuickActions();
    if (activePdfSourceUrl) {
      hidePdfAccessAlert();
      setStatus('已重新识别当前 PDF。');
    } else if (activePdfContext) {
      showUnavailablePdfSource();
    }
  })().catch(() => showUnavailablePdfSource());
});

void load().catch(() => {
  updateQuickActions();
  setStatus('读取扩展状态失败，请重新打开面板。', 'error');
});
