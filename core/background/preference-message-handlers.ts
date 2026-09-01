import { mutateSettings } from '../settings/repository';
import { setSitePaused } from '../settings/site-pause';
import type { RuntimeMessageHandlers } from './runtime-message-router';

type PreferenceMessageType = 'SET_SIDEBAR_WIDTH' | 'PAUSE_CURRENT_SITE';

export const preferenceMessageHandlers: Required<
  Pick<RuntimeMessageHandlers, PreferenceMessageType>
> = {
  SET_SIDEBAR_WIDTH: async (message) => {
    const width = Math.min(640, Math.max(320, Math.round(message.payload.width)));
    await mutateSettings((settings) => ({
      nextSettings: { ...settings, sidebarWidth: width },
      value: undefined,
    }));
    return { ok: true as const, data: { width } };
  },
  PAUSE_CURRENT_SITE: async (message) => ({
    ok: true as const,
    data: { hostname: await setSitePaused(message.payload.pageUrl, true) },
  }),
};
