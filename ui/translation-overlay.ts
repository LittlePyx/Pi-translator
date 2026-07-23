import type { ViewportRect } from '../core/selection/types';
import type { TranslateResult } from '../core/translation/types';
import { detectPageTheme } from '../core/theme/page-theme';

const OVERLAY_STYLES = `
  :host {
    all: initial;
    color-scheme: light;
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  :host([data-pi-theme="dark"]) { color-scheme: dark; }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .trigger {
    position: fixed;
    z-index: 2147483647;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid rgba(99, 102, 241, .22);
    border-radius: 12px;
    background: rgba(255, 255, 255, .97);
    box-shadow: 0 7px 22px rgba(30, 41, 59, .2), 0 1px 4px rgba(30, 41, 59, .12);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
  }
  .trigger:hover {
    filter: brightness(1.06);
    transform: translateY(-2px) scale(1.04);
    box-shadow: 0 10px 28px rgba(30, 41, 59, .24), 0 2px 5px rgba(30, 41, 59, .16);
  }
  .trigger:active { transform: translateY(0) scale(.96); }
  .trigger:focus-visible { outline: 3px solid rgba(99, 102, 241, .28); outline-offset: 3px; }
  .trigger-logo { width: 23px; height: 20px; object-fit: contain; }
  .trigger-sparkle {
    position: absolute;
    top: -5px;
    right: -4px;
    color: #fbbf24;
    font-size: 11px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(71, 50, 8, .35));
  }
  .card {
    position: fixed;
    z-index: 2147483647;
    width: min(440px, calc(100vw - 24px));
    max-height: min(390px, calc(100vh - 24px));
    overflow: auto;
    border: 1px solid rgba(99, 102, 241, .16);
    border-radius: 17px;
    color: #172033;
    background: rgba(255, 255, 255, .985);
    box-shadow: 0 22px 60px rgba(15, 23, 42, .22), 0 3px 12px rgba(15, 23, 42, .08);
    padding: 16px;
    backdrop-filter: blur(18px);
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    border-radius: 17px 17px 0 0;
    background: linear-gradient(90deg, #4f46e5, #8b5cf6, #06b6d4);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .card.dragging { transition: none; }
  .card.dragging .header { cursor: grabbing; }
  .title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-logo { width: 21px; height: 18px; object-fit: contain; flex: 0 0 auto; }
  .title { font-size: 13px; font-weight: 750; letter-spacing: .01em; color: #40506e; }
  .close {
    width: 28px; height: 28px; border: 0; border-radius: 7px;
    background: transparent; color: #59657a; cursor: pointer; font-size: 20px;
  }
  .close:hover { background: #eef1f7; }
  .body { margin-top: 11px; font-size: 14px; line-height: 1.72; white-space: pre-wrap; overflow-wrap: anywhere; }
  .loading { display: flex; align-items: center; gap: 9px; color: #526078; }
  .spinner {
    width: 16px; height: 16px; border: 2px solid #cdd5e5; border-top-color: #486fe8;
    border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { color: #a52b36; }
  .warning { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #fff6dd; color: #725417; font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
  .action {
    border: 1px solid #d6dceb; border-radius: 9px; padding: 7px 12px;
    background: #f8f9fc; color: #25324a; cursor: pointer; font-size: 13px;
    transition: background .15s ease, border-color .15s ease, transform .15s ease;
  }
  .action:hover { background: #eef2fa; border-color: #b9c4dc; transform: translateY(-1px); }
  .primary { border-color: #4f46e5; background: linear-gradient(135deg, #4f46e5, #6d5ce8); color: #fff; }
  .primary:hover { background: linear-gradient(135deg, #4338ca, #5b4bd6); border-color: #4338ca; }
  :host([data-pi-theme="dark"]) .trigger {
    border-color: rgba(148, 163, 184, .34);
    background: rgba(15, 23, 42, .96);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .38), 0 1px 4px rgba(0, 0, 0, .32);
  }
  :host([data-pi-theme="dark"]) .trigger-logo,
  :host([data-pi-theme="dark"]) .card-logo {
    filter: brightness(0) invert(1) drop-shadow(0 1px 1px rgba(255,255,255,.12));
  }
  :host([data-pi-theme="dark"]) .card {
    color: #edf1f8;
    background: rgba(17, 24, 39, .985);
    border-color: #39445a;
    box-shadow: 0 22px 64px rgba(0, 0, 0, .48), 0 3px 12px rgba(0, 0, 0, .28);
  }
  :host([data-pi-theme="dark"]) .title { color: #cbd5e1; }
  :host([data-pi-theme="dark"]) .loading { color: #b6c2d4; }
  :host([data-pi-theme="dark"]) .close { color: #c4ccda; }
  :host([data-pi-theme="dark"]) .close:hover,
  :host([data-pi-theme="dark"]) .action:hover { background: #2b3546; }
  :host([data-pi-theme="dark"]) .action {
    color: #e8edf6;
    background: #202938;
    border-color: #465269;
  }
  :host([data-pi-theme="dark"]) .primary { background: #5b6ee1; border-color: #6979e7; }
  :host([data-pi-theme="dark"]) .warning { background: #463b20; color: #f1d68e; }
  :host([data-pi-theme="dark"]) .error { color: #ff9aa4; }
`;

