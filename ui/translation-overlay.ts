import type { ViewportRect } from '../core/selection/types';
import type { TranslateResult } from '../core/translation/types';

const OVERLAY_STYLES = `
  :host {
    all: initial;
    color-scheme: light dark;
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .trigger {
    position: fixed;
    z-index: 2147483647;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, .28);
    border-radius: 9px;
    color: #fff;
    background: linear-gradient(135deg, #3269e8, #734bd1);
    box-shadow: 0 4px 16px rgba(20, 34, 70, .28);
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 15px;
    font-weight: 700;
  }
  .trigger:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .card {
    position: fixed;
    z-index: 2147483647;
    width: min(420px, calc(100vw - 24px));
    max-height: min(360px, calc(100vh - 24px));
    overflow: auto;
    border: 1px solid rgba(73, 89, 125, .22);
    border-radius: 13px;
    color: #172033;
    background: rgba(255, 255, 255, .98);
    box-shadow: 0 14px 42px rgba(19, 29, 57, .25);
    padding: 14px;
  }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .title { font-size: 13px; font-weight: 700; color: #40506e; }
  .close {
    width: 28px; height: 28px; border: 0; border-radius: 7px;
    background: transparent; color: #59657a; cursor: pointer; font-size: 20px;
  }
  .close:hover { background: #eef1f7; }
  .body { margin-top: 10px; font-size: 14px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .loading { display: flex; align-items: center; gap: 9px; color: #526078; }
  .spinner {
    width: 16px; height: 16px; border: 2px solid #cdd5e5; border-top-color: #486fe8;
    border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { color: #a52b36; }
  .warning { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #fff6dd; color: #725417; font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
  .action {
    border: 1px solid #cbd4e5; border-radius: 8px; padding: 6px 11px;
    background: #f8f9fc; color: #25324a; cursor: pointer; font-size: 13px;
  }
  .action:hover { background: #eef2fa; }
  .primary { border-color: #4169df; background: #4169df; color: #fff; }
  .primary:hover { background: #3459c9; }
  @media (prefers-color-scheme: dark) {
    .card { color: #edf1f8; background: rgba(29, 34, 45, .98); border-color: #485165; }
    .title { color: #bac5da; }
    .close { color: #c4ccda; }
    .close:hover, .action:hover { background: #333b4b; }
    .action { color: #e8edf6; background: #282f3d; border-color: #4d586e; }
    .primary { background: #557ce9; border-color: #557ce9; }
    .warning { background: #463b20; color: #f1d68e; }
    .error { color: #ff9aa4; }
  }
`;

interface ErrorDisplay {
  message: string;
  showSettings: boolean;
}

interface OverlayActions {
  onTranslate: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}

export class TranslationOverlay {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private lastRect?: ViewportRect;

  constructor(private readonly actions: OverlayActions) {
    this.host = document.createElement('div');
    this.host.id = 'tex-selection-translator-root';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.root.append(style);
    document.documentElement.append(this.host);
  }

  showTrigger(rect: ViewportRect): void {
    this.lastRect = rect;
    this.clearContent();
    const button = this.button('译', 'trigger', '翻译选中的文本');
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', this.actions.onTranslate);
    this.place(button, rect, 30, 30);
    this.root.append(button);
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
    const retry = this.button('重新翻译', 'action');
    retry.addEventListener('click', this.actions.onRetry);
    actions.append(copy, retry);
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
  }

  destroy(): void {
    this.host.remove();
  }

  private createCard(titleText: string): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = titleText;
    const close = this.button('×', 'close', '关闭');
    close.addEventListener('click', () => this.hide());
    header.append(title, close);
    card.append(header);
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
    this.place(card, rect, Math.min(420, window.innerWidth - 24), 180);
    this.root.append(card);
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

  private clearContent(): void {
    for (const child of [...this.root.children]) {
      if (!(child instanceof HTMLStyleElement)) child.remove();
    }
  }
}
