import type {
  RuntimeMessage,
  TranslateRuntimeResponse,
} from '../messaging/messages';
import { translationErrorMessage } from '../messaging/user-facing-error';
import { isLikelyTargetLanguage } from '../language/target-language';
import type { SupportedTargetLanguage } from '../language/supported-target-languages';
import { isLikelySourceCode } from '../selection/passive-selection-intent';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import {
  EMPTY_BILINGUAL_PAGE_STATE,
  isBilingualPageTextCandidate,
  isIsolatedBilingualBlockError,
  normalizeBilingualPageText,
  type BilingualPageAction,
  type BilingualPageState,
} from '../translation/bilingual-page';

const TRANSLATION_ATTRIBUTE = 'data-pi-bilingual-translation';
const ERROR_ATTRIBUTE = 'data-pi-bilingual-error';
const CONTROL_HOST_ID = 'pi-translator-bilingual-page-control';
const STYLE_ID = 'pi-translator-bilingual-page-style';
const BLOCK_SELECTOR = 'h1, h2, h3, h4, p, blockquote, figcaption, li';
const RENDERED_MATH_SELECTOR = [
  '.katex',
  'mjx-container',
  'math',
  '[data-tex]',
  '[data-latex]',
  'script[type^="math/tex"]',
].join(',');
const EXCLUDED_ANCESTOR_SELECTOR = [
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'table',
  'dialog',
  'pre',
  'code',
  'kbd',
  'samp',
  'script',
  'style',
  'noscript',
  'template',
  'canvas',
  'svg',
  'math',
  '[hidden]',
  '[aria-hidden="true"]',
  '[contenteditable="true"]',
  '[role="navigation"]',
  '[role="menu"]',
  '[role="toolbar"]',
  '[role="dialog"]',
  '.katex-display',
  '.MathJax_Display',
  `[${TRANSLATION_ATTRIBUTE}]`,
  `[${ERROR_ATTRIBUTE}]`,
  `#${CONTROL_HOST_ID}`,
].join(',');

type BlockStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

interface BilingualBlock {
  element: HTMLElement;
  text: string;
  status: BlockStatus;
  translation?: HTMLElement;
  errorElement?: HTMLElement;
}

export interface BilingualPageRequestConfig {
  sourceLanguage: 'auto' | string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
}

interface BilingualPageTranslatorOptions {
  pageUrl(): string;
  requestConfig(): BilingualPageRequestConfig;
  onStateChange(state: BilingualPageState): void;
}

export interface BilingualPageTranslator {
  start(targetLanguage: SupportedTargetLanguage): Promise<BilingualPageState>;
  control(action: BilingualPageAction): Promise<BilingualPageState>;
  state(): BilingualPageState;
  dispose(): void;
}

function elementVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function readableElementText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('code, kbd, samp').forEach((node) => {
    const code = normalizeBilingualPageText(node.textContent ?? '');
    node.replaceWith(document.createTextNode(code ? ` \`${code}\` ` : ''));
  });
  const mathNodes = [...clone.querySelectorAll(RENDERED_MATH_SELECTOR)].filter(
    (node) => !node.parentElement?.closest(RENDERED_MATH_SELECTOR),
  );
  for (const node of mathNodes) {
    const annotation = node.querySelector('annotation[encoding*="tex" i]');
    const candidate = node.getAttribute('data-tex') ??
      node.getAttribute('data-latex') ??
      node.getAttribute('alttext') ??
      (node.matches('script[type^="math/tex"]') ? node.textContent : undefined) ??
      annotation?.textContent;
    const tex = candidate?.trim();
    if (!tex) continue;
    const delimited = /^(?:\$|\\\(|\\\[)/u.test(tex) ? tex : `$${tex}$`;
    node.replaceWith(document.createTextNode(` ${delimited} `));
  }
  clone.querySelectorAll([
    'script',
    'style',
    'noscript',
    'template',
    'button',
    'input',
    'select',
    'textarea',
    `[${TRANSLATION_ATTRIBUTE}]`,
    `[${ERROR_ATTRIBUTE}]`,
  ].join(',')).forEach((node) => node.remove());
  return normalizeBilingualPageText(clone.textContent ?? '');
}

function linkTextLength(element: HTMLElement): number {
  return [...element.querySelectorAll<HTMLAnchorElement>('a')]
    .reduce((total, link) => total + normalizeBilingualPageText(link.textContent ?? '').length, 0);
}

function candidateElements(root: ParentNode, targetLanguage: string): BilingualBlock[] {
  const candidates: BilingualBlock[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (
      element.closest(EXCLUDED_ANCESTOR_SELECTOR) ||
      !elementVisible(element) ||
      Boolean(element.querySelector('button, input, select, textarea, pre, .katex-display, .MathJax_Display, math[display="block"], mjx-container[display="true"]')) ||
      (element.tagName === 'LI' && Boolean(element.querySelector('p, blockquote'))) ||
      (element.tagName === 'BLOCKQUOTE' && Boolean(element.querySelector('p, blockquote')))
    ) continue;
    const text = readableElementText(element);
    if (
      !isBilingualPageTextCandidate(text, element.tagName, linkTextLength(element)) ||
      isLikelySourceCode(text) ||
      isLikelyTargetLanguage(text, targetLanguage)
    ) continue;
    candidates.push({ element, text, status: 'idle' });
    if (candidates.length >= 240) break;
  }
  return candidates;
}

function articleRoot(targetLanguage: string): { root: ParentNode; blocks: BilingualBlock[] } {
  const containers = [...document.querySelectorAll<HTMLElement>('article, main, [role="main"]')]
    .filter((element) => !element.closest(EXCLUDED_ANCESTOR_SELECTOR) && elementVisible(element));
  let best: { root: ParentNode; blocks: BilingualBlock[]; score: number } | undefined;
  for (const root of containers) {
    const blocks = candidateElements(root, targetLanguage);
    const score = blocks.reduce((total, block) => total + Math.min(block.text.length, 800), 0);
    if (!best || score > best.score) best = { root, blocks, score };
  }
  if (best && (best.blocks.length >= 2 || best.score >= 240)) return best;
  const root = document.body;
  return { root, blocks: root ? candidateElements(root, targetLanguage) : [] };
}

function targetLanguageHtmlCode(targetLanguage: string): string {
  return targetLanguage === 'zh-CN' ? 'zh-CN' : targetLanguage;
}

function translationElement(block: BilingualBlock, translatedText: string, targetLanguage: string): HTMLElement {
  const translation = document.createElement('pi-translator-bilingual');
  translation.setAttribute(TRANSLATION_ATTRIBUTE, '');
  translation.setAttribute('lang', targetLanguageHtmlCode(targetLanguage));
  translation.setAttribute('aria-label', 'Pi Translator 双语译文');
  translation.textContent = translatedText.trim();
  applySourceTypography(translation, block, 18);
  return translation;
}

function applySourceTypography(
  target: HTMLElement,
  block: BilingualBlock,
  maximumFontSize: number,
): void {
  const sourceStyle = getComputedStyle(block.element);
  const sourceFontSize = Number.parseFloat(sourceStyle.fontSize);
  target.style.setProperty('--pi-bilingual-color', sourceStyle.color);
  target.style.setProperty('--pi-bilingual-font', sourceStyle.fontFamily);
  target.style.setProperty(
    '--pi-bilingual-size',
    Number.isFinite(sourceFontSize)
      ? `${Math.min(maximumFontSize, sourceFontSize)}px`
      : sourceStyle.fontSize,
  );
}

function insertAfterSource(block: BilingualBlock, element: HTMLElement): void {
  if (block.element.tagName === 'LI') block.element.append(element);
  else block.element.insertAdjacentElement('afterend', element);
}

function insertTranslation(block: BilingualBlock, translation: HTMLElement): void {
  insertAfterSource(block, translation);
  block.translation = translation;
}

function blockErrorElement(
  block: BilingualBlock,
  message: string,
  retry: () => void,
): HTMLElement {
  const error = document.createElement('pi-translator-bilingual-error');
  error.setAttribute(ERROR_ATTRIBUTE, '');
  error.setAttribute('role', 'status');
  error.setAttribute('aria-label', 'Pi Translator 本段翻译失败');
  const copy = document.createElement('span');
  copy.textContent = `本段未译：${message.split('\n')[0] ?? message}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '重试本段';
  button.addEventListener('click', retry);
  error.append(copy, button);
  applySourceTypography(error, block, 14);
  return error;
}

function installTranslationStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${TRANSLATION_ATTRIBUTE}] {
      all: initial !important;
      display: block !important;
      box-sizing: border-box !important;
      width: auto !important;
      margin: .32em 0 .9em !important;
      border-left: 2px solid color-mix(in srgb, var(--pi-bilingual-color) 28%, #6558d9 72%) !important;
      padding: .08em 0 .08em .72em !important;
      color: var(--pi-bilingual-color) !important;
      background: transparent !important;
      font-family: var(--pi-bilingual-font) !important;
      font-size: var(--pi-bilingual-size) !important;
      font-style: normal !important;
      font-weight: 400 !important;
      line-height: 1.65 !important;
      letter-spacing: normal !important;
      opacity: .82 !important;
      text-align: left !important;
      text-decoration: none !important;
      text-transform: none !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    li > [${TRANSLATION_ATTRIBUTE}] { margin-bottom: .35em !important; }
    [${ERROR_ATTRIBUTE}] {
      all: initial !important;
      display: flex !important;
      box-sizing: border-box !important;
      width: auto !important;
      margin: .28em 0 .72em !important;
      align-items: center !important;
      gap: .65em !important;
      border-left: 2px solid color-mix(in srgb, var(--pi-bilingual-color) 20%, #d97706 80%) !important;
      padding: .18em 0 .18em .72em !important;
      color: color-mix(in srgb, var(--pi-bilingual-color) 78%, #92400e 22%) !important;
      background: transparent !important;
      font-family: var(--pi-bilingual-font) !important;
      font-size: var(--pi-bilingual-size) !important;
      font-style: normal !important;
      font-weight: 400 !important;
      line-height: 1.45 !important;
    }
    [${ERROR_ATTRIBUTE}] > span {
      all: initial !important;
      min-width: 0 !important;
      flex: 1 1 auto !important;
      color: inherit !important;
      font: inherit !important;
      overflow-wrap: anywhere !important;
    }
    [${ERROR_ATTRIBUTE}] > button {
      all: initial !important;
      flex: 0 0 auto !important;
      min-height: 28px !important;
      box-sizing: border-box !important;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent) !important;
      border-radius: 6px !important;
      padding: 4px 8px !important;
      color: inherit !important;
      background: color-mix(in srgb, currentColor 7%, transparent) !important;
      font: 600 11px/1.2 var(--pi-bilingual-font) !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }
    [${ERROR_ATTRIBUTE}] > button:hover { background: color-mix(in srgb, currentColor 12%, transparent) !important; }
    [${ERROR_ATTRIBUTE}] > button:focus-visible { outline: 2px solid #6366f1 !important; outline-offset: 2px !important; }
    li > [${ERROR_ATTRIBUTE}] { margin-bottom: .35em !important; }
  `;
  (document.head ?? document.documentElement).append(style);
}

function removeTranslationStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function pageIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return value.split('#')[0] ?? value;
  }
}

