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
  RuntimeMessage,
  RuntimeResponse,
} from '../../core/messaging/messages';
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

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing popup element #${id}`);
  return value as T;
}

const targetLanguage = element<HTMLSelectElement>('target-language');
const apiProfileField = element<HTMLElement>('api-profile-field');
const apiProfile = element<HTMLSelectElement>('api-profile');
const siteControl = element<HTMLElement>('site-control');
const siteName = element<HTMLElement>('site-name');
const pauseSite = element<HTMLInputElement>('pause-site');
const status = element<HTMLParagraphElement>('status');
const quickActions = element<HTMLElement>('quick-actions');
const openSettings = element<HTMLButtonElement>('open-settings');
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
let statusTimer: number | undefined;

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
  const webRegionAvailable = Boolean(
    activeUrl && (
      isOverleafProjectUrl(activeUrl) ||
      (!activePdfContext && generalPageMode !== 'off' && isInjectableWebUrl(activeUrl))
    ),
  );
  const pdfIsCurrent = Boolean(activePdfContext);
  const pdfIsPrimary = pdfIsCurrent || !sidebarAvailable;
  const primaryAction = pdfIsPrimary ? openPdf : openSidebar;
  const secondaryAction = pdfIsPrimary ? openSidebar : openPdf;
  openPdf.classList.remove('primary-action', 'secondary-action');
  openSidebar.classList.remove('primary-action', 'secondary-action');
  primaryAction.classList.add('primary-action');
  if (sidebarAvailable) secondaryAction.classList.add('secondary-action');
  openSidebar.hidden = !sidebarAvailable;
  openWebRegion.hidden = !webRegionAvailable;
  openSidebar.textContent = pdfIsCurrent
    ? '打开翻译侧栏'
    : sidebarMode === 'browser'
      ? '打开浏览器翻译侧栏'
      : '打开连续翻译侧栏';
  quickActions.dataset.primary = pdfIsCurrent
    ? 'pdf'
    : sidebarAvailable
      ? 'sidebar'
      : 'reader';
  quickActions.prepend(primaryAction);
  quickActions.removeAttribute('aria-busy');
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
  const [settings, tabs, pausedSiteHosts, commands] = await Promise.all([
    getSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
    getPausedSiteHosts(),
    browser.commands.getAll().catch(() => undefined),
  ]);
  targetLanguage.value = settings.targetLanguage;
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
  popupShortcutState = commands
    ? assignedTranslationShortcut(commands) ? 'assigned' : 'missing'
    : 'unknown';
  renderPopupReadiness(readiness.text, popupShortcutState);
}

targetLanguage.addEventListener('change', () => {
  const requestedLanguage = targetLanguage.value;
  setControlPending(targetLanguage, true);
  setStatus('正在更新目标语言…', 'progress');
  void (async () => {
    await mutateSettings((settings) => ({
      nextSettings: {
        ...settings,
        targetLanguage: requestedLanguage,
      },
      value: undefined,
    }));
    setStatus('目标语言已更新。');
  })().catch(async () => {
    const settings = await getSettings().catch(() => undefined);
    if (settings) targetLanguage.value = settings.targetLanguage;
    setStatus('目标语言更新失败，已保留原设置。', 'error');
  }).finally(() => setControlPending(targetLanguage, false));
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

openSettings.addEventListener('click', () => {
  openSettingsPage();
});

textApiStatus.addEventListener('click', () => openSettingsPage(textApiSettingsFocus));
visionApiStatus.addEventListener('click', () => openSettingsPage(visionApiSettingsFocus));

openSidebar.addEventListener('click', () => {
  if (sidebarMode === 'browser' && !activePdfContext && activeTabId !== undefined) {
    void browser.sidePanel.open({ tabId: activeTabId })
      .then(() => window.close())
      .catch(() => setStatus('当前页面无法打开浏览器侧栏，请刷新后重试。', 'error'));
    return;
  }
  void browser.runtime.sendMessage({ type: 'OPEN_SIDEBAR' } satisfies RuntimeMessage)
    .then((response: RuntimeResponse<{ opened: true }> | undefined) => {
      if (!response?.ok) {
        setStatus('当前页面无法打开侧栏，请刷新后重试。', 'error');
        return;
      }
      window.close();
    })
    .catch(() => setStatus('当前页面无法打开侧栏，请刷新后重试。', 'error'));
});

openWebRegion.addEventListener('click', () => {
  setStatus('正在进入网页框选…', 'progress');
  openWebRegion.disabled = true;
  void browser.runtime.sendMessage({
    type: 'START_WEB_REGION_SELECTION',
  } satisfies RuntimeMessage).then((response: RuntimeResponse<{ started: true }> | undefined) => {
    if (!response?.ok) {
      setStatus('当前页面无法框选，请刷新页面后重试。', 'error');
      return;
    }
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
