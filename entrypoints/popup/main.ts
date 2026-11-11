import { t, msg, initializeUiLanguage, localizeUiDocument } from '../../core/i18n/ui-language';
import {bindActionHints} from '../../ui/action-feedback';
import {bindActionGuide} from '../../ui/action-guide';
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
  isSiteHostPaused,
  siteHostFromUrl,
} from '../../core/settings/site-pause';
import {
  getEffectivePausedSiteHosts, getSiteReadingPreferences, saveSiteReadingPreference,
  setSiteReadingPaused, siteReadingPreferenceForUrl,
} from '../../core/settings/site-reading-preferences';
import {
  edgePdfSourceUrl,
  isEdgeNativePdfContext,
  parsePdfSourceUrl,
  pdfInitialPage,
  pdfPermissionPattern,
} from '../../core/pdf/source';
import { getAutoInjectionPatterns, isGeneralPageAllowed, isInjectableWebUrl, isOverleafProjectUrl } from '../../core/settings/site-access';
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

async function startUi(): Promise<void> {
  await initializeUiLanguage();
  localizeUiDocument();
  bindActionHints();
  bindActionGuide(document,['#popup-more-body'],[
    {label:t('打开 PDF 阅读器'),selector:'#open-pdf'},
    {label:t('框选当前网页'),selector:'#open-web-region'},
    {label:t('文档库'),selector:'#open-library'},
    {label:t('设置'),selector:'#open-settings'},
    {label:t('目标语言'),selector:'#target-language'},
  ]);


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
const rememberSite = element<HTMLInputElement>('remember-site');
const resetSite = element<HTMLButtonElement>('reset-site');
const sitePreferenceHelp = element<HTMLParagraphElement>('site-preference-help');
let rememberedSite = false;
let globalTargetLanguage: SupportedTargetLanguage = 'zh-CN';
const status = element<HTMLParagraphElement>('status');
const quickActions = element<HTMLElement>('quick-actions');
let apiSetupAction:HTMLButtonElement|undefined;
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
const serviceDetails = element<HTMLDetailsElement>('popup-service-details');
const serviceState = element<HTMLElement>('popup-service-state');
const moreActions = element<HTMLDetailsElement>('popup-more-actions');
const moreBody = element<HTMLElement>('popup-more-body');
const selectionHelp = element<HTMLDetailsElement>('selection-help');
const selectionHelpStatus = element<HTMLParagraphElement>('selection-help-status');
const selectionHelpAction = element<HTMLButtonElement>('selection-help-action');
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
let bilingualPageStateRead: 'pending' | 'ready' | 'error' = 'pending';
let bilingualPageStateReadVersion = 0;
let configuredTargetLanguage: SupportedTargetLanguage = 'zh-CN';
let pendingBilingualLanguageSwitch: SupportedTargetLanguage | undefined;
let targetLanguageUpdatePending = false;
let selectionHelpRevision = 0;

async function refreshSelectionHelp(): Promise<void> {
  const revision = ++selectionHelpRevision;
  selectionHelpStatus.textContent = t('正在检查当前网站…');
  selectionHelpAction.hidden = true;
  try {
    const [settings, paused] = await Promise.all([getSettings(), getEffectivePausedSiteHosts()]);
    if (revision !== selectionHelpRevision || !selectionHelp.open) return;
    const url = activeUrl;
    let message: string;
    let action: 'resume' | 'settings' | undefined;
    if (!url || activePdfContext || !isInjectableWebUrl(url)) {
      message = t('当前页面不支持普通网页划词；请在普通网页中使用，或打开 PDF 阅读器。');
    } else if (isSiteHostPaused(siteHostFromUrl(url) ?? '', paused)) {
      message = t('此网站已暂停自动划词。恢复后可重新选择文字。');
      action = 'resume';
    } else if (isOverleafProjectUrl(url)) {
      message = settings.showFloatingButtonOnOverleaf
        ? t('请重新选择文字；若仍未出现，请刷新页面后重试。')
        : t('Overleaf 浮动按钮已关闭，可在网页设置中开启。');
      if (!settings.showFloatingButtonOnOverleaf) action = 'settings';
    } else if (!isGeneralPageAllowed(url, settings)) {
      message = t('当前网站不在自动划词范围内，可在网页设置中调整范围。');
      action = 'settings';
    } else if (settings.generalPageMode === 'on-demand') {
      message = t('当前为按需模式，默认不显示自动划词按钮；可在网页设置中启用并授权。');
      action = 'settings';
    } else {
      const patterns = getAutoInjectionPatterns(settings.generalPageMode, settings.siteAllowlist);
      const granted = patterns.length > 0 && await browser.permissions.contains({ origins: patterns });
      if (revision !== selectionHelpRevision || !selectionHelp.open) return;
      message = granted
        ? settings.hideFloatingButtonForTargetLanguage
          ? t('已开启智能隐藏：选区可能被识别为目标语言。也可刷新页面或使用右键翻译。')
          : t('请重新选择文字；若仍未出现，请刷新页面后重试，或使用右键翻译。')
        : t('网站访问权限可能尚未开启；请在网页设置中检查并授权。');
      if (!granted) action = 'settings';
    }
    selectionHelpStatus.textContent = message;
    selectionHelpAction.dataset.action = action ?? '';
    selectionHelpAction.textContent = action === 'resume' ? t('恢复划词') : t('打开网页设置');
    selectionHelpAction.hidden = !action;
  } catch {
    if (revision !== selectionHelpRevision || !selectionHelp.open) return;
    selectionHelpStatus.textContent = t('暂时无法检查，请打开网页设置查看。');
    selectionHelpAction.dataset.action = 'settings';
    selectionHelpAction.textContent = t('打开网页设置');
    selectionHelpAction.hidden = false;
  }
}

selectionHelp.addEventListener('toggle', () => {
  if (selectionHelp.open) void refreshSelectionHelp();
  else selectionHelpRevision++;
});
selectionHelpAction.addEventListener('click', () => {
  if (selectionHelpAction.dataset.action === 'resume' && pauseSite.checked && !pauseSite.disabled) {
    pauseSite.click();
  } else if (selectionHelpAction.dataset.action === 'settings') openSettingsPage('pages');
});

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
    msg`${readiness.label}：${readiness.value}。${readiness.detail}点击打开对应设置。`,
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
        setStatus(t('无法打开完整设置，请在扩展管理页重试。'), 'error');
        return;
      }
      window.close();
    })
    .catch(() => setStatus(t('无法打开完整设置，请在扩展管理页重试。'), 'error'));
}