interface ErrorDisplay {
  message: string;
  showSettings: boolean;
}

interface OverlayActions {
  onTranslate: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

type OverlayView = 'hidden' | 'trigger' | 'card';

interface CardPosition {
  left: number;
  top: number;
}

export class TranslationOverlay {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly logoUrl = browser.runtime.getURL('/brand/pi_logo.png');
  private themeObserver?: MutationObserver;
  private colorSchemeQuery?: MediaQueryList;
  private themeRefreshTimer?: ReturnType<typeof setTimeout>;
  private lastRect?: ViewportRect;
  private view: OverlayView = 'hidden';
  private cardPosition: CardPosition | undefined;

  constructor(private readonly actions: OverlayActions) {
    this.host = document.createElement('div');
    this.host.id = 'tex-selection-translator-root';
    this.setView('hidden');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.root.append(style);
    document.documentElement.append(this.host);
    this.startThemeTracking();
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  showTrigger(rect: ViewportRect): void {
    this.lastRect = rect;
    this.cardPosition = undefined;
    this.clearContent();
    const button = this.button('', 'trigger', '翻译选中的文本');
    const logo = this.logo('trigger-logo');
    const sparkle = document.createElement('span');
    sparkle.className = 'trigger-sparkle';
    sparkle.textContent = '✦';
    sparkle.setAttribute('aria-hidden', 'true');
    button.append(logo, sparkle);
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', this.actions.onTranslate);
    this.place(button, rect, 36, 36);
    this.root.append(button);
    this.setView('trigger');
  }

  showLoading(rect?: ViewportRect): void {
    if (rect) this.lastRect = rect;
    const card = this.createCard('正在翻译…');
    const body = document.createElement('div');
    body.className = 'body loading';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    const text = document.createElement('span');
    text.textContent = '正在调用 DeepSeek';
    body.append(spinner, text);
    card.append(body);
    this.showCard(card);
  }

  showResult(result: TranslateResult, rect?: ViewportRect): void {
    if (rect) this.lastRect = rect;
    const card = this.createCard('翻译结果');
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = result.translatedText;
    card.append(body);

    if (result.warnings.length > 0) {
      const warning = document.createElement('div');
      warning.className = 'warning';
      warning.textContent = '部分 LaTeX 使用了保守保护策略，请复制后检查。';
      card.append(warning);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const copy = this.button('复制', 'action primary');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(result.translatedText);
      copy.textContent = '已复制';
    });
    const copyBoth = this.button('复制原文和译文', 'action');
    copyBoth.addEventListener('click', async () => {
      await navigator.clipboard.writeText(
        `原文：\n${result.originalText}\n\n译文：\n${result.translatedText}`,
      );
      copyBoth.textContent = '已复制';
    });
    const retry = this.button('重新翻译', 'action');
    retry.addEventListener('click', this.actions.onRetry);
    actions.append(copy, copyBoth, retry);
    card.append(actions);
    this.showCard(card);
  }

  showError(error: ErrorDisplay, rect?: ViewportRect): void {
    if (rect) this.lastRect = rect;
    const card = this.createCard('翻译失败');
    const body = document.createElement('div');
    body.className = 'body error';
    body.textContent = error.message;
    card.append(body);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const retry = this.button('重试', 'action primary');
    retry.addEventListener('click', this.actions.onRetry);
    actions.append(retry);
    if (error.showSettings) {
      const settings = this.button('打开设置', 'action');
      settings.addEventListener('click', this.actions.onOpenSettings);
      actions.append(settings);
    }
    card.append(actions);
    this.showCard(card);
  }

  hide(): void {
    this.clearContent();
    this.setView('hidden');
  }

  hideTrigger(): void {
    if (this.view !== 'trigger') return;
    this.clearContent();
    this.setView('hidden');
  }

  isShowingCard(): boolean {
    return this.view === 'card';
  }

  resetCardPosition(): void {
    this.cardPosition = undefined;
  }

  keepCardInViewport(): void {
    const card = this.root.querySelector<HTMLElement>('.card');
    if (!card || !this.cardPosition) return;
    const next = this.constrainCardPosition(
      this.cardPosition.left,
      this.cardPosition.top,
      card.offsetWidth,
      card.offsetHeight,
    );
    this.cardPosition = next;
    card.style.left = `${next.left}px`;
    card.style.top = `${next.top}px`;
  }

