import { captureRenderedFormula } from '../core/content/rendered-formula-capture';
import { startSelectionTranslator } from '../core/content/selection-translator';
import type {
  ActivePdfSourceResponse,
  RuntimeMessage,
} from '../core/messaging/messages';
import {
  resolveOverleafPdfPreview,
  type OverleafPdfCandidate,
} from '../core/pdf/overleaf-preview';

function isVisible(element: Element): boolean {
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    element.getClientRects().length > 0
  );
}

function activePdfPreview(): ActivePdfSourceResponse {
  const candidates: OverleafPdfCandidate[] = [];
  document.querySelectorAll<HTMLIFrameElement>('iframe[src]').forEach((element) => {
    candidates.push({ url: element.src, kind: 'frame', visible: isVisible(element) });
  });
  document.querySelectorAll<HTMLEmbedElement>('embed[src]').forEach((element) => {
    candidates.push({ url: element.src, kind: 'embed', visible: isVisible(element) });
  });
  document.querySelectorAll<HTMLObjectElement>('object[data]').forEach((element) => {
    candidates.push({ url: element.data, kind: 'object', visible: isVisible(element) });
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((element) => {
    const label = [
      element.textContent,
      element.getAttribute('aria-label'),
      element.title,
    ].filter(Boolean).join(' ').trim();
    candidates.push({
      url: element.href,
      kind: 'download',
      visible: isVisible(element),
      ...(label ? { label } : {}),
    });
  });
  return {
    ok: true,
    data: resolveOverleafPdfPreview(candidates, location.href),
  };
}

export default defineContentScript({
  matches: ['https://www.overleaf.com/project/*'],
  runAt: 'document_idle',
  main: async (ctx) => {
    const messageListener = (message: unknown) => {
      const typed = message as Partial<RuntimeMessage> | undefined;
      if (typed?.type === 'GET_ACTIVE_PDF_SOURCE') return activePdfPreview();
      return undefined;
    };
    browser.runtime.onMessage.addListener(messageListener);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(messageListener));
    return startSelectionTranslator(ctx, 'overleaf', {
      captureVisualSelection: captureRenderedFormula,
    });
  },
});
