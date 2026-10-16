import { formulaDocumentParts, formulaReviewLabel, type FormulaDocument } from '../core/translation/formula-document';
import { renderTranslationContents, type TranslationContentTarget } from './translation-content';

/** Render math atom by atom. Plain template text is never interpreted as TeX. */
export async function renderFormulaDocument(
  container: HTMLElement, doc: FormulaDocument, renderLatex: boolean, onReview?: () => void,
): Promise<void> {
  const fragment = container.ownerDocument.createDocumentFragment();
  const pending: TranslationContentTarget[] = [];
  const groups: HTMLElement[] = [];
  let group: { id: string; element: HTMLElement } | undefined;
  for (const part of formulaDocumentParts(doc)) {
    if ('text' in part) {
      if (part.text.trim()) group = undefined;
      (group?.element ?? fragment).append(container.ownerDocument.createTextNode(part.text));
      continue;
    }
    const entry = part.formula;
    const element = container.ownerDocument.createElement(entry.review && onReview ? 'button' : entry.display ? 'div' : 'span');
    element.dataset.formulaId = entry.id;
    element.dataset.formulaOccurrence = part.occurrenceId;
    if (entry.sourceEquationId) element.dataset.sourceEquationId = entry.sourceEquationId;
    if (entry.review) {
      element.className = 'pdf-formula-reference-review';
      element.textContent = formulaReviewLabel(entry);
      element.title = `公式 ${entry.id.slice(1)} 待核对：${entry.review}；查看完整原文`;
      element.setAttribute('aria-label', element.title);
      if (onReview) {
        (element as HTMLButtonElement).type = 'button';
        element.addEventListener('click', (event) => { event.stopPropagation(); onReview(); });
      }
    } else {
      element.className = entry.display ? 'pdf-formula-reference-display' : 'pdf-formula-reference-inline';
      if (entry.display) element.style.display = 'block';
      pending.push({ container: element, text: entry.display ? `\\[${entry.latex}\\]` : `$${entry.latex}$`,
        renderLatex, formulaDisplayMode: entry.display, ...(entry.equationNumber ? { equationNumber: entry.equationNumber } : {}) });
    }
    if (entry.equationGroupId && entry.display && !entry.review) {
      if (group?.id !== entry.equationGroupId) {
        const wrapper = container.ownerDocument.createElement('div');
        wrapper.className = 'pdf-equation-row-group';
        groups.push(wrapper);
        wrapper.style.cssText = 'position:relative;padding-left:20px;margin:12px 0';
        // Vector brace stretches vertically without distorting the row layout.
        const brace = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
        brace.setAttribute('viewBox', '0 0 12 100');
        brace.setAttribute('preserveAspectRatio', 'none');
        brace.setAttribute('aria-hidden', 'true');
        brace.setAttribute('style', 'position:absolute;left:0;top:0;width:12px;height:100%;fill:none;stroke:currentColor;stroke-width:1.2');
        const path = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M11 1 C3 1 6 40 3 46 L1 50 L3 54 C6 60 3 99 11 99');
        brace.append(path);
        wrapper.append(brace);
        fragment.append(wrapper);
        group = { id: entry.equationGroupId, element: wrapper };
      }
      group.element.append(element);
    } else {
      group = undefined;
      fragment.append(element);
    }
  }
  // Publish the new nodes synchronously; a later, superseding render cannot be
  // overwritten when an earlier asynchronous KaTeX import finishes.
  container.replaceChildren(fragment);
  await renderTranslationContents(pending);
  for (const wrapper of groups) {
    if (!wrapper.isConnected) continue;
    const rows = Array.from(wrapper.children).filter((child): child is HTMLElement => child.hasAttribute('data-formula-id'));
    if (!rows.length || rows.some((row) => !row.querySelector('.pi-math-numbered > .pi-math-scroll'))) continue;
    wrapper.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 12px minmax(0,max-content) minmax(8px,1fr) auto;align-items:center;column-gap:4px;row-gap:12px;margin:12px 0;white-space:normal';
    const brace = wrapper.querySelector('svg')!;
    brace.setAttribute('style', `grid-column:2;grid-row:1 / span ${rows.length};width:12px;height:100%;min-height:0;fill:none;stroke:currentColor;stroke-width:1.2`);
    rows.forEach((row, index) => {
      row.style.display = 'contents';
      const math = row.querySelector<HTMLElement>('.pi-math-numbered')!;
      math.style.display = 'contents';
      const scroll = math.querySelector<HTMLElement>('.pi-math-scroll')!;
      const tag = math.querySelector<HTMLElement>('.pi-equation-tag')!;
      scroll.style.cssText = `grid-column:3;grid-row:${index + 1};min-width:0;padding:4px 0;overflow-x:auto`;
      tag.style.cssText = `grid-column:5;grid-row:${index + 1}`;
    });
  }
}