function openShortcutSettings(): void {
  void browser.tabs.create({ url: 'edge://extensions/shortcuts', active: true })
    .then(() => window.close())
    .catch(() => setStatus(t('请手动打开 edge://extensions/shortcuts 设置快捷键。'), 'error'));
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
  const blocking = result.issues.filter(issue=>issue.id!=='shortcut');
  const issues = blocking.length ? blocking : result.issues;
  apiSetupAction?.remove();
  apiSetupAction=undefined;
  readinessPanel.dataset.state = issues.length ? 'issue' : 'ready';
  readinessPanel.removeAttribute('aria-busy');
  readinessTitle.textContent = issues.length
    ? msg`还需处理 ${issues.length} 项`
    : result.contextNote
      ? t('当前页面不可使用')
      : t('Pi Translator 已就绪');
  readinessNote.textContent = result.contextNote ?? '';
  readinessIssues.replaceChildren(...issues.map((issue) => {
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
    if(issue.id==='text-api'){
      action.id='popup-setup-primary';
      action.className='primary-action';
      if(issue.action.kind==='settings'&&issue.action.focus==='api')action.textContent=t('完成配置');
      apiSetupAction=action;
      detail.hidden=true;
      detail.id='popup-api-setup-help';
      action.title=issue.detail;
      action.setAttribute('aria-describedby',detail.id);
    }
    action.addEventListener('click', () => runReadinessAction(issue.action));
    row.append(copy);
    if(issue.id!=='text-api')row.append(action);
    return row;
  }));
  readinessIssues.hidden = result.issues.length === 0;
  readinessPanel.hidden = result.issues.length === 0 && !result.contextNote;
  const needsSetup = blocking.length>0;
  serviceDetails.dataset.blocking = String(needsSetup);
  serviceState.textContent = needsSetup ? t('需要配置') : result.contextNote ? t('页面受限') : msg`文字${textApi.value}${shortcut==='missing'?t(' · 快捷键未设'):shortcut==='unknown'?t(' · 快捷键待检查'):''}`;
  serviceState.dataset.tone = needsSetup ? 'issue' : 'ready';
  // Missing shortcuts do not block translation. Only reveal blocking setup automatically.
  if (needsSetup) {
    serviceDetails.open = true;
    quickActions.before(serviceDetails);
  } else {
    moreBody.append(serviceDetails);
    if (result.contextNote) serviceDetails.open = true;
  }
  updateQuickActions();
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
      t('无法直接继承当前 Overleaf 预览'),
      t('检测到了 PDF 预览，但 Overleaf 没有暴露可由 Pi PDF 读取的地址。'),
      [t('在 Overleaf 下载当前编译 PDF。'), t('再在 Pi PDF 中选择刚下载的文件。')],
      false,
    );
    return;
  }
  showPdfAccessAlert(
    t('Edge 没有提供原 PDF 地址'),
    t('如果这是本地 PDF，通常是 Pi Translator 尚未获准访问文件 URL。'),
    [
      t('打开 Edge 扩展管理页并进入 Pi Translator 详情。'),
      t('开启“允许访问文件 URL”，返回 PDF 后再点“重新检测”。'),
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
  featureGuide.hidden = !featureGuideRevealOverride;
  featureGuideToggle.hidden = featureGuideRevealOverride;
  featureGuideToggle.setAttribute('aria-expanded', String(featureGuideRevealOverride));
  featureGuideToggle.textContent = model.completedCount === model.steps.length
    ? t('查看用法')
    : t('使用提示');
  if (!featureGuideRevealOverride) return;
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
      detail.textContent = msg`${step.detail} 也可按 ${assignedShortcutLabel}。`;
    }
    copy.append(label, detail);
    item.append(mark, copy);
    return item;
  }));
  featureGuideProgress.textContent = model.completedCount
    ? msg`已熟悉 ${model.completedCount} / ${model.steps.length}`
    : t('完成后会自动记住，仅保存在本机');
  featureGuideDismiss.setAttribute(
    'aria-label',
    t('关闭使用提示'),
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
  const stateUnavailable = bilingualPageAvailable() && bilingualPageStateRead !== 'ready';
  targetLanguage.disabled = targetLanguageUpdatePending || stateUnavailable;
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
    ? msg`暂停正文翻译 · ${bilingualPageState.translated}/${bilingualPageState.total}`
    : bilingualPageState.phase === 'preview'
      ? msg`确认翻译 ${bilingualPageState.total} 段`
      : bilingualPageState.phase === 'paused'
        ? bilingualPageState.pauseReason === 'interactive'
          ? t('划词翻译中 · 正文稍后继续')
          : msg`继续正文翻译 · ${bilingualPageState.translated}/${bilingualPageState.total}`
        : bilingualPageState.phase === 'stopped'
          ? msg`继续双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
          : bilingualPageState.phase === 'error' && bilingualPageState.total > 0
            ? msg`重试双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
            : bilingualPageState.phase === 'complete' && bilingualPageState.failed > 0
              ? msg`重试 ${bilingualPageState.failed} 段 · ${bilingualPageState.translated}/${bilingualPageState.total}`
              : bilingualPageState.phase === 'complete'
                ? msg`清除双语正文 · ${bilingualPageState.translated}/${bilingualPageState.total}`
                : t('翻译网页正文');
  const restoredHint = bilingualPageState.restored
    ? bilingualPageState.restoredFrom === 'local'
      ? msg`已从本机恢复 ${bilingualPageState.restored} 段译文。`
      : msg`已从当前浏览器会话恢复 ${bilingualPageState.restored} 段译文。`
    : '';
  translatePage.title = restoredHint || bilingualPageState.message || (
    bilingualPageState.phase === 'idle'
      ? t('保留网页原文，在正文段落下方渐进显示译文')
      : t('正文译文只保留在当前标签页，可随时暂停、停止或清除')
  );
  translatePage.disabled = bilingualPageState.pauseReason === 'interactive';
  if (stateUnavailable) {
    translatePage.dataset.phase = bilingualPageStateRead;
    translatePage.textContent = bilingualPageStateRead === 'pending'
      ? t('正在读取…') : t('重新读取正文状态');
    translatePage.title = t('正文状态暂未读到，可重试；已有译文不会被清除。');
    translatePage.disabled = bilingualPageStateRead === 'pending';
  }
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
  rememberSite.disabled = true;
  resetSite.disabled = true;
  pauseSite.disabled = true;
  renderBilingualPageAction();
  setStatus(
    restartBilingualPage
      ? msg`正在清除并改译为${supportedTargetLanguageLabel(requestedLanguage)}…`
      : t('正在更新目标语言…'),
    'progress',
  );
  try {
    if (rememberedSite && activeUrl) {
      await saveSiteReadingPreference(activeUrl, { targetLanguage: requestedLanguage, paused: pauseSite.checked });
    } else {
      await mutateSettings((settings) => ({
        nextSettings: { ...settings, targetLanguage: requestedLanguage },
        value: undefined,
      }));
      globalTargetLanguage = requestedLanguage;
    }
    configuredTargetLanguage = requestedLanguage;
    settingsUpdated = true;
    if (restartBilingualPage && tabId !== undefined) {
      const response = await browser.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId, targetLanguage: requestedLanguage },
      } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
      if (!response?.ok) {
        throw new Error(response?.error.message ?? t('当前正文改译失败。'));
      }
      if (activeTabId !== tabId) return;
      bilingualPageState = response.data.state;
      pendingBilingualLanguageSwitch = undefined;
      setStatus(msg`已开始改译为${supportedTargetLanguageLabel(requestedLanguage)}。`);
    } else {
      setStatus(t('目标语言已更新。'));
    }
  } catch (error) {
    if (!settingsUpdated) configuredTargetLanguage = previousConfiguredLanguage;
    setStatus(
      settingsUpdated && restartBilingualPage
        ? msg`目标语言已保存，但当前正文没有改译：${error instanceof Error ? error.message : t('请重试。')}`
        : t('目标语言更新失败，已保留原设置。'),
      'error',
    );
  } finally {
    targetLanguageUpdatePending = false;
    rememberSite.disabled = false;
    resetSite.disabled = false;
    pauseSite.disabled = false;
    updateQuickActions();
  }
}