  destroy(): void {
    if (this.themeRefreshTimer) clearTimeout(this.themeRefreshTimer);
    this.themeObserver?.disconnect();
    this.colorSchemeQuery?.removeEventListener('change', this.onColorSchemeChange);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.setView('hidden');
    this.host.remove();
  }

  private createCard(titleText: string): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'title-wrap';
    const logo = this.logo('card-logo');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = titleText;
    const close = this.button('×', 'close', '关闭');
    close.addEventListener('click', () => this.dismiss());
    titleWrap.append(logo, title);
    header.append(titleWrap, close);
    card.append(header);
    this.makeDraggable(card, header);
    return card;
  }

  private showCard(card: HTMLDivElement): void {
    this.clearContent();
    const rect = this.lastRect ?? {
      top: window.innerHeight / 2,
      bottom: window.innerHeight / 2,
      left: window.innerWidth / 2,
      right: window.innerWidth / 2,
    };
    this.root.append(card);
    if (this.cardPosition) {
      const next = this.constrainCardPosition(
        this.cardPosition.left,
        this.cardPosition.top,
        card.offsetWidth,
        card.offsetHeight,
      );
      this.cardPosition = next;
      card.style.left = `${next.left}px`;
      card.style.top = `${next.top}px`;
    } else {
      this.place(card, rect, Math.min(420, window.innerWidth - 24), 180);
    }
    this.setView('card');
  }

  private makeDraggable(card: HTMLDivElement, handle: HTMLDivElement): void {
    let pointerId: number | undefined;
    let offsetX = 0;
    let offsetY = 0;

    const stopDragging = (): void => {
      if (pointerId === undefined) return;
      pointerId = undefined;
      card.classList.remove('dragging');
      const rect = card.getBoundingClientRect();
      this.cardPosition = { left: rect.left, top: rect.top };
    };

    handle.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest('button')
      ) {
        return;
      }
      const rect = card.getBoundingClientRect();
      pointerId = event.pointerId;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      card.classList.add('dragging');
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const next = this.constrainCardPosition(
        event.clientX - offsetX,
        event.clientY - offsetY,
        card.offsetWidth,
        card.offsetHeight,
      );
      card.style.left = `${next.left}px`;
      card.style.top = `${next.top}px`;
      this.cardPosition = next;
    });
    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);
    handle.addEventListener('lostpointercapture', stopDragging);
  }

  private constrainCardPosition(
    left: number,
    top: number,
    width: number,
    height: number,
  ): CardPosition {
    const margin = 12;
    return {
      left: Math.min(
        Math.max(margin, left),
        Math.max(margin, window.innerWidth - width - margin),
      ),
      top: Math.min(
        Math.max(margin, top),
        Math.max(margin, window.innerHeight - height - margin),
      ),
    };
  }

  private place(
    element: HTMLElement,
    rect: ViewportRect,
    expectedWidth: number,
    expectedHeight: number,
  ): void {
    const margin = 12;
    const gap = 8;
    const left = Math.min(
      Math.max(margin, rect.right - expectedWidth),
      window.innerWidth - expectedWidth - margin,
    );
    const preferredTop = rect.bottom + gap;
    const top =
      preferredTop + expectedHeight <= window.innerHeight - margin
        ? preferredTop
        : Math.max(margin, rect.top - expectedHeight - gap);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  private button(text: string, className: string, title?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    if (title) {
      button.title = title;
      button.setAttribute('aria-label', title);
    }
    return button;
  }

  private logo(className: string): HTMLImageElement {
    const image = document.createElement('img');
    image.className = className;
    image.src = this.logoUrl;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  private readonly onColorSchemeChange = (): void => {
    this.scheduleThemeRefresh();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.view === 'hidden') return;
    this.dismiss();
  };

  private dismiss(): void {
    this.hide();
    this.actions.onDismiss();
  }

  private setView(view: OverlayView): void {
    this.view = view;
    this.host.dataset.piView = view;
  }

  private startThemeTracking(): void {
    this.refreshTheme();
    this.themeObserver = new MutationObserver(() => this.scheduleThemeRefresh());
    const options: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-bs-theme'],
    };
    this.themeObserver.observe(document.documentElement, options);
    if (document.body) this.themeObserver.observe(document.body, options);
    this.colorSchemeQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    this.colorSchemeQuery?.addEventListener('change', this.onColorSchemeChange);
  }

  private scheduleThemeRefresh(): void {
    if (this.themeRefreshTimer) clearTimeout(this.themeRefreshTimer);
    this.themeRefreshTimer = setTimeout(() => this.refreshTheme(), 40);
  }

  private refreshTheme(): void {
    this.host.dataset.piTheme = detectPageTheme();
  }

  private clearContent(): void {
    for (const child of [...this.root.children]) {
      if (!(child instanceof HTMLStyleElement)) child.remove();
    }
  }
}
