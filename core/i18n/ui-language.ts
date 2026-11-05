import { ENGLISH_UI } from './english-ui';

export type UiLanguagePreference = 'auto' | 'zh-CN' | 'en';
export type UiLanguage = 'zh-CN' | 'en';
export const UI_LANGUAGE_STORAGE_KEY = 'uiLanguagePreference';
let language: UiLanguage = 'zh-CN';
let preference: UiLanguagePreference = 'auto';

export function resolveUiLanguage(value: unknown, browserLanguage: string): UiLanguage {
  if (value === 'zh-CN' || value === 'en') return value;
  return /^zh(?:-|_|$)/i.test(browserLanguage) ? 'zh-CN' : 'en';
}

export function currentUiLanguage(): UiLanguage { return language; }
export function currentUiLanguagePreference(): UiLanguagePreference { return preference; }
/** Content scripts receive only this public value from the trusted background. */
export function applyPublicUiLanguage(value: UiLanguage | undefined): void {
  if (value === 'zh-CN' || value === 'en') language = value;
}

export async function initializeUiLanguage(): Promise<void> {
  // This key is independent of translation settings, credentials and saved work.
  const stored = await browser.storage.local.get(UI_LANGUAGE_STORAGE_KEY).catch(() => ({} as Record<string, unknown>));
  const value = stored[UI_LANGUAGE_STORAGE_KEY];
  preference = value === 'zh-CN' || value === 'en' ? value : 'auto';
  language = resolveUiLanguage(preference, browser.i18n.getUILanguage());
}

export async function saveUiLanguagePreference(value: UiLanguagePreference): Promise<void> {
  await browser.storage.local.set({ [UI_LANGUAGE_STORAGE_KEY]: value });
}

/** Only call with product-owned copy, never source text, translations or user labels. */
export function t(source: string): string {
  return language === 'en' ? ENGLISH_UI[source] ?? source : source;
}

function interpolate(source: string, values: readonly unknown[]): string {
  return source.replace(/\{\{(\d+)\}\}/g, (_, index: string) => String(values[Number(index)]));
}

function templateSource(parts: TemplateStringsArray): string {
  return parts.reduce((source, part, index) => source + (index ? `{{${index - 1}}}` : '') + part, '');
}

/** Values are opaque: model output, terms and formulas are never looked up. */
export function msg(parts: TemplateStringsArray, ...values: unknown[]): string {
  return interpolate(t(templateSource(parts)), values);
}

function escapeMarkup(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Localize literal text/attributes before inserting the original template values. */
export function uiHtml(parts: TemplateStringsArray, ...values: unknown[]): string {
  const source = templateSource(parts);
  if (language !== 'en') return interpolate(source, values);
  const localized = source.replace(/<[^>]*>|[^<]+/g, token => {
    if (token.startsWith('<')) {
      return token.replace(/((?:title|aria-label|placeholder|alt)\s*=\s*)(["'])(.*?)\2/g,
        (original, prefix: string, quote: string, value: string) =>
          ENGLISH_UI[value] ? `${prefix}${quote}${escapeMarkup(t(value))}${quote}` : original);
    }
    const trimmed = token.trim();
    return ENGLISH_UI[trimmed] ? token.replace(trimmed, escapeMarkup(t(trimmed))) : token;
  });
  return interpolate(localized, values);
}

export function uiSelector(source: string): string {
  return source.replace(/((?:aria-label|title)=)(["'])(.*?)\2/g,
    (_, prefix: string, quote: string, value: string) => `${prefix}${quote}${t(value).replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`);
}

/** Explicit static-node annotations prevent touching any translated/user content. */
export function localizeUiDocument(doc: Document = document): void {
  doc.documentElement.lang = language;
  for (const element of doc.querySelectorAll<HTMLElement>('[data-i18n-parts]')) {
    const parts = JSON.parse(element.dataset.i18nParts ?? '[]') as Array<[number, string]>;
    for (const [index, source] of parts) {
      const node = element.childNodes[index];
      if (node?.nodeType === 3) node.textContent = (node.textContent ?? '').replace((node.textContent ?? '').trim(), t(source));
    }
  }
  for (const attribute of ['title', 'aria-label', 'placeholder', 'alt', 'data-short-label']) {
    for (const element of doc.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`) ?? ''));
    }
  }
}

/** Display-only boundary; validation and persisted backend messages stay intact. */
export function localizeErrorMessage(source: string): string {
  if (language !== 'en') return source;
  if (ENGLISH_UI[source]) return t(source);
  // Provider details remain verbatim. Only our own explanatory prefix changes.
  const separator = '\n接口详情：';
  const index = source.indexOf(separator);
  return index >= 0
    ? `${t(source.slice(0, index))}\nAPI details: ${source.slice(index + separator.length)}`
    : source;
}
