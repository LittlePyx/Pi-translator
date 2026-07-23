import { startSelectionTranslator } from '../core/content/selection-translator';

export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_idle',
  main: (ctx) => startSelectionTranslator(ctx, 'general'),
});
