import type { PdfSidePanelSession } from '../messaging/messages';
import type { RuntimeMessageHandlers } from './runtime-message-router';

export interface PdfSessionMessageHandlerContext {
  getSession(tabId: number): Promise<PdfSidePanelSession | null>;
}

export function createPdfSessionMessageHandlers(
  context: PdfSessionMessageHandlerContext,
): Required<Pick<RuntimeMessageHandlers, 'GET_PDF_SIDE_PANEL_SESSION'>> {
  return {
    GET_PDF_SIDE_PANEL_SESSION: async (message) => ({
      ok: true as const,
      data: { session: await context.getSession(message.payload.tabId) },
    }),
  };
}
