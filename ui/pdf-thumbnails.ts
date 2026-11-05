import type {PDFDocumentProxy, RenderTask} from 'pdfjs-dist';
import {t,msg} from '../core/i18n/ui-language';
import type {PdfViewRotation} from '../core/pdf/reader-view';

/** Small, disposable previews. No PDF text, translation or storage writes. */
export function bindPdfThumbnails(panel: HTMLElement, navigate: (page: number) => void) {
  let pdf: PDFDocumentProxy | undefined, rotation: PdfViewRotation = 0;
  let observer: IntersectionObserver | undefined, task: RenderTask | undefined;
  let generation = 0, visible = false, running = false, current = 1;
  const intersecting = new Set<HTMLButtonElement>();
  const rendered = new Set<HTMLButtonElement>();
  const release = (button: HTMLButtonElement) => {
    const canvas = button.querySelector('canvas');
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
    delete button.dataset.rendered; rendered.delete(button);
  };
  function suspend() {
    generation++; task?.cancel(); task = undefined; running = false;
    observer?.disconnect(); observer = undefined; intersecting.clear();
    for (const button of rendered) release(button);
  }
  function desired() {
    const bounds = panel.getBoundingClientRect(), center = (bounds.top + bounds.bottom) / 2;
    return [...intersecting].sort((a,b) => Math.abs(a.getBoundingClientRect().top-center)-Math.abs(b.getBoundingClientRect().top-center)).slice(0,8);
  }
  async function renderVisible() {
    if (!pdf || !visible || running) return;
    const activePdf = pdf, run = generation; running = true;
    try {
      while (run === generation && visible) {
        const wanted = desired();
        for (const button of rendered) if (!wanted.includes(button)) release(button);
        const button = wanted.find(button => !button.dataset.rendered);
        if (!button) break;
        button.dataset.rendered = 'loading'; rendered.add(button);
        try {
          const page = await activePdf.getPage(Number(button.dataset.thumbnailPage));
          if (run !== generation) return;
          const base = page.getViewport({scale:1,rotation:(page.rotate+rotation)%360});
          const scale = Math.min(112/base.width,144/base.height);
          const viewport = page.getViewport({scale:scale*1.5,rotation:base.rotation});
          const canvas = document.createElement('canvas'); canvas.ariaHidden = 'true';
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${base.width*scale}px`; canvas.style.height = `${base.height*scale}px`;
          button.querySelector('.pdf-thumbnail-preview')!.append(canvas);
          const context = canvas.getContext('2d',{alpha:false});
          if (!context) throw new Error('Canvas unavailable');
          task = page.render({canvas,canvasContext:context,viewport}); await task.promise;
          if (run !== generation) return;
          button.dataset.rendered = 'ready';
        } catch {
          if (run !== generation) return;
          release(button); button.dataset.rendered = 'error';
          button.title = t('预览不可用，仍可跳转到此页');
        }
      }
    } finally { if (run === generation) { running = false; task = undefined; } }
  }
  function markCurrent(page: number) {
    const previous = panel.querySelector<HTMLElement>(`[data-thumbnail-page="${current}"]`);
    previous?.removeAttribute('aria-current'); if (previous) previous.tabIndex = -1;
    current = page;
    const selected = panel.querySelector<HTMLElement>(`[data-thumbnail-page="${page}"]`);
    selected?.setAttribute('aria-current','page'); if (selected) selected.tabIndex = 0;
  }
  function show(showing: boolean, page = current) {
    suspend(); visible = showing;
    if (!showing || !pdf) return;
    if (!panel.childElementCount) {
      const fragment = document.createDocumentFragment();
      for (let number=1; number<=pdf.numPages; number++) {
        const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
        button.dataset.thumbnailPage = String(number); button.className = 'pdf-thumbnail';
        button.setAttribute('aria-label',msg`跳转到第 ${number} 页`);
        const preview = document.createElement('span'); preview.className = 'pdf-thumbnail-preview'; preview.ariaHidden = 'true';
        const label = document.createElement('span'); label.textContent = String(number);
        button.append(preview,label); fragment.append(button);
      }
      panel.append(fragment);
    }
    markCurrent(page);
    panel.querySelector<HTMLElement>(`[data-thumbnail-page="${page}"]`)?.scrollIntoView({block:'nearest'});
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const button = entry.target as HTMLButtonElement;
        if (entry.isIntersecting) intersecting.add(button); else intersecting.delete(button);
      }
      void renderVisible();
    },{root:panel,rootMargin:'80px 0px'});
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-thumbnail-page]')) observer.observe(button);
  }
  panel.addEventListener('click',event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-thumbnail-page]') : null;
    if (button) navigate(Number(button.dataset.thumbnailPage));
  });
  panel.addEventListener('scroll',() => { void renderVisible(); },{passive:true});
  panel.addEventListener('keydown',event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-thumbnail-page]') : null;
    if (!button || !pdf) return;
    const page = Number(button.dataset.thumbnailPage);
    const next = event.key==='Home'?1:event.key==='End'?pdf.numPages:
      event.key==='ArrowDown'?page+2:event.key==='ArrowUp'?page-2:
      event.key==='ArrowRight'?page+1:event.key==='ArrowLeft'?page-1:undefined;
    if (next===undefined) return;
    event.preventDefault();
    panel.querySelector<HTMLButtonElement>(`[data-thumbnail-page="${Math.max(1,Math.min(pdf.numPages,next))}"]`)?.focus();
  });
  return {
    show, markCurrent,
    reset(document?: PDFDocumentProxy, angle: PdfViewRotation = 0) {
      suspend(); pdf = document; rotation = angle; panel.replaceChildren(); current = Math.min(current,pdf?.numPages ?? 1);
      if (visible && pdf) show(true,current);
    },
  };
}
