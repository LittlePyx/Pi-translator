import type {
  PublicSettings,
  PublicSettingsResponse,
  RuntimeMessage,
  TranslateRuntimeResponse,
} from '../messaging/messages';
import {
  runtimeConnectionErrorMessage,
  translationErrorMessage,
} from '../messaging/user-facing-error';
import { captureSelectionSnapshot } from '../selection/generic-selection';
import type { SelectionSnapshot, ViewportRect } from '../selection/types';
import { isLikelyTargetLanguage } from '../language/target-language';
import { TranslationOverlay } from '../../ui/translation-overlay';

interface ContentScriptRuntimeContext {
  onInvalidated(callback: () => void): unknown;
}

type TranslationSurface = 'overleaf' | 'general';

const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  showFloatingButtonOnOverleaf: true,
  hideFloatingButtonForTargetLanguage: true,
  generalPageMode: 'on-demand',
  siteAllowlist: [],
  pausedSiteHosts: [],
};

function shouldShowFloatingButton(
  settings: PublicSettings,
  surface: TranslationSurface,
): boolean {
  if (settings.pausedSiteHosts.includes(location.hostname.toLowerCase())) {
    return false;
  }
  if (surface === 'overleaf') return settings.showFloatingButtonOnOverleaf;
  return (
    settings.generalPageMode === 'allowlist' ||
    settings.generalPageMode === 'all-sites'
  );
}

export async function startSelectionTranslator(
  ctx: ContentScriptRuntimeContext,
  surface: TranslationSurface,
): Promise<void> {
  let settings = DEFAULT_PUBLIC_SETTINGS;
  let latestSelection: SelectionSnapshot | undefined;
  let activeSelection: SelectionSnapshot | undefined;
  let inFlightRequestId: string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelActiveTranslation(): void {
    const requestId = inFlightRequestId;
    activeSelection = undefined;
    inFlightRequestId = undefined;
    if (!requestId) return;
    void browser.runtime
      .sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId },
      } satisfies RuntimeMessage)
      .catch(() => undefined);
  }

  const overlay = new TranslationOverlay({
    onTranslate: () => {
      if (latestSelection) void translate(latestSelection);
    },
    onRetry: () => {
      if (activeSelection) void translate(activeSelection);
    },
    onOpenSettings: () => void browser.runtime.openOptionsPage(),
    onDismiss: cancelActiveTranslation,
  });

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_PUBLIC_SETTINGS',
    } satisfies RuntimeMessage)) as PublicSettingsResponse;
    if (response.ok) settings = response.data;
  } catch {
    // Defaults keep the content UI usable while the service worker restarts.
  }

  function selectionRect(snapshot: SelectionSnapshot): ViewportRect | undefined {
    return snapshot.rect;
  }

  function refreshSelection(): void {
    if (!shouldShowFloatingButton(settings, surface)) {
      overlay.hideTrigger();
      return;
    }
    const snapshot = captureSelectionSnapshot();
    latestSelection = snapshot;
    if (
      surface === 'general' &&
      settings.hideFloatingButtonForTargetLanguage &&
      snapshot &&
      isLikelyTargetLanguage(snapshot.normalizedText, settings.targetLanguage)
    ) {
      overlay.hideTrigger();
      return;
    }
    if (snapshot?.rect) {
      if (
        overlay.isShowingCard() &&
        activeSelection?.selectionHash === snapshot.selectionHash
      ) {
        overlay.keepCardInViewport();
        return;
      }
      if (overlay.isShowingCard()) cancelActiveTranslation();
      overlay.showTrigger(snapshot.rect);
    } else {
      overlay.hideTrigger();
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshSelection, 60);
  }

  async function translate(snapshot: SelectionSnapshot): Promise<void> {
    const isRetry = activeSelection?.requestId === snapshot.requestId;
    if (!isRetry) overlay.resetCardPosition();
    activeSelection = snapshot;
    inFlightRequestId = snapshot.requestId;
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
          contentMode: settings.contentMode,
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;

      if (activeSelection?.requestId !== snapshot.requestId) return;
      inFlightRequestId = undefined;
      if (response.ok) {
        overlay.showResult(response.data, selectionRect(snapshot));
        return;
      }
      const message = translationErrorMessage(
        response.error.code,
        response.error.message,
      );
      overlay.showError(
        {
          message,
          showSettings:
            response.error.code === 'NO_API_KEY' || response.error.code === 'AUTH_FAILED',
        },
        selectionRect(snapshot),
      );
    } catch (error) {
      if (activeSelection?.requestId !== snapshot.requestId) return;
      inFlightRequestId = undefined;
      overlay.showError(
        {
          message: runtimeConnectionErrorMessage(error),
          showSettings: false,
        },
        selectionRect(snapshot),
      );
    }
  }

  const messageListener = (message: unknown): void => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const typed = message as RuntimeMessage;
    if (typed.type === 'PUBLIC_SETTINGS_UPDATED') {
      settings = typed.payload;
      refreshSelection();
      return;
    }
    if (typed.type === 'TRIGGER_TRANSLATE') {
      const snapshot = captureSelectionSnapshot();
      if (snapshot) {
        latestSelection = snapshot;
        void translate(snapshot);
      } else {
        cancelActiveTranslation();
        overlay.hide();
        void browser.runtime.openOptionsPage();
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
}
