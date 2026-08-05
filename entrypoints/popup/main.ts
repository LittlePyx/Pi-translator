import {
  activateApiProfile,
  getSettings,
  saveSettings,
} from '../../core/settings/repository';
import { apiOriginPattern } from '../../core/settings/api-access';
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
import { isOverleafProjectUrl } from '../../core/settings/site-access';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing popup element #${id}`);
  return value as T;
}

const targetLanguage = element<HTMLSelectElement>('target-language');
const apiProfileField = element<HTMLElement>('api-profile-field');
const apiProfile = element<HTMLSelectElement>('api-profile');
const siteName = element<HTMLElement>('site-name');
const pauseSite = element<HTMLInputElement>('pause-site');
const status = element<HTMLParagraphElement>('status');
const openSettings = element<HTMLButtonElement>('open-settings');
const openSidebar = element<HTMLButtonElement>('open-sidebar');
const openPdf = element<HTMLButtonElement>('open-pdf');
const pdfAccessAlert = element<HTMLElement>('pdf-access-alert');
const pdfAccessTitle = element<HTMLElement>('pdf-access-title');
const pdfAccessMessage = element<HTMLElement>('pdf-access-message');
const pdfAccessSteps = element<HTMLOListElement>('pdf-access-steps');
const openExtensionManagement = element<HTMLButtonElement>('open-extension-management');
const retryPdfAccess = element<HTMLButtonElement>('retry-pdf-access');

let activeUrl: string | undefined;
let activePdfSourceUrl: string | undefined;
let activePdfPage: number | undefined;
let activePdfContext: 'native' | 'overleaf' | undefined;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
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

function updateOpenPdfLabel(): void {
  openPdf.textContent = activePdfSourceUrl
    ? activePdfContext === 'overleaf'
      ? '用 Pi 打开当前 Overleaf PDF'
      : '用 Pi 打开当前 PDF'
    : activePdfContext === 'overleaf'
      ? '查看 Overleaf PDF 打开指引'
      : activePdfContext === 'native'
        ? '解决 PDF 读取权限'
        : '打开 PDF 阅读器';
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
  const [settings, tabs, pausedSiteHosts] = await Promise.all([
    getSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
    getPausedSiteHosts(),
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
  await resolveActivePdfContext(tabs[0] ?? {});
  updateOpenPdfLabel();
  if (activePdfContext && !activePdfSourceUrl) showUnavailablePdfSource();
  else hidePdfAccessAlert();
  const hostname = activeUrl ? siteHostFromUrl(activeUrl) : undefined;
  if (!hostname) {
    siteName.textContent = '当前页面不支持';
    pauseSite.disabled = true;
    return;
  }
  siteName.textContent = hostname;
  pauseSite.checked = isSiteHostPaused(hostname, pausedSiteHosts);
}

targetLanguage.addEventListener('change', () => {
  void (async () => {
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      targetLanguage: targetLanguage.value,
    });
    setStatus('目标语言已更新。');
  })().catch(() => setStatus('目标语言更新失败。', true));
});

apiProfile.addEventListener('change', () => {
  const requestedProfileId = apiProfile.value;
  void (async () => {
    const settings = await getSettings();
    const profile = settings.apiProfiles.find((candidate) => candidate.id === requestedProfileId);
    if (!profile) throw new Error('The selected API profile no longer exists.');
    const granted = await browser.permissions.request({
      origins: [apiOriginPattern(profile.apiBaseUrl)],
    });
    if (!granted) throw new Error('API access was not granted.');
    await activateApiProfile(requestedProfileId);
    setStatus('翻译接口已切换。');
  })().catch(async () => {
    apiProfile.value = (await getSettings()).activeApiProfileId;
    setStatus('未获得该接口的访问权限，仍使用原配置。', true);
  });
});

pauseSite.addEventListener('change', () => {
  if (!activeUrl) return;
  void setSitePaused(activeUrl, pauseSite.checked)
    .then((hostname) => {
      setStatus(
        hostname
          ? pauseSite.checked
            ? `已暂停 ${hostname} 的自动划词。`
            : `已恢复 ${hostname} 的自动划词。`
          : '当前页面不支持此操作。',
        !hostname,
      );
    })
    .catch(() => setStatus('当前网站状态更新失败。', true));
});

openSettings.addEventListener('click', () => {
  void browser.runtime.sendMessage({
    type: 'OPEN_OPTIONS_PAGE',
  } satisfies RuntimeMessage)
    .then(() => window.close())
    .catch(() => setStatus('无法打开完整设置，请在扩展管理页重试。', true));
});

openSidebar.addEventListener('click', () => {
  void browser.runtime.sendMessage({ type: 'OPEN_SIDEBAR' } satisfies RuntimeMessage)
    .then(() => window.close())
    .catch(() => setStatus('当前页面无法打开侧栏，请刷新后重试。', true));
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
  })().catch(() => setStatus('无法打开 PDF 阅读器，请重新加载扩展后再试。', true));
});

openExtensionManagement.addEventListener('click', () => {
  void browser.tabs.create({
    url: `edge://extensions/?id=${browser.runtime.id}`,
    active: true,
  }).catch(() => setStatus('请手动打开 edge://extensions 并进入 Pi Translator 详情。', true));
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
    updateOpenPdfLabel();
    if (activePdfSourceUrl) {
      hidePdfAccessAlert();
      setStatus('已重新识别当前 PDF。');
    } else if (activePdfContext) {
      showUnavailablePdfSource();
    }
  })().catch(() => showUnavailablePdfSource());
});

void load().catch(() => setStatus('读取扩展状态失败，请重新打开面板。', true));
