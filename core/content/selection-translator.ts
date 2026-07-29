import type {
  PublicSettings,
  PublicSettingsResponse,
  RuntimeMessage,
  TranslationFavoritesResponse,
  TranslationHistoryResponse,
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

type TranslationSurface = 'overleaf' | 'general' | 'pdf';

interface SelectionTranslatorOptions {
  pageUrl?: () => string;
  sourceLabel?: () => string | undefined;
  allowSitePause?: boolean;
}

export interface ImageRegionTranslationCapture {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  rect: ViewportRect;
  pageUrl: string;
  sourceLabel?: string;
}

export interface SelectionTranslatorController {
  translateImageRegion(capture: ImageRegionTranslationCapture): Promise<void>;
}

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
  sentenceAlignmentDefault: false,
  historyLimit: 5,
  sidebarSide: 'right',
  sidebarWidth: 390,
  contextMode: 'off',
  enableStreaming: true,
  protectSensitiveFields: true,
  activeApiProfileId: 'default',
  apiProfiles: [{ id: 'default', name: '默认接口', model: '' }],
};

function shouldShowFloatingButton(
  settings: PublicSettings,
  surface: TranslationSurface,
): boolean {
  if (surface === 'pdf') return true;
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
  options: SelectionTranslatorOptions = {},
): Promise<SelectionTranslatorController> {
  let settings = DEFAULT_PUBLIC_SETTINGS;
  let latestSelection: SelectionSnapshot | undefined;
  let activeSelection: SelectionSnapshot | undefined;
  let activeImageRegion: ImageRegionTranslationCapture | undefined;
  let inFlightRequestId: string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let autoTranslateTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAutoSelectionHash: string | undefined;
  let temporaryTargetLanguage = settings.targetLanguage;
  let temporaryStyle = settings.style;

  function cancelActiveTranslation(): void {
    const requestId = inFlightRequestId;
    activeSelection = undefined;
    inFlightRequestId = undefined;
    activeImageRegion = undefined;
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
      if (activeImageRegion) void translateImageRegion(activeImageRegion, true);
      else if (activeSelection) void translate(activeSelection, true);
    },
    onTranslateText: (text) => {
      const basis = activeSelection ?? latestSelection;
      if (!basis) return;
      const requestId = crypto.randomUUID();
      void translate({
        ...basis,
        requestId,
        sourceText: text,
        normalizedText: text.trim(),
        capturedAt: Date.now(),
        selectionHash: `${requestId}:${text.length}`,
      }, true);
    },
    onOpenSettings: () => {
      void browser.runtime.sendMessage({
        type: 'OPEN_OPTIONS_PAGE',
      } satisfies RuntimeMessage);
    },
    onClearHistory: async () => {
      await browser.runtime.sendMessage({
        type: 'CLEAR_TRANSLATION_HISTORY',
      } satisfies RuntimeMessage);
    },
    onDeleteHistory: async (historyId) => {
      const response = (await browser.runtime.sendMessage({
        type: 'DELETE_TRANSLATION_HISTORY',
        payload: { historyId },
      } satisfies RuntimeMessage)) as TranslationHistoryResponse;
      return response.ok ? response.data.history : [];
    },
    onPinHistory: async (historyId, pinned) => {
      const response = (await browser.runtime.sendMessage({
        type: 'PIN_TRANSLATION_HISTORY',
        payload: { historyId, pinned },
      } satisfies RuntimeMessage)) as TranslationHistoryResponse;
      return response.ok ? response.data.history : [];
    },
    onSaveFavorite: async (result) => {
      const response = (await browser.runtime.sendMessage({
        type: 'ADD_TRANSLATION_FAVORITE',
        payload: { result },
      } satisfies RuntimeMessage)) as TranslationFavoritesResponse;
      return response.ok ? response.data.favorites : [];
    },
    onGetFavorites: async (query) => {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_TRANSLATION_FAVORITES',
        ...(query ? { payload: { query } } : {}),
      } satisfies RuntimeMessage)) as TranslationFavoritesResponse;
      return response.ok ? response.data.favorites : [];
    },
    onDeleteFavorite: async (favoriteId) => {
      const response = (await browser.runtime.sendMessage({
        type: 'DELETE_TRANSLATION_FAVORITE',
        payload: { favoriteId },
      } satisfies RuntimeMessage)) as TranslationFavoritesResponse;
      return response.ok ? response.data.favorites : [];
    },
    ...(options.allowSitePause === false
      ? {}
      : {
          onPauseSite: async () => {
            await browser.runtime.sendMessage({
              type: 'PAUSE_CURRENT_SITE',
              payload: { pageUrl: location.href },
            } satisfies RuntimeMessage);
          },
        }),
    onSidebarChange: (active) => {
      if (active) {
        lastAutoSelectionHash = activeSelection?.selectionHash;
        scheduleRefresh();
        return;
      }
      if (!active) {
        lastAutoSelectionHash = undefined;
        if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      }
    },
    onSidebarWidthChange: (width) => {
      void browser.runtime.sendMessage({
        type: 'SET_SIDEBAR_WIDTH',
        payload: { width },
      } satisfies RuntimeMessage);
    },
    onPreferencesChange: (preferences) => {
      temporaryTargetLanguage = preferences.targetLanguage;
      temporaryStyle = preferences.style;
    },
    onDismiss: cancelActiveTranslation,
  });

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_PUBLIC_SETTINGS',
    } satisfies RuntimeMessage)) as PublicSettingsResponse;
    if (response.ok) {
      settings = response.data;
      temporaryTargetLanguage = settings.targetLanguage;
      temporaryStyle = settings.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
      });
    }
  } catch {
    // Defaults keep the content UI usable while the service worker restarts.
  }

  function selectionRect(snapshot: SelectionSnapshot): ViewportRect | undefined {
    return snapshot.rect;
  }

  function refreshSelection(): void {
    if (overlay.ownsCurrentSelection()) return;
    const snapshot = captureSelectionSnapshot(settings.contextMode);
    latestSelection = snapshot;
    if (overlay.isSidebarActive()) {
      overlay.hideTrigger();
      if (
        !snapshot ||
        (surface === 'general' &&
          settings.hideFloatingButtonForTargetLanguage &&
          isLikelyTargetLanguage(snapshot.normalizedText, temporaryTargetLanguage)) ||
        snapshot.selectionHash === lastAutoSelectionHash
      ) {
        return;
      }
      if (settings.protectSensitiveFields && snapshot.sensitiveField) {
        lastAutoSelectionHash = snapshot.selectionHash;
        overlay.showSensitiveNotice(selectionRect(snapshot));
        return;
      }
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      autoTranslateTimer = setTimeout(() => {
        const current = captureSelectionSnapshot(settings.contextMode);
        if (!current || current.selectionHash !== snapshot.selectionHash) return;
        lastAutoSelectionHash = snapshot.selectionHash;
        void translate(snapshot);
      }, 220);
      return;
    }
    if (!shouldShowFloatingButton(settings, surface)) {
      overlay.hideTrigger();
      return;
    }
    if (
      surface === 'general' &&
      settings.hideFloatingButtonForTargetLanguage &&
      snapshot &&
      isLikelyTargetLanguage(snapshot.normalizedText, temporaryTargetLanguage)
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

  async function translate(snapshot: SelectionSnapshot, bypassCache = false): Promise<void> {
    if (inFlightRequestId && inFlightRequestId !== snapshot.requestId) {
      const previousRequestId = inFlightRequestId;
      void browser.runtime.sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId: previousRequestId },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    const isRetry = activeSelection?.requestId === snapshot.requestId;
    if (!isRetry) overlay.resetCardPosition();
    activeImageRegion = undefined;
    activeSelection = snapshot;
    inFlightRequestId = snapshot.requestId;
    overlay.showLoading(selectionRect(snapshot));
    const sourceLabel = options.sourceLabel?.();
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_SELECTION',
        payload: {
          requestId: snapshot.requestId,
          text: snapshot.normalizedText,
          pageUrl: options.pageUrl?.() ?? snapshot.pageUrl,
          ...(sourceLabel ? { sourceLabel } : {}),
          targetLanguage: temporaryTargetLanguage,
          sourceLanguage: settings.sourceLanguage,
          style: temporaryStyle,
          contentMode: settings.contentMode,
          ...(snapshot.contextText ? { contextText: snapshot.contextText } : {}),
          ...(bypassCache ? { bypassCache: true } : {}),
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;

      if (activeSelection?.requestId !== snapshot.requestId) return;
      inFlightRequestId = undefined;
      if (response.ok) {
        overlay.showResult(
          response.data.result,
          selectionRect(snapshot),
          response.data.history,
          settings.sentenceAlignmentDefault,
        );
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
            response.error.code === 'NO_API_KEY' ||
            response.error.code === 'AUTH_FAILED' ||
            response.error.code === 'PAYMENT_REQUIRED' ||
            response.error.code === 'MODEL_NOT_FOUND' ||
            response.error.code === 'API_PERMISSION_REQUIRED',
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

  async function translateImageRegion(
    capture: ImageRegionTranslationCapture,
    isRetry = false,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    if (inFlightRequestId) {
      const previousRequestId = inFlightRequestId;
      void browser.runtime.sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId: previousRequestId },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    if (!isRetry) overlay.resetCardPosition();
    activeSelection = undefined;
    activeImageRegion = capture;
    inFlightRequestId = requestId;
    overlay.showLoading(capture.rect);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_IMAGE_REGION',
        payload: {
          requestId,
          imageDataUrl: capture.imageDataUrl,
          imageWidth: capture.imageWidth,
          imageHeight: capture.imageHeight,
          pageUrl: capture.pageUrl,
          ...(capture.sourceLabel ? { sourceLabel: capture.sourceLabel } : {}),
          targetLanguage: temporaryTargetLanguage,
          sourceLanguage: settings.sourceLanguage,
          style: temporaryStyle,
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;
      if (inFlightRequestId !== requestId) return;
      inFlightRequestId = undefined;
      if (response.ok) {
        overlay.showResult(
          response.data.result,
          capture.rect,
          response.data.history,
          false,
        );
        return;
      }
      overlay.showError(
        {
          message: translationErrorMessage(response.error.code, response.error.message),
          showSettings:
            response.error.code === 'NO_API_KEY' ||
            response.error.code === 'AUTH_FAILED' ||
            response.error.code === 'PAYMENT_REQUIRED' ||
            response.error.code === 'MODEL_NOT_FOUND' ||
            response.error.code === 'API_PERMISSION_REQUIRED' ||
            response.error.code === 'VISION_NOT_CONFIGURED' ||
            response.error.code === 'VISION_MODEL_UNSUPPORTED',
        },
        capture.rect,
      );
    } catch (error) {
      if (inFlightRequestId !== requestId) return;
      inFlightRequestId = undefined;
      overlay.showError(
        { message: runtimeConnectionErrorMessage(error), showSettings: false },
        capture.rect,
      );
    }
  }

  const messageListener = (message: unknown): void => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const typed = message as RuntimeMessage;
    if (typed.type === 'TRANSLATION_PROGRESS') {
      if (typed.payload.requestId === inFlightRequestId) {
        overlay.showProgress(
          typed.payload.partialText,
          typed.payload.completedChunks,
          typed.payload.totalChunks,
        );
      }
      return;
    }
    if (typed.type === 'PUBLIC_SETTINGS_UPDATED') {
      settings = typed.payload;
      temporaryTargetLanguage = settings.targetLanguage;
      temporaryStyle = settings.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
      });
      refreshSelection();
      return;
    }
    if (typed.type === 'OPEN_SIDEBAR') {
      overlay.openSidebar();
      refreshSelection();
      return;
    }
    if (typed.type === 'TRIGGER_TRANSLATE') {
      const snapshot = captureSelectionSnapshot(settings.contextMode);
      if (snapshot) {
        latestSelection = snapshot;
        void translate(snapshot);
      } else {
        cancelActiveTranslation();
        overlay.hide();
        void browser.runtime.sendMessage({
          type: 'OPEN_OPTIONS_PAGE',
        } satisfies RuntimeMessage);
      }
    }
    if (typed.type === 'CONTEXT_MENU_TRANSLATE') {
      const current = captureSelectionSnapshot(settings.contextMode);
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
    if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
    document.removeEventListener('selectionchange', scheduleRefresh);
    document.removeEventListener('mouseup', scheduleRefresh, true);
    document.removeEventListener('keyup', scheduleRefresh, true);
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('scroll', scheduleRefresh, true);
    browser.runtime.onMessage.removeListener(messageListener);
    overlay.destroy();
    activeImageRegion = undefined;
  });

  return {
    translateImageRegion: (capture) => translateImageRegion(capture),
  };
}
