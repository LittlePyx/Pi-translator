import { getSettings, saveSettings } from '../../core/settings/repository';
import {
  getPausedSiteHosts,
  isSiteHostPaused,
  setSitePaused,
  siteHostFromUrl,
} from '../../core/settings/site-pause';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing popup element #${id}`);
  return value as T;
}

const targetLanguage = element<HTMLSelectElement>('target-language');
const siteName = element<HTMLElement>('site-name');
const pauseSite = element<HTMLInputElement>('pause-site');
const status = element<HTMLParagraphElement>('status');
const openSettings = element<HTMLButtonElement>('open-settings');

let activeUrl: string | undefined;

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
  activeUrl = tabs[0]?.url;
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
  void browser.runtime.openOptionsPage();
  window.close();
});

void load().catch(() => setStatus('读取扩展状态失败，请重新打开面板。', true));