async function refreshBilingualPageState(): Promise<void> {
  const version = ++bilingualPageStateReadVersion;
  const readError = t('正文状态暂未读到，可重试；已有译文不会被清除。');
  const render = () => {
    updateQuickActions();
    const unavailable = bilingualPageAvailable() && bilingualPageStateRead !== 'ready';
    for (const control of [rememberSite, resetSite, pauseSite]) {
      control.disabled = unavailable || targetLanguageUpdatePending || siteControl.hidden;
    }
  };
  if (!bilingualPageAvailable() || activeTabId === undefined) {
    bilingualPageState = { ...EMPTY_BILINGUAL_PAGE_STATE };
    bilingualPageStateRead = 'ready';
    render();
    return;
  }
  bilingualPageStateRead = 'pending';
  if (status.textContent === readError) setStatus('');
  render();
  const failed = () => {
    bilingualPageStateRead = 'error';
    render();
    if (!status.textContent || status.textContent === readError) setStatus(readError, 'error');
  };
  const timer = window.setTimeout(() => {
    if (version !== bilingualPageStateReadVersion) return;
    // The native message cannot be aborted; invalidate its late UI reply.
    bilingualPageStateReadVersion += 1;
    failed();
  }, 3_000);
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_BILINGUAL_PAGE_STATE',
      payload: { tabId: activeTabId },
    } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
    if (version !== bilingualPageStateReadVersion) return;
    if (!response?.ok) throw new Error('Page status unavailable');
    bilingualPageState = response.data.state;
    bilingualPageStateRead = 'ready';
    render();
    if (status.textContent === readError) setStatus('');
  } catch {
    if (version === bilingualPageStateReadVersion) failed();
  } finally {
    window.clearTimeout(timer);
  }
}

