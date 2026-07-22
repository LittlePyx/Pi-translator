import type {
  PublicSettingsResponse,
  RuntimeMessage,
  TranslateRuntimeResponse,
} from '../core/messaging/messages';
import { captureSelectionSnapshot } from '../core/selection/generic-selection';
import type { SelectionSnapshot, ViewportRect } from '../core/selection/types';
import type { TranslationStyle } from '../core/translation/types';
import { TranslationOverlay } from '../ui/translation-overlay';

interface PublicSettings {
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  showFloatingButtonOnOverleaf: boolean;
}

const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  showFloatingButtonOnOverleaf: true,
};

const ERROR_MESSAGES: Record<string, string> = {
  EMPTY_SELECTION: '请先选中需要翻译的文本。',
  SELECTION_TOO_LONG: '选中的文本过长，请缩小选择范围。',
  NO_API_KEY: '请先在扩展设置页填写 DeepSeek API Key。',
  AUTH_FAILED: 'DeepSeek API Key 无效或没有访问权限。',
  RATE_LIMITED: 'DeepSeek 请求过于频繁，请稍后再试。',
  REQUEST_TIMEOUT: '翻译请求超时，请重试。',
  NETWORK_ERROR: '无法连接 DeepSeek，请检查网络。',
  EMPTY_RESPONSE: 'DeepSeek 返回了空结果，请重试。',
  INVALID_RESPONSE: 'DeepSeek 返回了无法识别的结果。',
  LATEX_VALIDATION_FAILED: '模型没有完整保留 LaTeX 结构，结果已被拦截。',
  REQUEST_ABORTED: '请求已取消。',
};

export default defineContentScript({
  matches: ['https://www.overleaf.com/project/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings = DEFAULT_PUBLIC_SETTINGS;
    let latestSelection: SelectionSnapshot | undefined;
    let activeSelection: SelectionSnapshot | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const overlay = new TranslationOverlay({
      onTranslate: () => {
        if (latestSelection) void translate(latestSelection);
      },
      onRetry: () => {
        if (activeSelection) void translate(activeSelection);
      },
      onOpenSettings: () => void browser.runtime.openOptionsPage(),
    });

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_PUBLIC_SETTINGS',
      } satisfies RuntimeMessage)) as PublicSettingsResponse;
      if (response.ok) settings = response.data;
    } catch {
      // The defaults keep selection UI available if the worker is restarting.
    }

    function selectionRect(snapshot: SelectionSnapshot): ViewportRect | undefined {
      return snapshot.rect;
    }

    function refreshSelection(): void {
      if (!settings.showFloatingButtonOnOverleaf) return;
      const snapshot = captureSelectionSnapshot();
      latestSelection = snapshot;
      if (snapshot?.rect) {
        overlay.showTrigger(snapshot.rect);
      } else if (!activeSelection) {
        overlay.hide();
      }
    }

    function scheduleRefresh(): void {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshSelection, 60);
    }

    async function translate(snapshot: SelectionSnapshot): Promise<void> {
      activeSelection = snapshot;
      overlay.showLoading(selectionRect(snapshot));
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'TRANSLATE_SELECTION',
          payload: {
            requestId: snapshot.requestId,
            text: snapshot.normalizedText,
            pageUrl: snapshot.pageUrl,
            targetLanguage: settings.targetLanguage,
            sourceLanguage: settings.sourceLanguage,
            style: settings.style,
          },
        } satisfies RuntimeMessage)) as TranslateRuntimeResponse;

        if (activeSelection?.requestId !== snapshot.requestId) return;
        if (response.ok) {
          overlay.showResult(response.data, selectionRect(snapshot));
          return;
        }
        const message = ERROR_MESSAGES[response.error.code] ?? response.error.message;
        overlay.showError(
          {
            message,
            showSettings:
              response.error.code === 'NO_API_KEY' || response.error.code === 'AUTH_FAILED',
          },
          selectionRect(snapshot),
        );
      } catch {
        overlay.showError(
          { message: '扩展后台暂时不可用，请重试。', showSettings: false },
          selectionRect(snapshot),
        );
      }
    }

    const messageListener = (message: unknown): void => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const typed = message as RuntimeMessage;
      if (typed.type === 'TRIGGER_TRANSLATE') {
        const snapshot = captureSelectionSnapshot();
        if (snapshot) {
          latestSelection = snapshot;
          void translate(snapshot);
        } else {
          overlay.showError({
            message: ERROR_MESSAGES['EMPTY_SELECTION'] ?? '请先选中需要翻译的文本。',
            showSettings: false,
          });
        }
      }
      if (typed.type === 'CONTEXT_MENU_TRANSLATE') {
        const current = captureSelectionSnapshot();
        const snapshot = {
          ...typed.payload,
          ...(current?.rect ? { rect: current.rect } : {}),
        };
        latestSelection = snapshot;
        void translate(snapshot);
      }
    };

    document.addEventListener('selectionchange', scheduleRefresh);
    document.addEventListener('mouseup', scheduleRefresh, true);
    document.addEventListener('keyup', scheduleRefresh, true);
    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('scroll', scheduleRefresh, true);
    browser.runtime.onMessage.addListener(messageListener);

    ctx.onInvalidated(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener('selectionchange', scheduleRefresh);
      document.removeEventListener('mouseup', scheduleRefresh, true);
      document.removeEventListener('keyup', scheduleRefresh, true);
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('scroll', scheduleRefresh, true);
      browser.runtime.onMessage.removeListener(messageListener);
      overlay.destroy();
    });
  },
});
