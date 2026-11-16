import { detectPageTheme, type PageTheme } from '../core/theme/page-theme';
import { t } from '../core/i18n/ui-language';
import {applyPalette,applyPalettePreview,normalizePalette,type PalettePreference} from './palettes';

export type ThemePreference = 'auto' | 'light' | 'dark';
const STORAGE_KEY = 'piThemePreference';
let preference: ThemePreference = 'auto';
let palette: PalettePreference = 'neutral';
const PALETTE_KEY = 'piPalettePreference';
let ready: Promise<void> | undefined;
const listeners = new Set<() => void>();
const originalQueries = new WeakMap<CSSMediaRule, string>();

function normalize(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

function notify(): void {
  for (const listener of listeners) listener();
}

function initialize(): Promise<void> {
  if (!ready) {
    // This preference is independent of API settings so changing appearance cannot overwrite a settings draft.
    const contentScript = location.protocol !== 'chrome-extension:';
    if (contentScript) browser.runtime.onMessage.addListener(message => {
      if (message.type === 'PUBLIC_SETTINGS_UPDATED') {
        preference = normalize(message.payload.themePreference);
        palette = normalizePalette(message.payload.palettePreference);
        notify();
      }
    });
    else browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[STORAGE_KEY] || changes[PALETTE_KEY])) {
        if (changes[STORAGE_KEY]) preference = normalize(changes[STORAGE_KEY].newValue);
        if (changes[PALETTE_KEY]) palette = normalizePalette(changes[PALETTE_KEY].newValue);
        notify();
      }
    });
    ready = (contentScript
      ? browser.runtime.sendMessage({type:'GET_PUBLIC_SETTINGS'}).then(response => response.ok ? {mode:response.data.themePreference,palette:response.data.palettePreference} : {})
      : browser.storage.local.get([STORAGE_KEY,PALETTE_KEY]).then(stored => ({mode:stored[STORAGE_KEY],palette:stored[PALETTE_KEY]}))).then(value => {
      preference = normalize(value.mode);
      palette = normalizePalette(value.palette);
      notify();
    });
  }
  return ready;
}

/** Apply the selected scheme to existing component media rules, preserving width and contrast conditions. */
function applyRules(rules: CSSRuleList, scheme: PageTheme): void {
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      const query = originalQueries.get(rule) ?? rule.conditionText;
      originalQueries.set(rule, query);
      if (/prefers-color-scheme/i.test(query)) {
        rule.media.mediaText = query.replace(/\(prefers-color-scheme:\s*(dark|light)\)/gi,
          (_, value: string) => value === scheme ? '(min-width: 0px)' : '(max-width: -1px)');
      }
    }
    if ('cssRules' in rule) applyRules((rule as CSSGroupingRule).cssRules, scheme);
  }
}

export function bindTheme(root: Document | ShadowRoot, followPage = false): () => void {
  const host = root instanceof Document ? root.documentElement : root.host as HTMLElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const controls = [...root.querySelectorAll<HTMLSelectElement>('[data-theme-choice]')];
  const paletteButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-palette-choice]')];
  const paletteSummaries = [...root.querySelectorAll<HTMLElement>('[data-palette-summary]')];
  let revision = 0;
  const refresh = () => {
    const scheme = preference === 'auto'
      ? followPage ? detectPageTheme() : media.matches ? 'dark' : 'light'
      : preference;
    if (host.dataset.piTheme !== scheme) host.dataset.piTheme = scheme;
    host.style.colorScheme = scheme;
    for (const sheet of root.styleSheets) applyRules(sheet.cssRules, scheme);
    applyPalette(host,palette,scheme);
    for (const control of controls) if (!control.disabled) control.value = preference;
    for (const button of paletteButtons) {
      button.setAttribute('aria-pressed',String(button.dataset.paletteChoice === palette));
      applyPalettePreview(button,normalizePalette(button.dataset.paletteChoice),scheme);
    }
    const selectedLabel = paletteButtons.find(button => button.dataset.paletteChoice === palette)?.querySelector(':scope > span:last-child');
    for (const summary of paletteSummaries) {
      summary.textContent = selectedLabel?.textContent ?? '';
      const parts = selectedLabel?.getAttribute('data-i18n-parts');
      if (parts) summary.setAttribute('data-i18n-parts',parts);
    }
  };
  const changePalette = async (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const value = normalizePalette(button.dataset.paletteChoice);
    button.disabled = true;
    try {
      await browser.storage.local.set({[PALETTE_KEY]:value});
      palette = value;
      notify();
    } catch {
      button.title = t('配色保存失败，请重试。');
      refresh();
    } finally {
      button.disabled = false;
    }
  };
  for (const button of paletteButtons) button.addEventListener('click',changePalette);
  const change = async (event: Event) => {
    const control = event.currentTarget as HTMLSelectElement;
    const value = normalize(control.value);
    const current = ++revision;
    control.disabled = true;
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: value });
      preference = value;
      notify();
    } catch {
      control.value = preference;
      control.setCustomValidity(t('配色保存失败，请重试。'));
      control.reportValidity();
    } finally {
      if (revision === current) { control.disabled = false; refresh(); }
    }
  };
  for (const control of controls) {
    control.addEventListener('change', change);
    control.addEventListener('input', () => control.setCustomValidity(''));
  }
  listeners.add(refresh);
  media.addEventListener('change', refresh);
  const observer = new MutationObserver(refresh);
  const styles = new MutationObserver(records => {
    if (records.some(record => record.target instanceof HTMLStyleElement ||
      [...record.addedNodes].some(node => node instanceof Element &&
        (node.matches('style,link[rel="stylesheet"]') || node.querySelector('style,link[rel="stylesheet"]'))))) refresh();
  });
  styles.observe(root, {childList:true,subtree:true});
  if (followPage) {
    const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-bs-theme'] };
    observer.observe(document.documentElement, options);
    if (document.body) observer.observe(document.body, options);
  }
  refresh();
  void initialize().catch(() => refresh());
  return () => {
    revision++;
    listeners.delete(refresh);
    media.removeEventListener('change', refresh);
    observer.disconnect();
    styles.disconnect();
    for (const control of controls) control.removeEventListener('change', change);
    for (const button of paletteButtons) button.removeEventListener('click',changePalette);
  };
}
