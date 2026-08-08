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

export interface TranslationRenderPerformance {
  /** Time spent synchronously building the text and math placeholder DOM. */
  textRenderMs: number;
  /** Time from the completed placeholder DOM until every MathML batch settles. */
  mathRenderMs: number;
  mathBatchCount: number;
  mathRenderFailed: boolean;
}

export type TranslationRenderPerformanceCallback = (
  performance: TranslationRenderPerformance,
) => void;

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

function requestMathBatch(jobs: MathRenderJob[]): Promise<boolean> {
  try {
    return browser.runtime.sendMessage({
      type: 'RENDER_LATEX_MATHML_BATCH',
      payload: {
        items: jobs.map(({ tex, displayMode }) => ({ tex, displayMode })),
      },
    } satisfies RuntimeMessage).then((response: LatexMathMlBatchResponse) => {
      if (!response.ok) return false;
      let renderedEveryFormula = response.data.html.length === jobs.length;
      jobs.forEach((job, index) => {
        const html = response.data.html[index];
        if (!html) renderedEveryFormula = false;
        applyRenderedMath(job, html);
      });
      return renderedEveryFormula;
    }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

function notifyPerformance(
  callback: TranslationRenderPerformanceCallback | undefined,
  metrics: TranslationRenderPerformance,
): void {
  try {
    callback?.(metrics);
  } catch {
    // Performance diagnostics must never interfere with result rendering.
  }
}

/**
 * Shared result renderer for page overlays and the Edge native PDF side panel.
 * Copy/export continues to use the untouched translation string.
 */
export function renderTranslationContent(
  container: HTMLElement,
  text: string,
  renderLatex: boolean,
  onPerformance?: TranslationRenderPerformanceCallback,
): Promise<TranslationRenderPerformance> {
  return renderTranslationContents([{ container, text, renderLatex }], onPerformance);
}

/**
 * Renders several result containers while sharing one MathML request queue.
 * This keeps sentence-aligned results from sending one extension message per
 * sentence when many rows contain formulae.
 */
export function renderTranslationContents(
  targets: TranslationContentTarget[],
  onPerformance?: TranslationRenderPerformanceCallback,
): Promise<TranslationRenderPerformance> {
  const renderStartedAt = performance.now();
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
  const textRenderedAt = performance.now();
  const textRenderMs = Math.max(0, textRenderedAt - renderStartedAt);
  if (!jobs.length) {
    const metrics: TranslationRenderPerformance = {
      textRenderMs,
      mathRenderMs: 0,
      mathBatchCount: 0,
      mathRenderFailed: false,
    };
    notifyPerformance(onPerformance, metrics);
    return Promise.resolve(metrics);
  }

  const batches: Array<Promise<boolean>> = [];
  for (let offset = 0; offset < jobs.length; offset += RENDER_BATCH_SIZE) {
    batches.push(requestMathBatch(jobs.slice(offset, offset + RENDER_BATCH_SIZE)));
  }
  return Promise.all(batches).then((outcomes) => {
    const metrics: TranslationRenderPerformance = {
      textRenderMs,
      mathRenderMs: Math.max(0, performance.now() - textRenderedAt),
      mathBatchCount: batches.length,
      mathRenderFailed: outcomes.some((outcome) => !outcome),
    };
    notifyPerformance(onPerformance, metrics);
    return metrics;
  });
}