export function createBilingualPageTranslator(
  options: BilingualPageTranslatorOptions,
): BilingualPageTranslator {
  let currentState: BilingualPageState = { ...EMPTY_BILINGUAL_PAGE_STATE };
  let blocks: BilingualBlock[] = [];
  let queue: BilingualBlock[] = [];
  let observer: IntersectionObserver | undefined;
  let activeRequestId: string | undefined;
  let activeTask: Promise<void> | undefined;
  let taskRevision = 0;
  let sourcePageIdentity = '';
  let navigationTimer: number | undefined;
  let disposed = false;
  let controlHost: HTMLElement | undefined;
  let consecutiveIsolatedFailures = 0;

  const snapshot = (): BilingualPageState => ({ ...currentState });

  const publish = (): void => {
    if (disposed) return;
    renderControl();
    options.onStateChange(snapshot());
  };

  const setState = (next: Partial<BilingualPageState>): void => {
    currentState = { ...currentState, ...next };
    publish();
  };

  const translatedCount = (): number => blocks.filter((block) => block.status === 'done').length;
  const failedCount = (): number => blocks.filter((block) => block.status === 'error').length;

  const syncCounts = (): void => {
    currentState = {
      ...currentState,
      total: blocks.length,
      translated: translatedCount(),
      failed: failedCount(),
    };
  };

  const cancelActiveRequest = (): void => {
    if (!activeRequestId) return;
    const requestId = activeRequestId;
    activeRequestId = undefined;
    void browser.runtime.sendMessage({
      type: 'CANCEL_TRANSLATION',
      payload: { requestId },
    } satisfies RuntimeMessage).catch(() => undefined);
  };

  const removeInjectedContent = (): void => {
    for (const block of blocks) {
      block.translation?.remove();
      block.errorElement?.remove();
    }
    document.querySelectorAll(
      `[${TRANSLATION_ATTRIBUTE}], [${ERROR_ATTRIBUTE}]`,
    ).forEach((element) => element.remove());
    blocks = [];
    queue = [];
    observer?.disconnect();
    observer = undefined;
    removeTranslationStyle();
  };

  const destroyControl = (): void => {
    controlHost?.remove();
    controlHost = undefined;
  };

  const clear = (notify = true): void => {
    taskRevision += 1;
    cancelActiveRequest();
    removeInjectedContent();
    if (navigationTimer !== undefined) window.clearInterval(navigationTimer);
    navigationTimer = undefined;
    sourcePageIdentity = '';
    consecutiveIsolatedFailures = 0;
    currentState = { ...EMPTY_BILINGUAL_PAGE_STATE };
    destroyControl();
    if (notify) options.onStateChange(snapshot());
  };

  const eligibleForViewport = (block: BilingualBlock): boolean => {
    const bounds = block.element.getBoundingClientRect();
    return bounds.bottom >= -window.innerHeight * .35 && bounds.top <= window.innerHeight * 2.2;
  };

  const enqueue = (block: BilingualBlock, position: 'front' | 'end' = 'end'): void => {
    if (block.status !== 'idle') return;
    block.status = 'queued';
    if (position === 'front') queue.unshift(block);
    else queue.push(block);
  };

  const renderControl = (): void => {
    if (currentState.phase === 'idle') {
      destroyControl();
      return;
    }
    if (!controlHost?.isConnected) {
      controlHost = document.createElement('div');
      controlHost.id = CONTROL_HOST_ID;
      controlHost.style.cssText = 'all:initial;position:fixed;z-index:2147483645;right:16px;bottom:16px;';
      const shadow = controlHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { color-scheme: light dark; }
          .bar { display:flex;align-items:center;gap:8px;max-width:min(420px,calc(100vw - 32px));min-height:38px;box-sizing:border-box;border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:6px 7px 6px 10px;color:#253047;background:rgba(255,255,255,.96);box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px/1.3 Inter,"Segoe UI","Microsoft YaHei",sans-serif;backdrop-filter:blur(12px);}
          .mark { color:#5548d9;font-weight:800;font-size:15px; }
          output { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
          button { min-width:32px;min-height:28px;border:0;border-radius:6px;padding:4px 7px;color:#4f46e5;background:#f0efff;cursor:pointer;font:600 11px/1.2 inherit;white-space:nowrap; }
          button:hover { background:#e4e2ff; }
          button[data-action="clear"] { color:#657084;background:transparent; }
          @media (prefers-color-scheme: dark) { .bar{color:#edf1f7;border-color:#4b4d7d;background:rgba(24,32,47,.96);box-shadow:0 8px 28px rgba(0,0,0,.36)} button{color:#cbc7ff;background:#292943} button:hover{background:#363653} button[data-action="clear"]{color:#aab3c2;background:transparent} }
          @media (max-width:480px) { .bar{gap:5px;padding-left:8px} .mark{display:none} button{padding-inline:6px} }
        </style>
        <div class="bar" role="status" aria-live="polite">
          <span class="mark" aria-hidden="true">π</span>
          <output></output>
          <button type="button" data-action="pause"></button>
          <button type="button" data-action="stop">停止</button>
          <button type="button" data-action="clear">清除</button>
        </div>`;
      shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'pause') {
            const shouldResume = currentState.phase === 'paused' ||
              currentState.phase === 'error' ||
              currentState.phase === 'stopped' ||
              (currentState.phase === 'complete' && currentState.failed > 0);
            void control(shouldResume ? 'resume' : 'pause');
          } else if (action === 'stop' || action === 'clear') {
            void control(action);
          }
        });
      });
      document.documentElement.append(controlHost);
    }
    const shadow = controlHost.shadowRoot;
    const output = shadow?.querySelector<HTMLOutputElement>('output');
    const pause = shadow?.querySelector<HTMLButtonElement>('[data-action="pause"]');
    const stop = shadow?.querySelector<HTMLButtonElement>('[data-action="stop"]');
    if (output) {
      output.textContent = currentState.phase === 'error'
        ? currentState.message ?? '正文翻译暂时中断'
        : currentState.phase === 'complete'
          ? currentState.failed
            ? `双语正文 ${currentState.translated}/${currentState.total} · ${currentState.failed} 段待重试`
            : `双语正文已完成 ${currentState.translated}/${currentState.total}`
          : currentState.phase === 'paused'
            ? `双语正文已暂停 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''}`
            : currentState.phase === 'stopped'
              ? `双语正文已停止 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''}`
              : `双语正文 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''} · 滚动继续`;
    }
    if (pause) {
      const retryCompleted = currentState.phase === 'complete' && currentState.failed > 0;
      pause.textContent = retryCompleted
        ? `重试 ${currentState.failed} 段`
        : currentState.phase === 'paused' || currentState.phase === 'error' || currentState.phase === 'stopped'
          ? '继续'
          : '暂停';
      pause.hidden = (currentState.phase === 'complete' && !currentState.failed) || currentState.total === 0;
    }
    if (stop) stop.hidden = currentState.phase === 'complete' || currentState.phase === 'stopped';
  };

  const observeBlocks = (): void => {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const block = blocks.find((candidate) => candidate.element === entry.target);
        if (block) enqueue(block);
      }
      void processQueue();
    }, { rootMargin: '100% 0px 140% 0px' });
    blocks.forEach((block) => observer?.observe(block.element));
  };

  const removeBlockError = (block: BilingualBlock): void => {
    block.errorElement?.remove();
    delete block.errorElement;
  };

  const settleCompletedState = (): boolean => {
    syncCounts();
    if (currentState.translated + currentState.failed < currentState.total) return false;
    delete currentState.message;
    setState({ phase: 'complete' });
    return true;
  };

  const retryBlock = (block: BilingualBlock): void => {
    if (block.status !== 'error' || !block.element.isConnected) return;
    removeBlockError(block);
    queue = queue.filter((candidate) => candidate !== block);
    block.status = 'idle';
    enqueue(block, 'front');
    for (const candidate of blocks) {
      if (candidate.status === 'idle' && eligibleForViewport(candidate)) enqueue(candidate);
    }
    syncCounts();
    consecutiveIsolatedFailures = 0;
    delete currentState.message;
    setState({ phase: 'running' });
    void processQueue();
  };

  const markIsolatedFailure = (block: BilingualBlock, message: string): void => {
    block.status = 'error';
    removeBlockError(block);
    const error = blockErrorElement(block, message, () => retryBlock(block));
    insertAfterSource(block, error);
    block.errorElement = error;
    consecutiveIsolatedFailures += 1;
    if (settleCompletedState()) return;
    if (consecutiveIsolatedFailures >= 3) {
      setState({
        phase: 'error',
        message: '连续多个段落翻译失败，已暂停后续请求；可稍后重试失败段。',
      });
      return;
    }
    publish();
  };

  const translateBlock = async (block: BilingualBlock, revision: number): Promise<void> => {
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    block.status = 'translating';
    const config = options.requestConfig();
    try {
      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE_BILINGUAL_PAGE_SEGMENT',
        payload: {
          requestId,
          text: block.text,
          pageUrl: options.pageUrl(),
          targetLanguage: currentState.targetLanguage!,
          sourceLanguage: config.sourceLanguage,
          style: config.style,
          contentMode: config.contentMode,
        },
      } satisfies RuntimeMessage) as TranslateRuntimeResponse;
      if (disposed || revision !== taskRevision || activeRequestId !== requestId) return;
      activeRequestId = undefined;
      if (!response.ok) {
        const message = translationErrorMessage(response.error.code, response.error.message);
        if (isIsolatedBilingualBlockError(response.error.code)) {
          markIsolatedFailure(block, message);
          return;
        }
        block.status = 'error';
        syncCounts();
        setState({
          phase: 'error',
          message,
        });
        return;
      }
      if (!block.element.isConnected) {
        block.status = 'error';
        syncCounts();
        setState({ phase: 'error', message: '网页正文已经变化，请清除后重新开始。' });
        return;
      }
      const translation = translationElement(
        block,
        response.data.result.translatedText,
        currentState.targetLanguage!,
      );
      insertTranslation(block, translation);
      block.status = 'done';
      consecutiveIsolatedFailures = 0;
      if (!settleCompletedState()) publish();
    } catch (error) {
      if (disposed || revision !== taskRevision || activeRequestId !== requestId) return;
      activeRequestId = undefined;
      block.status = 'error';
      syncCounts();
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : '无法继续翻译网页正文。',
      });
    }
  };

  const processQueue = async (): Promise<void> => {
    if (activeTask || currentState.phase !== 'running') return;
    const revision = taskRevision;
    activeTask = (async () => {
      while (currentState.phase === 'running' && revision === taskRevision) {
        const block = queue.shift();
        if (!block) break;
        if (block.status !== 'queued') continue;
        await translateBlock(block, revision);
        if (currentState.phase !== 'running') break;
      }
    })().finally(() => {
      activeTask = undefined;
      if (currentState.phase === 'running' && queue.length) void processQueue();
    });
    await activeTask;
  };

  const resume = (): void => {
    consecutiveIsolatedFailures = 0;
    const failedBlocks = blocks.filter((block) => block.status === 'error');
    queue = queue.filter((block) => block.status === 'queued');
    for (const block of [...failedBlocks].reverse()) {
      removeBlockError(block);
      block.status = 'idle';
      enqueue(block, 'front');
    }
    for (const block of blocks) {
      if (block.status === 'idle' && eligibleForViewport(block)) enqueue(block);
    }
    syncCounts();
    delete currentState.message;
    setState({ phase: 'running' });
    void processQueue();
  };

  const start = async (targetLanguage: SupportedTargetLanguage): Promise<BilingualPageState> => {
    if (disposed) return snapshot();
    if (currentState.phase !== 'idle') {
      const shouldRedetect = currentState.targetLanguage === targetLanguage &&
        currentState.phase === 'error' && currentState.total === 0;
      if (currentState.targetLanguage === targetLanguage && !shouldRedetect) {
        if (
          ['paused', 'stopped', 'error'].includes(currentState.phase) ||
          (currentState.phase === 'complete' && currentState.failed > 0)
        ) resume();
        return snapshot();
      }
      clear(false);
    }
    const selection = articleRoot(targetLanguage);
    blocks = selection.blocks;
    sourcePageIdentity = pageIdentity(options.pageUrl());
    currentState = {
      phase: blocks.length ? 'running' : 'error',
      total: blocks.length,
      translated: 0,
      failed: 0,
      targetLanguage,
      ...(!blocks.length ? { message: '当前页面没有识别到适合双语阅读的正文。' } : {}),
    };
    publish();
    if (!blocks.length) return snapshot();
    installTranslationStyle();
    taskRevision += 1;
    observeBlocks();
    blocks.filter(eligibleForViewport).forEach((block) => enqueue(block));
    if (!queue.length && blocks[0]) enqueue(blocks[0]);
    navigationTimer = window.setInterval(() => {
      if (pageIdentity(options.pageUrl()) !== sourcePageIdentity) clear();
    }, 750);
    void processQueue();
    return snapshot();
  };

  const control = async (action: BilingualPageAction): Promise<BilingualPageState> => {
    if (action === 'clear') {
      clear();
      return snapshot();
    }
    if (
      currentState.phase === 'idle' ||
      (currentState.phase === 'complete' && currentState.failed === 0)
    ) return snapshot();
    if (action === 'pause' && currentState.phase === 'running') {
      setState({ phase: 'paused' });
    } else if (
      action === 'resume' && (
        ['paused', 'stopped', 'error'].includes(currentState.phase) ||
        (currentState.phase === 'complete' && currentState.failed > 0)
      )
    ) {
      resume();
    } else if (action === 'stop') {
      taskRevision += 1;
      cancelActiveRequest();
      blocks.forEach((block) => {
        if (block.status === 'queued' || block.status === 'translating') block.status = 'idle';
      });
      queue = [];
      syncCounts();
      delete currentState.message;
      setState({ phase: 'stopped' });
    }
    return snapshot();
  };

  return {
    start,
    control,
    state: snapshot,
    dispose: () => {
      if (disposed) return;
      clear(false);
      disposed = true;
    },
  };
}