function updateQuickActions(): void {
  openPdf.textContent = activePdfSourceUrl
    ? activePdfContext === 'overleaf'
      ? t('用 Pi 打开当前 Overleaf PDF')
      : t('用 Pi 打开当前 PDF')
    : activePdfContext === 'overleaf'
      ? t('查看 Overleaf PDF 打开指引')
      : activePdfContext === 'native'
        ? t('解决 PDF 读取权限')
        : t('打开 PDF 阅读器');
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
    ? t('打开翻译侧栏')
    : sidebarMode === 'browser'
      ? t('在浏览器侧栏中翻译')
      : t('打开翻译侧栏');
  openWebRegion.textContent = t('框选当前网页');
  if (pdfIsCurrent) {
    pageContext.textContent = t('当前是 PDF：用 Pi PDF 阅读，或直接打开翻译侧栏。');
    pageContext.removeAttribute('data-tone');
  } else if (sidebarAvailable) {
    pageContext.textContent = isOverleafProjectUrl(activeUrl ?? '')
      ? t('在 Overleaf 选中文字即可翻译；预览、公式和图表可使用框选。')
      : t('长文章可直接开启双语正文；短内容划词，图表和不可选内容使用框选。');
    pageContext.removeAttribute('data-tone');
  } else if (activeUrl && !isInjectableWebUrl(activeUrl)) {
    pageContext.textContent = t('当前页面受 Edge 限制，请切换到普通网页、Overleaf 或 PDF。');
    pageContext.dataset.tone = 'restricted';
  } else {
    pageContext.textContent = t('打开 PDF 阅读器，或在普通网页中使用划词翻译。');
    pageContext.removeAttribute('data-tone');
  }
  quickActions.dataset.primary = pdfIsCurrent
    ? 'pdf'
    : pageTranslationAvailable
      ? 'article'
      : sidebarAvailable
        ? 'sidebar'
        : 'reader';
  if(apiSetupAction){
    for(const action of [translatePage,openSidebar,openPdf]){
      action.classList.remove('primary-action','secondary-action');
      moreBody.append(action);
    }
    quickActions.prepend(apiSetupAction);
    quickActions.dataset.primary='setup';
  }else{
    quickActions.prepend(primaryAction);
    if(sidebarAvailable&&primaryAction!==openSidebar)quickActions.append(openSidebar);
    if(!pdfIsPrimary)moreBody.prepend(openPdf);
  }
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
      t('还差一步：允许读取本地 PDF'),
      t('Edge 默认不允许扩展读取 file:// 文件，这不是 API 或 PDF 损坏。'),
      [
        t('打开 Edge 扩展管理页并进入 Pi Translator 详情。'),
        t('开启“允许访问文件 URL”，返回当前 PDF 后重新检测。'),
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
      t('需要当前 PDF 所在站点的读取权限'),
      msg`Pi PDF 只会申请 ${source.protocol === 'file:' ? t('本地文件') : source.origin}，不会因此读取其他网站。`,
      [
        t('点击“重新检测”，并在 Edge 的权限提示中选择允许。'),
        t('授权后再次点击“用 Pi 打开当前 PDF”。'),
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
  const [settings, tabs, pausedSiteHosts, commands, discoveryProgress, sitePreferences] = await Promise.all([
    getSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
    getEffectivePausedSiteHosts(),
    browser.commands.getAll().catch(() => undefined),
    getFeatureDiscoveryProgress().catch(() => ({ completed: {}, dismissed: {} })),
    getSiteReadingPreferences(),
  ]);
  featureGuideProgressState = discoveryProgress;
  configuredTargetLanguage = isSupportedTargetLanguage(settings.targetLanguage)
    ? settings.targetLanguage
    : 'zh-CN';
  globalTargetLanguage = configuredTargetLanguage;
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
  const sitePreference = !activePdfContext ? siteReadingPreferenceForUrl(sitePreferences, activeUrl) : undefined;
  rememberedSite = Boolean(sitePreference);
  if (sitePreference) configuredTargetLanguage = sitePreference.targetLanguage;
  renderSitePreference();
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
    rememberSite.disabled = true;
  } else {
    siteName.textContent = hostname;
    pauseSite.checked = isSiteHostPaused(hostname, pausedSiteHosts);
    pauseSite.disabled = false;
    rememberSite.disabled = false;
    siteControl.hidden = false;
  }
  // Restoring the current webpage must not block the other popup actions.
  void refreshBilingualPageState();
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
  setStatus(msg`已保留当前${language}正文。`);
});
bilingualLanguageConfirm.addEventListener('click', () => {
  const requestedLanguage = pendingBilingualLanguageSwitch;
  if (!requestedLanguage) return;
  void applyPopupTargetLanguage(requestedLanguage, true);
});

