import { isExtensionPdfReaderUrl } from '../pdf/source';
import { savePdfReadingState } from '../pdf/reading-state';
import { TranslationError } from '../messaging/errors';
import { errorResponse } from './runtime-response';
import type { RuntimeMessageHandlers } from './runtime-message-router';

export function createPdfReadingMessageHandlers(readerUrl: string): Required<
  Pick<RuntimeMessageHandlers, 'SAVE_PDF_READING_STATE'>
> {
  return {
    SAVE_PDF_READING_STATE: async (message, sender) => {
      if (!isExtensionPdfReaderUrl(sender.url ?? sender.tab?.url ?? '', readerUrl)) {
        return errorResponse(new TranslationError('UNSUPPORTED_PAGE', '当前页面无法保存 PDF 阅读位置。', false));
      }
      await savePdfReadingState(`pdf-content:${message.payload.fingerprint}`, message.payload.state,message.payload.document,message.payload.opened===true);
      return { ok: true as const, data: { saved: true } };
    },
  };
}
