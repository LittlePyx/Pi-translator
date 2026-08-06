import type {
  LatexMathMlBatchResponse,
  RuntimeMessage,
} from '../core/messaging/messages';
import {
  latexRenderParts,
  splitLatexDisplaySegments,
} from '../core/translation/latex-display';
import { splitLightMarkupWithRanges } from '../core/translation/light-markup';

interface MathRenderJob {
  element: HTMLElement;
  tex: string;
  displayMode: boolean;
  equationTag?: string;
}

export interface TranslationContentTarget {
  container: HTMLElement;
  text: string;
  renderLatex: boolean;
}

const RENDER_BATCH_SIZE = 64;

function appendStyledText(parent: HTMLElement, text: string, strong: boolean): void {
  if (!text) return;
  if (strong) {
    const strong = document.createElement('strong');
    strong.className = 'pi-rich-strong';
    strong.textContent = text;
    parent.append(strong);
    return;
  }
  parent.append(document.createTextNode(text));
}

function applyRenderedMath(job: MathRenderJob, html: string | null | undefined): void {
  if (!html || !job.element.isConnected) return;
  if (!job.equationTag) {
    job.element.innerHTML = html;
    return;
  }
  const scroll = document.createElement('span');
  scroll.className = 'pi-math-scroll';
  scroll.innerHTML = html;
  const tag = document.createElement('span');
  tag.className = 'pi-equation-tag';
  tag.textContent = `(${job.equationTag})`;
  job.element.classList.add('pi-math-numbered');
  job.element.replaceChildren(scroll, tag);
}

function requestMathBatch(jobs: MathRenderJob[]): void {
  void browser.runtime.sendMessage({
    type: 'RENDER_LATEX_MATHML_BATCH',
    payload: {
      items: jobs.map(({ tex, displayMode }) => ({ tex, displayMode })),
    },
  } satisfies RuntimeMessage).then((response: LatexMathMlBatchResponse) => {
    if (!response.ok) return;
    jobs.forEach((job, index) => applyRenderedMath(job, response.data.html[index]));
  }).catch(() => undefined);
}

/**
 * Shared result renderer for page overlays and the Edge native PDF side panel.
 * Copy/export continues to use the untouched translation string.
 */
export function renderTranslationContent(
  container: HTMLElement,
  text: string,
  renderLatex: boolean,
): void {
  renderTranslationContents([{ container, text, renderLatex }]);
}

/**
 * Renders several result containers while sharing one MathML request queue.
 * This keeps sentence-aligned results from sending one extension message per
 * sentence when many rows contain formulae.
 */
export function renderTranslationContents(targets: TranslationContentTarget[]): void {
  const jobs: MathRenderJob[] = [];
  for (const target of targets) {
    target.container.replaceChildren();
    for (const markup of splitLightMarkupWithRanges(target.text)) {
      const isStrong = markup.kind === 'strong';
      for (const segment of splitLatexDisplaySegments(markup.text, {
        sourceText: target.text,
        sourceOffset: markup.sourceStart,
      })) {
        if (segment.kind === 'text') {
          appendStyledText(target.container, segment.text, isStrong);
          continue;
        }
        if (!target.renderLatex) {
          appendStyledText(target.container, segment.raw, isStrong);
          continue;
        }
        const math = document.createElement(segment.displayMode ? 'div' : 'span');
        math.className = `pi-math ${segment.displayMode ? 'pi-math-display' : 'pi-math-inline'}`;
        if (isStrong) math.classList.add('pi-rich-strong');
        math.textContent = segment.raw;
        target.container.append(math);
        const parts = latexRenderParts(segment.tex, segment.displayMode);
        jobs.push({
          element: math,
          tex: parts.tex,
          displayMode: segment.displayMode,
          ...(parts.equationTag ? { equationTag: parts.equationTag } : {}),
        });
      }
    }
  }
  for (let offset = 0; offset < jobs.length; offset += RENDER_BATCH_SIZE) {
    requestMathBatch(jobs.slice(offset, offset + RENDER_BATCH_SIZE));
  }
}