apiProfile.addEventListener('change', () => {
  const requestedProfileId = apiProfile.value;
  setControlPending(apiProfile, true);
  setStatus(t('正在切换翻译接口…'), 'progress');
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
    setStatus(t('翻译接口已切换。'));
  })().catch(async () => {
    const settings = await getSettings().catch(() => undefined);
    if (settings) apiProfile.value = settings.activeApiProfileId;
    setStatus(t('未获得该接口的访问权限，仍使用原配置。'), 'error');
  }).finally(() => setControlPending(apiProfile, false));
});

function renderSitePreference(): void {
  rememberSite.checked = rememberedSite;
  resetSite.hidden = !rememberedSite;
  sitePreferenceHelp.textContent = rememberedSite
    ? t('已记住：顶部语言与暂停状态仅用于此网站。页面内临时切换不保存。')
    : t('未记住：语言使用全局设置，暂停仅在当前浏览器会话生效。');
}

async function changeSiteRemembered(remember: boolean): Promise<void> {
  if (!activeUrl || targetLanguageUpdatePending) { renderSitePreference(); return; }
  targetLanguageUpdatePending = true;
  rememberSite.disabled = true;
  resetSite.disabled = true;
  pauseSite.disabled = true;
  targetLanguage.disabled = true;
  try {
    const language = isSupportedTargetLanguage(targetLanguage.value) ? targetLanguage.value : configuredTargetLanguage;
    await saveSiteReadingPreference(activeUrl, remember ? { targetLanguage: language, paused: pauseSite.checked } : null);
    rememberedSite = remember;
    configuredTargetLanguage = remember ? language : globalTargetLanguage;
    if (!remember) pauseSite.checked = false;
    setStatus(remember ? t('已记住此网站的语言与暂停状态。') : t('此网站已恢复全局设置，现有译文保留。'));
  } catch {
    setStatus(t('网站偏好保存失败，已保留原设置。'), 'error');
  } finally {
    targetLanguageUpdatePending = false;
    rememberSite.disabled = false;
    resetSite.disabled = false;
    pauseSite.disabled = false;
    renderSitePreference();
    renderBilingualPageAction();
  }
}

