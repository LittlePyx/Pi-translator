import { describe, expect, it } from 'vitest';
import type { ApiReadinessStatus } from '../core/settings/api-readiness';
import {
  popupPageState,
  popupReadiness,
} from '../core/settings/popup-readiness';

const readyTextApi: ApiReadinessStatus = {
  role: 'text',
  label: '文字翻译',
  value: '已配置',
  detail: '文字 API、模型、Key 和域名权限均已配置。',
  tone: 'ready',
  settingsFocus: 'api',
};

describe('popup readiness', () => {
  it('collapses when the required setup and current page are ready', () => {
    expect(popupReadiness({
      textApi: readyTextApi,
      shortcut: 'assigned',
      page: 'supported',
    })).toEqual({ issues: [] });
  });

  it('returns one direct action for each fixable issue', () => {
    const result = popupReadiness({
      textApi: {
        ...readyTextApi,
        value: '待授权',
        detail: '还需允许 Pi Translator 访问当前 API 域名。',
        tone: 'issue',
        settingsFocus: 'api-permission',
      },
      shortcut: 'missing',
      page: 'disabled',
    });
    expect(result.issues.map(({ id, actionLabel, action }) => ({ id, actionLabel, action })))
      .toEqual([
        {
          id: 'text-api',
          actionLabel: '授权接口',
          action: { kind: 'settings', focus: 'api-permission' },
        },
        {
          id: 'shortcut',
          actionLabel: '设置快捷键',
          action: { kind: 'shortcuts' },
        },
        {
          id: 'page',
          actionLabel: '开启网页翻译',
          action: { kind: 'settings', focus: 'pages' },
        },
      ]);
  });

  it('treats browser pages as contextual limitations instead of setup failures', () => {
    expect(popupReadiness({
      textApi: readyTextApi,
      shortcut: 'assigned',
      page: 'restricted',
    })).toEqual({
      issues: [],
      contextNote: '当前页面受 Edge 限制，请在普通网页、Overleaf 或 PDF 中使用。',
    });
  });

  it('does not report ready when the browser shortcut state could not be read', () => {
    expect(popupReadiness({
      textApi: readyTextApi,
      shortcut: 'unknown',
      page: 'supported',
    }).issues).toMatchObject([{
      id: 'shortcut',
      actionLabel: '检查快捷键',
      action: { kind: 'shortcuts' },
    }]);
  });
});

describe('popup page state', () => {
  it('distinguishes supported, disabled, restricted, and extension contexts', () => {
    expect(popupPageState('https://example.com/article', 'on-demand')).toBe('supported');
    expect(popupPageState('https://example.com/article', 'off')).toBe('disabled');
    expect(popupPageState('edge://settings/', 'on-demand')).toBe('restricted');
    expect(popupPageState('chrome-extension://pi-translator/popup.html', 'off')).toBe('neutral');
    expect(popupPageState('edge://pdf-viewer/index.html', 'off', true)).toBe('supported');
  });
});
