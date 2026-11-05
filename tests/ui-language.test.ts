import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentUiLanguage, initializeUiLanguage, localizeErrorMessage, msg,
  resolveUiLanguage, saveUiLanguagePreference, t, uiHtml, uiSelector, applyPublicUiLanguage,
} from '../core/i18n/ui-language';

function storage(preference: unknown, browserLanguage = 'en-US') {
  const set = vi.fn(async () => undefined);
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => browserLanguage },
    storage: { local: { get: async () => ({ uiLanguagePreference: preference }), set } },
  });
  return set;
}

afterEach(async () => {
  storage('zh-CN'); await initializeUiLanguage(); vi.unstubAllGlobals();
});

describe('independent UI language', () => {
  it('resolves Chinese variants and English fallback without changing translation settings', () => {
    expect(resolveUiLanguage('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveUiLanguage('auto', 'fr-FR')).toBe('en');
    expect(resolveUiLanguage('en', 'zh-CN')).toBe('en');
    expect(resolveUiLanguage('zh-CN', 'en-US')).toBe('zh-CN');
  });
  it('writes only the separate preference and preserves arbitrary old storage', async () => {
    const set = storage('zh-CN');
    await saveUiLanguagePreference('en');
    expect(set.mock.calls).toEqual([[{ uiLanguagePreference: 'en' }]]);
  });
  it('localizes owned copy while treating interpolated translations and formulas as opaque', async () => {
    storage('en'); await initializeUiLanguage();
    expect(currentUiLanguage()).toBe('en');
    expect(t('复制')).toBe('Copy');
    const userContent = '复制 · 人工修正 $E=mc^2$ {{0}}';
    expect(msg`${userContent}`).toBe(userContent);
    expect(msg`${undefined}/${null}`).toBe('undefined/null');
    expect(uiHtml`<div title="复制">${userContent}</div>`).toBe(`<div title="Copy">${userContent}</div>`);
    expect(uiSelector('[aria-label="复制"]')).toBe('[aria-label="Copy"]');
  });
  it('keeps provider details and unknown errors verbatim', async () => {
    storage('en'); await initializeUiLanguage();
    const details='复制：user-owned detail';
    expect(localizeErrorMessage(`请先在扩展设置页填写 API Key。\n接口详情：${details}`))
      .toBe(`Please enter an API Key in the extension settings first.\nAPI details: ${details}`);
    expect(localizeErrorMessage(details)).toBe(details);
  });
  it('keeps the original Chinese wording when Chinese is selected', async () => {
    storage('zh-CN'); await initializeUiLanguage();
    expect(t('复制')).toBe('复制');
    expect(msg`已选择 ${3}/${8} 段`).toBe('已选择 3/8 段');
  });
  it('lets content scripts apply only the public language value without reading storage', () => {
    applyPublicUiLanguage('en');
    expect(t('复制')).toBe('Copy');
    applyPublicUiLanguage(undefined);
    expect(t('复制')).toBe('Copy');
    applyPublicUiLanguage('zh-CN');
    expect(t('复制')).toBe('复制');
  });
});