rememberSite.addEventListener('change', () => { void changeSiteRemembered(rememberSite.checked); });
resetSite.addEventListener('click', () => { void changeSiteRemembered(false); });

pauseSite.addEventListener('change', () => {
  if (!activeUrl) return;
  const requestedPaused = pauseSite.checked;
  setControlPending(pauseSite, true);
  rememberSite.disabled = true;
  resetSite.disabled = true;
  targetLanguage.disabled = true;
  setStatus(requestedPaused ? t('正在暂停当前网站…') : t('正在恢复当前网站…'), 'progress');
  void setSiteReadingPaused(activeUrl, requestedPaused)
    .then((hostname) => {
      if (!hostname) pauseSite.checked = !requestedPaused;
      setStatus(
        hostname
          ? requestedPaused
            ? msg`已暂停 ${hostname} 的自动划词。`
            : msg`已恢复 ${hostname} 的自动划词。`
          : t('当前页面不支持此操作。'),
        hostname ? 'success' : 'error',
      );
    })
    .catch(() => {
      pauseSite.checked = !requestedPaused;
      setStatus(t('当前网站状态更新失败，已恢复原状态。'), 'error');
    })
    .finally(() => {
      setControlPending(pauseSite, false);
      rememberSite.disabled = false;
      resetSite.disabled = false;
      targetLanguage.disabled = false;
      if (selectionHelp.open) void refreshSelectionHelp();
    });
});

featureGuideToggle.addEventListener('click', () => {
  featureGuideRevealOverride = true;
  renderFeatureGuide();
  featureGuideTitle.focus({ preventScroll: true });
});
moreActions.addEventListener('toggle', () => {
  if (!moreActions.open && featureGuideRevealOverride) {
    featureGuideRevealOverride = false;
    renderFeatureGuide();
  }
});

featureGuideDismiss.addEventListener('click', () => {
  const scene = featureGuideScene;
  if (!scene) return;
  featureGuideDismiss.disabled = true;
  void (async () => {
    await dismissFeatureDiscovery(scene);
    featureGuideProgressState.dismissed[scene] = true;
    featureGuideRevealOverride = false;
    renderFeatureGuide();
    featureGuideToggle.focus({ preventScroll: true });
  })().catch(() => {
    setStatus(t('使用提示状态未能保存，请稍后再试。'), 'error');
  }).finally(() => {
    featureGuideDismiss.disabled = false;
  });
});

