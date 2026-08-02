import { captureRenderedFormula } from '../core/content/rendered-formula-capture';
import { startSelectionTranslator } from '../core/content/selection-translator';

export default defineContentScript({
  matches: ['https://www.overleaf.com/project/*'],
  runAt: 'document_idle',
  main: (ctx) => startSelectionTranslator(ctx, 'overleaf', {
    captureVisualSelection: captureRenderedFormula,
  }),
});
