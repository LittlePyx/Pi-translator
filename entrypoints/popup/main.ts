import {
  activateApiProfile,
  getSettings,
  saveSettings,
} from '../../core/settings/repository';
import type { RuntimeMessage, RuntimeResponse } from '../../core/messaging/messages';
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

let activeUrl: string | undefined;
let activePdfSourceUrl: string | undefined;
let activePdfPage: number | undefined;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
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
  activeUrl = tabs[0]?.url;
  const pdfContext = { ...(activeUrl ? { tabUrl: activeUrl } : {}) };
  if (isEdgeNativePdfContext(pdfContext)) {
    activePdfSourceUrl = edgePdfSourceUrl(pdfContext);
    activePdfPage = pdfInitialPage(activeUrl) ?? pdfInitialPage(activePdfSourceUrl);
  } else {
    activePdfSourceUrl = undefined;
    activePdfPage = undefined;
  }
  openPdf.textContent = activePdfSourceUrl
    ? '用 Pi 打开当前 PDF'
    : '打开 PDF 阅读器';
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
  void activateApiProfile(apiProfile.value)
    .then(() => setStatus('翻译接口已切换。'))
    .catch(() => setStatus('翻译接口切换失败。', true));
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
    const source = parsePdfSourceUrl(sourceUrl);
    if (sourceUrl) {
      const origin = pdfPermissionPattern(sourceUrl);
      if (origin) {
        const granted =
          (await browser.permissions.contains({ origins: [origin] })) ||
          (await browser.permissions.request({ origins: [origin] }));
        if (!granted) {
          setStatus('需要允许读取当前 PDF 所在网站；也可以打开阅读器后选择本地文件。', true);
          return;
        }
      }
      if (
        source?.protocol === 'file:' &&
        !(await browser.extension.isAllowedFileSchemeAccess())
      ) {
        setStatus('请先在扩展管理页开启“允许访问文件 URL”，再重新打开快捷面板。', true);
        return;
      }
    }
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

void load().catch(() => setStatus('读取扩展状态失败，请重新打开面板。', true));