openSettings.addEventListener('click', () => {
  openSettingsPage();
});

textApiStatus.addEventListener('click', () => openSettingsPage(textApiSettingsFocus));
document.getElementById('open-library')!.addEventListener('click', () => openSettingsPage('storage'));
visionApiStatus.addEventListener('click', () => openSettingsPage(visionApiSettingsFocus));

translatePage.addEventListener('click', () => {
  if (activeTabId === undefined) return;
  if (bilingualPageStateRead !== 'ready') {
    if (bilingualPageStateRead === 'error') void refreshBilingualPageState();
    return;
  }
  if (!isSupportedTargetLanguage(targetLanguage.value)) {
    setStatus(t('当前目标语言不支持网页正文翻译。'), 'error');
    return;
  }
  const action = bilingualPageAction();
  translatePage.disabled = true;
  setStatus(
    action === 'start'
      ? t('正在识别网页正文…')
      : action === 'clear'
        ? t('正在清除双语正文…')
        : t('正在更新正文翻译状态…'),
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
      if (!response?.ok) throw new Error(response?.error.message ?? t('正文翻译操作失败。'));
      bilingualPageState = response.data.state;
      updateQuickActions();
      if (bilingualPageState.phase === 'error') {
        setStatus(bilingualPageState.message ?? t('当前页面没有识别到可翻译的正文。'), 'error');
        return;
      }
      window.close();
    })
    .catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : t('正文翻译操作失败。'), 'error');
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
      .catch(() => setStatus(t('当前页面无法打开浏览器侧栏，请刷新后重试。'), 'error'));
    return;
  }
  void browser.runtime.sendMessage({ type: 'OPEN_SIDEBAR' } satisfies RuntimeMessage)
    .then(async (response: RuntimeResponse<{ opened: true }> | undefined) => {
      if (!response?.ok) {
        setStatus(t('当前页面无法打开侧栏，请刷新后重试。'), 'error');
        return;
      }
      await markFeatureGuideComplete(sidebarDiscoveryFeature()).catch(() => undefined);
      window.close();
    })
    .catch(() => setStatus(t('当前页面无法打开侧栏，请刷新后重试。'), 'error'));
});

openWebRegion.addEventListener('click', () => {
  setStatus(t('正在进入网页框选…'), 'progress');
  openWebRegion.disabled = true;
  void browser.runtime.sendMessage({
    type: 'START_WEB_REGION_SELECTION',
  } satisfies RuntimeMessage).then(async (response: RuntimeResponse<{ started: true }> | undefined) => {
    if (!response?.ok) {
      setStatus(t('当前页面无法框选，请刷新页面后重试。'), 'error');
      return;
    }
    await markFeatureGuideComplete(regionDiscoveryFeature()).catch(() => undefined);
    window.close();
  }).catch(() => {
    setStatus(t('当前页面无法框选，请刷新页面后重试。'), 'error');
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
  })().catch(() => setStatus(t('无法打开 PDF 阅读器，请重新加载扩展后再试。'), 'error'));
});

openExtensionManagement.addEventListener('click', () => {
  void browser.tabs.create({
    url: `edge://extensions/?id=${browser.runtime.id}`,
    active: true,
  }).catch(() => setStatus(t('请手动打开 edge://extensions 并进入 Pi Translator 详情。'), 'error'));
});

retryPdfAccess.addEventListener('click', () => {
  void (async () => {
    if (activePdfSourceUrl) {
      if (await requestPdfSourceAccess(activePdfSourceUrl)) {
        setStatus(t('PDF 读取权限已就绪。'));
      }
      return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await resolveActivePdfContext(tab ?? {});
    updateQuickActions();
    if (activePdfSourceUrl) {
      hidePdfAccessAlert();
      setStatus(t('已重新识别当前 PDF。'));
    } else if (activePdfContext) {
      showUnavailablePdfSource();
    }
  })().catch(() => showUnavailablePdfSource());
});

void load().catch(() => {
  updateQuickActions();
  setStatus(t('读取扩展状态失败，请重新打开面板。'), 'error');
});

}

void startUi();
