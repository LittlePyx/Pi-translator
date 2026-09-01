import { TranslationError } from '../messaging/errors';
import type { RuntimeMessage } from '../messaging/messages';
import { getSettings } from '../settings/repository';
import { isInjectableWebUrl, isOverleafProjectUrl } from '../settings/site-access';
import { translationBehaviorFingerprint } from '../settings/translation-configuration';
import {
  bilingualPageSessionBehaviorKey,
  clearBilingualPageSession,
  clearRetainedBilingualPageSession,
  getBilingualPageSession,
  getRetainedBilingualPageSession,
  saveBilingualPageSession,
  saveRetainedBilingualPageSession,
} from '../translation/bilingual-page-session';
import type {
  RuntimeMessageHandlers,
  RuntimeMessageSender,
} from './runtime-message-router';
import { errorResponse } from './runtime-response';

type BilingualSessionMessage = Extract<RuntimeMessage, {
  type:
    | 'GET_BILINGUAL_PAGE_SESSION'
    | 'SAVE_BILINGUAL_PAGE_SESSION'
    | 'CLEAR_BILINGUAL_PAGE_SESSION'
    | 'GET_RETAINED_BILINGUAL_PAGE_SESSION'
    | 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION'
    | 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION';
}>;

type BilingualSessionMessageType = BilingualSessionMessage['type'];

async function currentBehaviorKey(): Promise<string> {
  return bilingualPageSessionBehaviorKey(
    translationBehaviorFingerprint(await getSettings()),
  );
}

async function handleBilingualSessionMessage(
  message: BilingualSessionMessage,
  sender: RuntimeMessageSender,
): Promise<unknown> {
  const tabId = sender.tab?.id;
  const sourceUrl = sender.url ?? sender.tab?.url;
  if (
    tabId === undefined ||
    (sender.frameId ?? 0) !== 0 ||
    !sourceUrl ||
    !isInjectableWebUrl(sourceUrl) ||
    isOverleafProjectUrl(sourceUrl)
  ) {
    return errorResponse(new TranslationError(
      'UNSUPPORTED_PAGE',
      '正文会话只能由当前普通网页恢复。',
      false,
    ));
  }

  try {
    const behaviorKey = await currentBehaviorKey();
    if (message.type === 'GET_BILINGUAL_PAGE_SESSION') {
      const session = await getBilingualPageSession(
        tabId,
        message.payload.descriptor,
        behaviorKey,
      );
      return { ok: true as const, data: { ...(session ? { session } : {}) } };
    }
    if (message.type === 'GET_RETAINED_BILINGUAL_PAGE_SESSION') {
      const session = await getRetainedBilingualPageSession(
        message.payload.descriptor,
        behaviorKey,
      );
      return { ok: true as const, data: { ...(session ? { session } : {}) } };
    }
    if (message.type === 'SAVE_BILINGUAL_PAGE_SESSION') {
      await saveBilingualPageSession(tabId, message.payload, behaviorKey);
      return { ok: true as const, data: {} };
    }
    if (message.type === 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION') {
      await saveRetainedBilingualPageSession(message.payload, behaviorKey);
      return { ok: true as const, data: {} };
    }
    if (message.type === 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION') {
      await clearRetainedBilingualPageSession(message.payload.descriptor);
      return { ok: true as const, data: {} };
    }
    await clearBilingualPageSession(tabId, message.payload.descriptor);
    return { ok: true as const, data: {} };
  } catch (error) {
    return errorResponse(error);
  }
}

export const bilingualSessionMessageHandlers: Required<
  Pick<RuntimeMessageHandlers, BilingualSessionMessageType>
> = {
  GET_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
  SAVE_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
  CLEAR_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
  GET_RETAINED_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
  SAVE_RETAINED_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
  CLEAR_RETAINED_BILINGUAL_PAGE_SESSION: handleBilingualSessionMessage,
};
