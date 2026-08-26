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
  bilingualPageViewportPriority,
  buildBilingualPageReferenceContext,
  EMPTY_BILINGUAL_PAGE_STATE,
  isBilingualPageTextCandidate,
  isIsolatedBilingualBlockError,
  normalizeBilingualPageText,
  type BilingualPageAction,
  type BilingualPageState,
} from '../translation/bilingual-page';

const TRANSLATION_ATTRIBUTE = 'data-pi-bilingual-translation';
const TRANSLATION_TEXT_ATTRIBUTE = 'data-pi-bilingual-text';
const TRANSLATION_ACTIONS_ATTRIBUTE = 'data-pi-bilingual-actions';
const TRANSLATION_FEEDBACK_ATTRIBUTE = 'data-pi-bilingual-feedback';
const TRANSLATION_HIDDEN_ATTRIBUTE = 'data-pi-bilingual-hidden';
const TRANSLATION_GLOBAL_HIDDEN_ATTRIBUTE = 'data-pi-bilingual-global-hidden';
const TRANSLATION_BUSY_ATTRIBUTE = 'data-pi-bilingual-busy';
const TRANSLATION_HINT_ATTRIBUTE = 'data-pi-bilingual-hint';
const TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE = 'data-pi-bilingual-touch-expanded';
const TRANSLATION_PENDING_ATTRIBUTE = 'data-pi-bilingual-pending';
const ACTIONS_HINT_STORAGE_KEY = 'bilingualParagraphActionsHintSeen';
const ACTIONS_HINT_DURATION_MS = 3_200;
const ACTIONS_HINT_MOUSE_MESSAGE = '悬停译文可复制、重译或隐藏';
const ACTIONS_HINT_TOUCH_MESSAGE = '点“更多”可复制、重译或隐藏';
const MAX_BILINGUAL_BLOCKS = 240;
const DYNAMIC_SCAN_DELAY_MS = 280;
const TRANSLATION_PENDING_DELAY_MS = 350;
const ARTICLE_CHANGED_MESSAGE = '页面正文已更新，请重新开始正文翻译。';
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
  `[${TRANSLATION_PENDING_ATTRIBUTE}]`,
  `[${ERROR_ATTRIBUTE}]`,
  `#${CONTROL_HOST_ID}`,
].join(',');

type BlockStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

interface BilingualBlock {
  element: HTMLElement;
  text: string;
  status: BlockStatus;
  translation?: HTMLElement;
  pendingElement?: HTMLElement;
  pendingTimer?: number;
  errorElement?: HTMLElement;
  urgentQueue?: boolean;
  bypassCacheNext?: boolean;
  restoreStateAfterRetranslation?: Pick<
    BilingualPageState,
    'phase' | 'message' | 'pauseReason'
  >;
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
  suspendForInteractiveTranslation(): string | undefined;
  resumeAfterInteractiveTranslation(token: string | undefined): void;
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
    `[${TRANSLATION_PENDING_ATTRIBUTE}]`,
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
    if (candidates.length >= MAX_BILINGUAL_BLOCKS) break;
  }
  return candidates;
}

function articleRoot(targetLanguage: string): { root: HTMLElement; blocks: BilingualBlock[] } {
  const containers = [...document.querySelectorAll<HTMLElement>('article, main, [role="main"]')]
    .filter((element) => !element.closest(EXCLUDED_ANCESTOR_SELECTOR) && elementVisible(element));
  let best: { root: HTMLElement; blocks: BilingualBlock[]; score: number } | undefined;
  for (const root of containers) {
    const blocks = candidateElements(root, targetLanguage);
    const score = blocks.reduce((total, block) => total + Math.min(block.text.length, 800), 0);
    if (!best || score > best.score) best = { root, blocks, score };
  }
  if (best && (best.blocks.length >= 2 || best.score >= 240)) return best;
  const root = document.body;
  return { root, blocks: root ? candidateElements(root, targetLanguage) : [] };
}

function blockSignature(block: Pick<BilingualBlock, 'element' | 'text'>): string {
  return `${block.element.tagName}\u0000${block.text}`;
}

function matchingBlockSignatureCount(
  previous: BilingualBlock[],
  next: BilingualBlock[],
): number {
  const remaining = new Map<string, number>();
  for (const block of previous) {
    const signature = blockSignature(block);
    remaining.set(signature, (remaining.get(signature) ?? 0) + 1);
  }
  let matched = 0;
  for (const block of next) {
    const signature = blockSignature(block);
    const count = remaining.get(signature) ?? 0;
    if (!count) continue;
    matched += 1;
    if (count === 1) remaining.delete(signature);
    else remaining.set(signature, count - 1);
  }
  return matched;
}

function leadingHeadingText(blocks: BilingualBlock[]): string | undefined {
  return blocks.find((block) => /^H[1-4]$/u.test(block.element.tagName))?.text;
}

function looksLikeArticleReplacement(
  previous: BilingualBlock[],
  next: BilingualBlock[],
): boolean {
  const baseline = Math.min(previous.length, next.length);
  if (baseline < 2) return false;
  const matched = matchingBlockSignatureCount(previous, next);
  const overlap = matched / baseline;
  if (baseline >= 3 && overlap < .34) return true;
  const previousHeading = leadingHeadingText(previous);
  const nextHeading = leadingHeadingText(next);
  return Boolean(previousHeading && nextHeading && previousHeading !== nextHeading && overlap < .6);
}

function targetLanguageHtmlCode(targetLanguage: string): string {
  return targetLanguage === 'zh-CN' ? 'zh-CN' : targetLanguage;
}

interface BilingualTranslationActions {
  copy(): void;
  retranslate(): void;
  toggleHidden(): void;
  toggleMore(): void;
}

function translationActionButton(
  action: 'copy' | 'retranslate' | 'visibility' | 'more',
  label: string,
  listener: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener('click', listener);
  return button;
}

function translationElement(
  block: BilingualBlock,
  translatedText: string,
  targetLanguage: string,
  actions: BilingualTranslationActions,
): HTMLElement {
  const translation = document.createElement('pi-translator-bilingual');
  translation.setAttribute(TRANSLATION_ATTRIBUTE, '');
  translation.setAttribute('lang', targetLanguageHtmlCode(targetLanguage));
  translation.setAttribute('aria-label', 'Pi Translator 双语译文');
  const text = document.createElement('span');
  text.setAttribute(TRANSLATION_TEXT_ATTRIBUTE, '');
  text.textContent = translatedText.trim();
  const toolbar = document.createElement('span');
  toolbar.setAttribute(TRANSLATION_ACTIONS_ATTRIBUTE, '');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '本段译文操作');
  const feedback = document.createElement('span');
  feedback.setAttribute(TRANSLATION_FEEDBACK_ATTRIBUTE, '');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  toolbar.append(
    feedback,
    translationActionButton('copy', '复制', actions.copy),
    translationActionButton('retranslate', '重译本段', actions.retranslate),
    translationActionButton('visibility', '隐藏', actions.toggleHidden),
    translationActionButton('more', '更多', actions.toggleMore),
  );
  toolbar.querySelector<HTMLButtonElement>('button[data-action="more"]')
    ?.setAttribute('aria-expanded', 'false');
  translation.append(text, toolbar);
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

function clearBlockPending(block: BilingualBlock, removeElement = true): void {
  if (block.pendingTimer !== undefined) window.clearTimeout(block.pendingTimer);
  delete block.pendingTimer;
  if (removeElement) block.pendingElement?.remove();
  delete block.pendingElement;
}

function replacePendingOrInsert(block: BilingualBlock, element: HTMLElement): void {
  if (block.pendingTimer !== undefined) window.clearTimeout(block.pendingTimer);
  delete block.pendingTimer;
  if (block.pendingElement?.isConnected) block.pendingElement.replaceWith(element);
  else insertAfterSource(block, element);
  delete block.pendingElement;
}

function insertTranslation(block: BilingualBlock, translation: HTMLElement): void {
  if (block.translation?.isConnected) {
    clearBlockPending(block);
    block.translation.replaceWith(translation);
  } else replacePendingOrInsert(block, translation);
  block.translation = translation;
}

function blockPendingElement(block: BilingualBlock): HTMLElement {
  const pending = document.createElement('pi-translator-bilingual-pending');
  pending.setAttribute(TRANSLATION_PENDING_ATTRIBUTE, '');
  pending.setAttribute('role', 'status');
  pending.setAttribute('aria-label', 'Pi Translator 正在翻译本段');
  pending.textContent = '正在翻译此段…';
  applySourceTypography(pending, block, 14);
  return pending;
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
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_GLOBAL_HIDDEN_ATTRIBUTE}] {
      display: none !important;
    }
    [${TRANSLATION_PENDING_ATTRIBUTE}] {
      all: initial !important;
      display: block !important;
      box-sizing: border-box !important;
      width: auto !important;
      margin: .26em 0 .68em !important;
      border-left: 2px solid color-mix(in srgb, var(--pi-bilingual-color) 16%, #6558d9 84%) !important;
      padding: .04em 0 .04em .72em !important;
      color: var(--pi-bilingual-color) !important;
      background: transparent !important;
      font-family: var(--pi-bilingual-font) !important;
      font-size: var(--pi-bilingual-size) !important;
      font-style: normal !important;
      font-weight: 400 !important;
      line-height: 1.45 !important;
      letter-spacing: normal !important;
      opacity: .56 !important;
      text-align: left !important;
      text-decoration: none !important;
      text-transform: none !important;
      white-space: nowrap !important;
    }
    [${TRANSLATION_TEXT_ATTRIBUTE}] {
      all: initial !important;
      display: block !important;
      color: inherit !important;
      font: inherit !important;
      line-height: inherit !important;
      letter-spacing: inherit !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] {
      all: initial !important;
      display: flex !important;
      box-sizing: border-box !important;
      max-height: 0 !important;
      margin-top: 0 !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: 4px !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(-2px) !important;
      transition: opacity 120ms ease, transform 120ms ease, margin 120ms ease !important;
      color: color-mix(in srgb, var(--pi-bilingual-color) 70%, #4f46e5 30%) !important;
      font: 500 11px/1.2 var(--pi-bilingual-font) !important;
    }
    [${TRANSLATION_ATTRIBUTE}]:hover > [${TRANSLATION_ACTIONS_ATTRIBUTE}],
    [${TRANSLATION_ATTRIBUTE}]:focus-within > [${TRANSLATION_ACTIONS_ATTRIBUTE}],
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HIDDEN_ATTRIBUTE}] > [${TRANSLATION_ACTIONS_ATTRIBUTE}],
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_BUSY_ATTRIBUTE}] > [${TRANSLATION_ACTIONS_ATTRIBUTE}],
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HINT_ATTRIBUTE}] > [${TRANSLATION_ACTIONS_ATTRIBUTE}] {
      max-height: 32px !important;
      margin-top: .28em !important;
      opacity: .9 !important;
      pointer-events: auto !important;
      transform: translateY(0) !important;
    }
    [${TRANSLATION_FEEDBACK_ATTRIBUTE}] {
      all: initial !important;
      min-width: 0 !important;
      margin-right: auto !important;
      color: inherit !important;
      font: inherit !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button {
      all: initial !important;
      min-height: 28px !important;
      box-sizing: border-box !important;
      border: 0 !important;
      border-radius: 6px !important;
      padding: 4px 7px !important;
      color: inherit !important;
      background: color-mix(in srgb, currentColor 7%, transparent) !important;
      font: 600 11px/1.2 var(--pi-bilingual-font) !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button:hover {
      background: color-mix(in srgb, currentColor 13%, transparent) !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button:focus-visible {
      outline: 2px solid #6366f1 !important;
      outline-offset: 1px !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button:disabled {
      opacity: .55 !important;
      cursor: default !important;
    }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[hidden] { display: none !important; }
    [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="more"] { display: none !important; }
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HIDDEN_ATTRIBUTE}] > [${TRANSLATION_TEXT_ATTRIBUTE}] {
      display: none !important;
    }
    [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HIDDEN_ATTRIBUTE}] {
      margin-bottom: .5em !important;
      opacity: .72 !important;
    }
    @media (any-hover: none) {
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] {
        max-height: 32px !important;
        margin-top: .28em !important;
        opacity: .72 !important;
        pointer-events: auto !important;
        transform: translateY(0) !important;
      }
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="copy"],
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="retranslate"],
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="visibility"] {
        display: none !important;
      }
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="more"] {
        display: inline-flex !important;
        align-items: center !important;
      }
      [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE}]
        > [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="copy"],
      [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE}]
        > [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="retranslate"],
      [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE}]
        > [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="visibility"] {
        display: inline-flex !important;
        align-items: center !important;
      }
      [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HIDDEN_ATTRIBUTE}]
        > [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="visibility"] {
        display: inline-flex !important;
        align-items: center !important;
      }
      [${TRANSLATION_ATTRIBUTE}][${TRANSLATION_HIDDEN_ATTRIBUTE}]
        > [${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="more"] {
        display: none !important;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [${TRANSLATION_ACTIONS_ATTRIBUTE}] { transition: none !important; }
    }
    li > [${TRANSLATION_ATTRIBUTE}] { margin-bottom: .35em !important; }
    li > [${TRANSLATION_PENDING_ATTRIBUTE}] { margin-bottom: .35em !important; }
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
  let articleContainer: HTMLElement | undefined;
  let mutationObserver: MutationObserver | undefined;
  let mutationTimer: number | undefined;
  let emptyCandidateScans = 0;
  let navigationTimer: number | undefined;
  let disposed = false;
  let controlHost: HTMLElement | undefined;
  let consecutiveIsolatedFailures = 0;
  let actionsHintClaimed = false;
  const interactiveSuspensions = new Set<string>();
  const interactionPreemptedRequestIds = new Set<string>();
  let resumeAfterInteractive = false;

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
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
    mutationTimer = undefined;
    for (const block of blocks) {
      clearBlockPending(block);
      block.translation?.remove();
      block.errorElement?.remove();
    }
    document.querySelectorAll(
      `[${TRANSLATION_ATTRIBUTE}], [${TRANSLATION_PENDING_ATTRIBUTE}], [${ERROR_ATTRIBUTE}]`,
    ).forEach((element) => element.remove());
    blocks = [];
    queue = [];
    observer?.disconnect();
    observer = undefined;
    articleContainer = undefined;
    emptyCandidateScans = 0;
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
    interactiveSuspensions.clear();
    interactionPreemptedRequestIds.clear();
    resumeAfterInteractive = false;
    currentState = { ...EMPTY_BILINGUAL_PAGE_STATE };
    destroyControl();
    if (notify) options.onStateChange(snapshot());
  };

  const resetForArticleChange = (message = ARTICLE_CHANGED_MESSAGE): void => {
    const targetLanguage = currentState.targetLanguage;
    clear(false);
    currentState = {
      phase: 'error',
      total: 0,
      translated: 0,
      failed: 0,
      translationsHidden: false,
      ...(targetLanguage ? { targetLanguage } : {}),
      message,
    };
    publish();
  };

  const eligibleForViewport = (block: BilingualBlock): boolean => {
    const bounds = block.element.getBoundingClientRect();
    return bounds.bottom >= -window.innerHeight * .35 && bounds.top <= window.innerHeight * 2.2;
  };

  const enqueue = (block: BilingualBlock, position: 'front' | 'end' = 'end'): void => {
    if (block.status !== 'idle') return;
    block.status = 'queued';
    if (position === 'front') {
      block.urgentQueue = true;
      queue.unshift(block);
    } else {
      delete block.urgentQueue;
      queue.push(block);
    }
  };

  const prioritizeQueueForViewport = (): void => {
    if (queue.length < 2) return;
    const viewportHeight = Math.max(
      1,
      window.innerHeight || document.documentElement.clientHeight,
    );
    const queueOrder = new Map(queue.map((block, index) => [block, index] as const));
    const documentOrder = new Map(blocks.map((block, index) => [block, index] as const));
    const priorities = new Map(queue.map((block) => [
      block,
      bilingualPageViewportPriority(block.element.getBoundingClientRect(), viewportHeight),
    ] as const));
    queue.sort((left, right) => {
      if (left.urgentQueue !== right.urgentQueue) return left.urgentQueue ? -1 : 1;
      if (left.urgentQueue && right.urgentQueue) {
        return (queueOrder.get(left) ?? 0) - (queueOrder.get(right) ?? 0);
      }
      const leftPriority = priorities.get(left)!;
      const rightPriority = priorities.get(right)!;
      if (leftPriority.tier !== rightPriority.tier) {
        return leftPriority.tier - rightPriority.tier;
      }
      if (leftPriority.distance !== rightPriority.distance) {
        return leftPriority.distance - rightPriority.distance;
      }
      return (documentOrder.get(left) ?? 0) - (documentOrder.get(right) ?? 0);
    });
  };

  const translationText = (block: BilingualBlock): string =>
    block.translation
      ?.querySelector<HTMLElement>(`[${TRANSLATION_TEXT_ATTRIBUTE}]`)
      ?.textContent
      ?.trim() ?? '';

  const articleTitleText = (): string | undefined => {
    const heading = blocks.find((block) => block.element.tagName === 'H1')?.text;
    if (heading) return heading;
    return normalizeBilingualPageText(document.title) || undefined;
  };

  const referenceContextForBlock = (block: BilingualBlock): string | undefined => {
    const index = blocks.indexOf(block);
    const previous = index > 0 ? blocks[index - 1] : undefined;
    const articleTitle = articleTitleText();
    const previousTranslation = previous?.status === 'done'
      ? translationText(previous)
      : undefined;
    return buildBilingualPageReferenceContext({
      currentText: block.text,
      ...(articleTitle ? { articleTitle } : {}),
      ...(previous ? { previousSource: previous.text } : {}),
      ...(previousTranslation ? { previousTranslation } : {}),
    });
  };

  const setTranslationFeedback = (
    block: BilingualBlock,
    message: string,
    timeoutMs = 1_600,
  ): void => {
    const translation = block.translation;
    const feedback = translation
      ?.querySelector<HTMLElement>(`[${TRANSLATION_FEEDBACK_ATTRIBUTE}]`);
    if (!translation || !feedback) return;
    feedback.textContent = message;
    if (timeoutMs <= 0) return;
    window.setTimeout(() => {
      if (translation.isConnected && feedback.textContent === message) feedback.textContent = '';
    }, timeoutMs);
  };

  const dismissTranslationActionsHint = (block: BilingualBlock): void => {
    const translation = block.translation;
    if (!translation?.hasAttribute(TRANSLATION_HINT_ATTRIBUTE)) return;
    translation.removeAttribute(TRANSLATION_HINT_ATTRIBUTE);
    const feedback = translation.querySelector<HTMLElement>(
      `[${TRANSLATION_FEEDBACK_ATTRIBUTE}]`,
    );
    if (
      feedback?.textContent === ACTIONS_HINT_MOUSE_MESSAGE ||
      feedback?.textContent === ACTIONS_HINT_TOUCH_MESSAGE
    ) feedback.textContent = '';
  };

  const setTouchActionsExpanded = (block: BilingualBlock, expanded: boolean): void => {
    const translation = block.translation;
    if (!translation) return;
    dismissTranslationActionsHint(block);
    translation.toggleAttribute(TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE, expanded);
    const more = translation.querySelector<HTMLButtonElement>('button[data-action="more"]');
    if (more) {
      more.setAttribute('aria-expanded', String(expanded));
      more.textContent = expanded ? '收起' : '更多';
    }
  };

  const revealTranslationActionsHint = async (block: BilingualBlock): Promise<void> => {
    if (actionsHintClaimed) return;
    actionsHintClaimed = true;
    try {
      const stored = await browser.storage.session.get(ACTIONS_HINT_STORAGE_KEY);
      if (stored[ACTIONS_HINT_STORAGE_KEY] === true) return;
    } catch {
      // The in-memory claim still prevents repeated hints if session storage is unavailable.
    }
    const translation = block.translation;
    if (!translation?.isConnected || block.status !== 'done') return;
    try {
      await browser.storage.session.set({ [ACTIONS_HINT_STORAGE_KEY]: true });
    } catch {
      // A storage failure only limits the hint to once per current page instance.
    }
    if (!translation.isConnected || block.translation !== translation) return;
    const touchOnly = window.matchMedia('(any-hover: none)').matches;
    const message = touchOnly ? ACTIONS_HINT_TOUCH_MESSAGE : ACTIONS_HINT_MOUSE_MESSAGE;
    const feedback = translation.querySelector<HTMLElement>(
      `[${TRANSLATION_FEEDBACK_ATTRIBUTE}]`,
    );
    translation.setAttribute(TRANSLATION_HINT_ATTRIBUTE, '');
    if (feedback) feedback.textContent = message;
    window.setTimeout(() => {
      if (translation.isConnected) translation.removeAttribute(TRANSLATION_HINT_ATTRIBUTE);
      if (feedback?.textContent === message) feedback.textContent = '';
    }, ACTIONS_HINT_DURATION_MS);
  };

  const setTranslationBusy = (block: BilingualBlock, busy: boolean): void => {
    const translation = block.translation;
    if (!translation) return;
    translation.toggleAttribute(TRANSLATION_BUSY_ATTRIBUTE, busy);
    const button = translation.querySelector<HTMLButtonElement>(
      `[${TRANSLATION_ACTIONS_ATTRIBUTE}] > button[data-action="retranslate"]`,
    );
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? '重译中…' : '重译本段';
    }
    if (busy) setTranslationFeedback(block, '正在重新翻译本段…', 0);
  };

  const setTranslationHidden = (block: BilingualBlock, hidden: boolean): void => {
    const translation = block.translation;
    if (!translation) return;
    setTouchActionsExpanded(block, false);
    translation.toggleAttribute(TRANSLATION_HIDDEN_ATTRIBUTE, hidden);
    const copy = translation.querySelector<HTMLButtonElement>('button[data-action="copy"]');
    const retranslate = translation.querySelector<HTMLButtonElement>(
      'button[data-action="retranslate"]',
    );
    const visibility = translation.querySelector<HTMLButtonElement>(
      'button[data-action="visibility"]',
    );
    if (copy) copy.hidden = hidden;
    if (retranslate) retranslate.hidden = hidden;
    if (visibility) visibility.textContent = hidden ? '显示译文' : '隐藏';
    setTranslationFeedback(block, hidden ? '本段译文已隐藏' : '', 0);
  };

  const showBlockPending = (
    block: BilingualBlock,
    requestId: string,
    revision: number,
  ): void => {
    delete block.pendingTimer;
    if (
      disposed ||
      revision !== taskRevision ||
      activeRequestId !== requestId ||
      block.status !== 'translating' ||
      !block.element.isConnected ||
      block.translation?.isConnected ||
      currentState.translationsHidden
    ) return;
    clearBlockPending(block);
    const pending = blockPendingElement(block);
    insertAfterSource(block, pending);
    block.pendingElement = pending;
  };

  const scheduleBlockPending = (
    block: BilingualBlock,
    requestId: string,
    revision: number,
    delayMs = TRANSLATION_PENDING_DELAY_MS,
  ): void => {
    clearBlockPending(block);
    if (currentState.translationsHidden || block.translation?.isConnected) return;
    block.pendingTimer = window.setTimeout(
      () => showBlockPending(block, requestId, revision),
      delayMs,
    );
  };

  const setAllTranslationsHidden = (hidden: boolean): void => {
    currentState = { ...currentState, translationsHidden: hidden };
    for (const block of blocks) {
      block.translation?.toggleAttribute(TRANSLATION_GLOBAL_HIDDEN_ATTRIBUTE, hidden);
      if (hidden && block.status === 'translating') clearBlockPending(block);
    }
    if (!hidden && activeRequestId) {
      const activeBlock = blocks.find((block) => (
        block.status === 'translating' && !block.translation?.isConnected
      ));
      if (activeBlock) scheduleBlockPending(activeBlock, activeRequestId, taskRevision, 0);
    }
    publish();
  };

  const copyBlockTranslation = async (block: BilingualBlock): Promise<void> => {
    setTouchActionsExpanded(block, false);
    const text = translationText(block);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const button = block.translation?.querySelector<HTMLButtonElement>(
        'button[data-action="copy"]',
      );
      if (button) button.textContent = '已复制';
      setTranslationFeedback(block, '译文已复制');
      window.setTimeout(() => {
        if (button?.isConnected && button.textContent === '已复制') button.textContent = '复制';
      }, 1_600);
    } catch {
      setTranslationFeedback(block, '复制失败，请重试');
    }
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
          .bar { display:flex;align-items:center;gap:8px;max-width:min(500px,calc(100vw - 32px));min-height:38px;box-sizing:border-box;border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:6px 7px 6px 10px;color:#253047;background:rgba(255,255,255,.96);box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px/1.3 Inter,"Segoe UI","Microsoft YaHei",sans-serif;backdrop-filter:blur(12px);}
          .mark { color:#5548d9;font-weight:800;font-size:15px; }
          output { min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
          button { min-width:32px;min-height:28px;border:0;border-radius:6px;padding:4px 7px;color:#4f46e5;background:#f0efff;cursor:pointer;font:600 11px/1.2 inherit;white-space:nowrap; }
          button:hover { background:#e4e2ff; }
          button:disabled { opacity:.62;cursor:default; }
          button[data-action="clear"] { color:#657084;background:transparent; }
          @media (prefers-color-scheme: dark) { .bar{color:#edf1f7;border-color:#4b4d7d;background:rgba(24,32,47,.96);box-shadow:0 8px 28px rgba(0,0,0,.36)} button{color:#cbc7ff;background:#292943} button:hover{background:#363653} button[data-action="clear"]{color:#aab3c2;background:transparent} }
          @media (max-width:480px) { .bar{gap:5px;padding-left:8px} .mark{display:none} button{padding-inline:6px} }
        </style>
        <div class="bar" role="status" aria-live="polite">
          <span class="mark" aria-hidden="true">π</span>
          <output></output>
          <button type="button" data-action="visibility"></button>
          <button type="button" data-action="pause"></button>
          <button type="button" data-action="stop">停止</button>
          <button type="button" data-action="clear">清除</button>
        </div>`;
      shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'visibility') {
            void control('toggle-translations');
          } else if (action === 'pause') {
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
    const visibility = shadow?.querySelector<HTMLButtonElement>('[data-action="visibility"]');
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
            ? currentState.pauseReason === 'interactive'
              ? `正在处理划词，正文稍后继续 · ${currentState.translated}/${currentState.total}`
              : `双语正文已暂停 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''}`
            : currentState.phase === 'stopped'
              ? `双语正文已停止 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''}`
              : `双语正文 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''} · 滚动继续`;
    }
    if (visibility) {
      const actionLabel = currentState.translationsHidden ? '展开译文' : '收起译文';
      visibility.textContent = currentState.translationsHidden ? '展开' : '收起';
      visibility.title = actionLabel;
      visibility.setAttribute('aria-label', actionLabel);
      visibility.setAttribute('aria-pressed', String(currentState.translationsHidden));
      visibility.hidden = currentState.translated === 0;
    }
    if (pause) {
      const retryCompleted = currentState.phase === 'complete' && currentState.failed > 0;
      pause.textContent = currentState.pauseReason === 'interactive'
        ? '稍后继续'
        : retryCompleted
        ? `重试 ${currentState.failed} 段`
        : currentState.phase === 'paused' || currentState.phase === 'error' || currentState.phase === 'stopped'
          ? '继续'
          : '暂停';
      pause.hidden = (currentState.phase === 'complete' && !currentState.failed) || currentState.total === 0;
      pause.disabled = currentState.pauseReason === 'interactive';
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

  const extensionOwnedMutationNode = (node: Node): boolean => {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
    return Boolean(element?.closest(
      `[${TRANSLATION_ATTRIBUTE}], [${TRANSLATION_PENDING_ATTRIBUTE}], [${ERROR_ATTRIBUTE}], #${CONTROL_HOST_ID}`,
    ));
  };

  const mutationNeedsDynamicScan = (mutation: MutationRecord): boolean => {
    if (mutation.type === 'characterData') return !extensionOwnedMutationNode(mutation.target);
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.length === 0 || changedNodes.some(
      (node) => !extensionOwnedMutationNode(node),
    );
  };

  const scheduleDynamicScan = (delayMs = DYNAMIC_SCAN_DELAY_MS): void => {
    if (disposed || currentState.phase === 'idle') return;
    if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      mutationTimer = undefined;
      refreshDynamicBlocks();
    }, delayMs);
  };

  const observeArticleMutations = (): void => {
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    if (!articleContainer?.isConnected) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationNeedsDynamicScan)) scheduleDynamicScan();
    });
    mutationObserver.observe(articleContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };

  const reconcileDynamicBlocks = (
    candidates: BilingualBlock[],
    nextRoot: HTMLElement,
  ): void => {
    if (!candidates.length) {
      emptyCandidateScans += 1;
      if (emptyCandidateScans < 2) scheduleDynamicScan(480);
      else resetForArticleChange();
      return;
    }
    emptyCandidateScans = 0;
    if (blocks.length && looksLikeArticleReplacement(blocks, candidates)) {
      resetForArticleChange();
      return;
    }

    const previousBlocks = blocks;
    const previousByElement = new Map(
      previousBlocks.map((block) => [block.element, block] as const),
    );
    const disconnectedBySignature = new Map<string, BilingualBlock[]>();
    for (const block of previousBlocks) {
      if (block.element.isConnected) continue;
      const signature = blockSignature(block);
      const matching = disconnectedBySignature.get(signature) ?? [];
      matching.push(block);
      disconnectedBySignature.set(signature, matching);
    }

    const used = new Set<BilingualBlock>();
    const nextBlocks: BilingualBlock[] = [];
    let newWork = false;
    let structureChanged = articleContainer !== nextRoot;
    for (const candidate of candidates) {
      let block = previousByElement.get(candidate.element);
      if (block && !used.has(block)) {
        used.add(block);
        if (block.text !== candidate.text) {
          clearBlockPending(block);
          block.translation?.remove();
          block.errorElement?.remove();
          delete block.translation;
          delete block.errorElement;
          delete block.bypassCacheNext;
          delete block.restoreStateAfterRetranslation;
          block.text = candidate.text;
          block.status = 'idle';
          newWork = true;
        }
      } else {
        const reusable = disconnectedBySignature.get(blockSignature(candidate));
        block = reusable?.find((item) => !used.has(item));
        if (block) {
          observer?.unobserve(block.element);
          block.element = candidate.element;
          used.add(block);
          if (block.status === 'done' && block.translation) {
            insertAfterSource(block, block.translation);
            applySourceTypography(block.translation, block, 18);
          } else if (block.status === 'error' && block.errorElement) {
            insertAfterSource(block, block.errorElement);
            applySourceTypography(block.errorElement, block, 14);
          } else if (block.status === 'translating' && block.pendingElement) {
            insertAfterSource(block, block.pendingElement);
            applySourceTypography(block.pendingElement, block, 14);
          } else if (block.status === 'done' || block.status === 'error') {
            block.status = 'idle';
            newWork = true;
          }
          structureChanged = true;
        } else {
          block = candidate;
          used.add(block);
          newWork = true;
          structureChanged = true;
        }
      }
      nextBlocks.push(block);
    }

    for (const block of previousBlocks) {
      if (used.has(block)) continue;
      clearBlockPending(block);
      block.translation?.remove();
      block.errorElement?.remove();
      structureChanged = true;
    }
    const retained = new Set(nextBlocks);
    queue = queue.filter((block) => retained.has(block) && block.status === 'queued');
    blocks = nextBlocks;
    if (articleContainer !== nextRoot) {
      articleContainer = nextRoot;
      observeArticleMutations();
    }
    if (structureChanged) observeBlocks();
    if (!newWork && !structureChanged) return;

    if (newWork && currentState.phase === 'complete') {
      currentState = { ...currentState, phase: 'running' };
      delete currentState.message;
      delete currentState.pauseReason;
    }
    if (currentState.phase === 'running') {
      for (const block of blocks) {
        if (block.status === 'idle' && eligibleForViewport(block)) enqueue(block);
      }
    }
    syncCounts();
    if (
      currentState.phase === 'running' &&
      currentState.translated + currentState.failed === currentState.total
    ) {
      settleCompletedState();
      return;
    }
    publish();
    if (currentState.phase === 'running') void processQueue();
  };

  const refreshDynamicBlocks = (): void => {
    const targetLanguage = currentState.targetLanguage;
    if (!targetLanguage || currentState.phase === 'idle') return;
    const selection = articleContainer?.isConnected
      ? {
          root: articleContainer,
          blocks: candidateElements(articleContainer, targetLanguage),
        }
      : articleRoot(targetLanguage);
    reconcileDynamicBlocks(selection.blocks, selection.root);
  };

  const removeBlockError = (block: BilingualBlock): void => {
    block.errorElement?.remove();
    delete block.errorElement;
  };

  const settleCompletedState = (): boolean => {
    syncCounts();
    if (currentState.translated + currentState.failed < currentState.total) return false;
    delete currentState.message;
    delete currentState.pauseReason;
    resumeAfterInteractive = false;
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
    replacePendingOrInsert(block, error);
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

  const restorePageStateAfterRetranslation = (block: BilingualBlock): boolean => {
    const restore = block.restoreStateAfterRetranslation;
    delete block.restoreStateAfterRetranslation;
    if (!restore) return false;
    currentState = { ...currentState, phase: restore.phase };
    delete currentState.message;
    delete currentState.pauseReason;
    if (restore.message !== undefined) currentState.message = restore.message;
    if (restore.pauseReason !== undefined) currentState.pauseReason = restore.pauseReason;
    syncCounts();
    publish();
    return true;
  };

  const finishRetranslationFailure = (
    block: BilingualBlock,
    message: string,
    globalFailure: boolean,
  ): void => {
    delete block.bypassCacheNext;
    block.status = 'done';
    setTranslationBusy(block, false);
    setTranslationFeedback(
      block,
      `重译失败：${message.split('\n')[0]?.slice(0, 100) || '请重试'}`,
      3_000,
    );
    if (restorePageStateAfterRetranslation(block)) return;
    syncCounts();
    if (globalFailure) {
      delete currentState.pauseReason;
      setState({ phase: 'error', message: `本段重译失败：${message}` });
      return;
    }
    if (!settleCompletedState()) publish();
  };

  const requestBlockRetranslation = (block: BilingualBlock): void => {
    if (block.status !== 'done' || !block.translation?.isConnected) return;
    setTouchActionsExpanded(block, false);
    if (interactiveSuspensions.size) {
      setTranslationFeedback(block, '当前选区翻译完成后再重试本段');
      return;
    }
    if (['paused', 'stopped', 'error'].includes(currentState.phase)) {
      block.restoreStateAfterRetranslation = {
        phase: currentState.phase,
        ...(currentState.message !== undefined ? { message: currentState.message } : {}),
        ...(currentState.pauseReason !== undefined
          ? { pauseReason: currentState.pauseReason }
          : {}),
      };
    } else delete block.restoreStateAfterRetranslation;
    queue = queue.filter((candidate) => candidate !== block);
    block.bypassCacheNext = true;
    block.status = 'idle';
    enqueue(block, 'front');
    setTranslationBusy(block, true);
    syncCounts();
    consecutiveIsolatedFailures = 0;
    delete currentState.message;
    delete currentState.pauseReason;
    setState({ phase: 'running' });
    void processQueue();
  };

  const blockRequestStillCurrent = (block: BilingualBlock, requestedText: string): boolean =>
    blocks.includes(block) &&
    block.element.isConnected &&
    block.text === requestedText &&
    readableElementText(block.element) === requestedText;

  const discardStaleBlockRequest = (
    block: BilingualBlock,
    requestId: string,
  ): void => {
    interactionPreemptedRequestIds.delete(requestId);
    clearBlockPending(block);
    if (blocks.includes(block) && block.status === 'translating') block.status = 'idle';
    syncCounts();
    publish();
    scheduleDynamicScan(0);
  };

  const translateBlock = async (block: BilingualBlock, revision: number): Promise<void> => {
    const requestId = crypto.randomUUID();
    const requestedText = block.text;
    const replacingTranslation = Boolean(block.translation);
    const preserveHidden = block.translation?.hasAttribute(TRANSLATION_HIDDEN_ATTRIBUTE) ?? false;
    activeRequestId = requestId;
    block.status = 'translating';
    if (!replacingTranslation) scheduleBlockPending(block, requestId, revision);
    const config = options.requestConfig();
    const contextText = referenceContextForBlock(block);
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
          ...(contextText ? { contextText } : {}),
          ...(block.bypassCacheNext ? { bypassCache: true } : {}),
        },
      } satisfies RuntimeMessage) as TranslateRuntimeResponse;
      if (disposed || revision !== taskRevision || activeRequestId !== requestId) return;
      activeRequestId = undefined;
      if (!blockRequestStillCurrent(block, requestedText)) {
        discardStaleBlockRequest(block, requestId);
        return;
      }
      if (!response.ok) {
        if (interactionPreemptedRequestIds.delete(requestId)) {
          clearBlockPending(block);
          block.status = 'idle';
          enqueue(block, 'front');
          syncCounts();
          publish();
          return;
        }
        const message = translationErrorMessage(response.error.code, response.error.message);
        if (replacingTranslation) {
          finishRetranslationFailure(
            block,
            message,
            !isIsolatedBilingualBlockError(response.error.code),
          );
          return;
        }
        if (isIsolatedBilingualBlockError(response.error.code)) {
          markIsolatedFailure(block, message);
          return;
        }
        block.status = 'error';
        clearBlockPending(block);
        syncCounts();
        setState({
          phase: 'error',
          message,
        });
        return;
      }
      if (!block.element.isConnected) {
        if (replacingTranslation) {
          finishRetranslationFailure(block, '网页正文已经变化，请重新开始正文翻译。', true);
          return;
        }
        block.status = 'error';
        clearBlockPending(block);
        syncCounts();
        setState({ phase: 'error', message: '网页正文已经变化，请清除后重新开始。' });
        return;
      }
      interactionPreemptedRequestIds.delete(requestId);
      delete block.bypassCacheNext;
      const translation = translationElement(
        block,
        response.data.result.translatedText,
        currentState.targetLanguage!,
        {
          copy: () => void copyBlockTranslation(block),
          retranslate: () => requestBlockRetranslation(block),
          toggleHidden: () => setTranslationHidden(
            block,
            !block.translation?.hasAttribute(TRANSLATION_HIDDEN_ATTRIBUTE),
          ),
          toggleMore: () => setTouchActionsExpanded(
            block,
            !block.translation?.hasAttribute(TRANSLATION_TOUCH_EXPANDED_ATTRIBUTE),
          ),
        },
      );
      translation.toggleAttribute(
        TRANSLATION_GLOBAL_HIDDEN_ATTRIBUTE,
        currentState.translationsHidden,
      );
      insertTranslation(block, translation);
      if (preserveHidden) setTranslationHidden(block, true);
      block.status = 'done';
      consecutiveIsolatedFailures = 0;
      if (!replacingTranslation && !currentState.translationsHidden) {
        void revealTranslationActionsHint(block);
      }
      if (restorePageStateAfterRetranslation(block)) return;
      if (!settleCompletedState()) publish();
    } catch (error) {
      if (disposed || revision !== taskRevision || activeRequestId !== requestId) return;
      activeRequestId = undefined;
      if (!blockRequestStillCurrent(block, requestedText)) {
        discardStaleBlockRequest(block, requestId);
        return;
      }
      if (interactionPreemptedRequestIds.delete(requestId)) {
        clearBlockPending(block);
        block.status = 'idle';
        enqueue(block, 'front');
        syncCounts();
        publish();
        return;
      }
      if (replacingTranslation) {
        finishRetranslationFailure(
          block,
          error instanceof Error ? error.message : '无法重新翻译本段。',
          true,
        );
        return;
      }
      block.status = 'error';
      clearBlockPending(block);
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
        prioritizeQueueForViewport();
        const block = queue.shift();
        if (!block) break;
        if (block.status !== 'queued') continue;
        delete block.urgentQueue;
        await translateBlock(block, revision);
        if (currentState.phase !== 'running') break;
      }
    })().finally(() => {
      activeTask = undefined;
      if (currentState.phase === 'running' && queue.length) void processQueue();
    });
    await activeTask;
  };

  const resume = (retryFailed = true): void => {
    consecutiveIsolatedFailures = 0;
    const failedBlocks = retryFailed
      ? blocks.filter((block) => block.status === 'error')
      : [];
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
    delete currentState.pauseReason;
    setState({ phase: 'running' });
    void processQueue();
  };

  const suspendForInteractiveTranslation = (): string | undefined => {
    const activeBlock = blocks.find((block) => block.status === 'translating');
    if (activeBlock) clearBlockPending(activeBlock);
    if (currentState.phase === 'paused' && currentState.pauseReason === 'user') {
      if (activeRequestId) interactionPreemptedRequestIds.add(activeRequestId);
      return undefined;
    }
    if (
      currentState.phase !== 'running' &&
      !(currentState.phase === 'paused' && currentState.pauseReason === 'interactive')
    ) return undefined;
    const token = crypto.randomUUID();
    interactiveSuspensions.add(token);
    if (currentState.phase === 'running') {
      resumeAfterInteractive = true;
      if (activeRequestId) interactionPreemptedRequestIds.add(activeRequestId);
      setState({
        phase: 'paused',
        pauseReason: 'interactive',
        message: '正在处理划词，正文稍后继续。',
      });
    }
    return token;
  };

  const resumeAfterInteractiveTranslation = (token: string | undefined): void => {
    if (!token || !interactiveSuspensions.delete(token) || interactiveSuspensions.size) return;
    if (
      !resumeAfterInteractive ||
      currentState.phase !== 'paused' ||
      currentState.pauseReason !== 'interactive'
    ) return;
    resumeAfterInteractive = false;
    resume(false);
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
    articleContainer = selection.root;
    sourcePageIdentity = pageIdentity(options.pageUrl());
    currentState = {
      phase: blocks.length ? 'running' : 'error',
      total: blocks.length,
      translated: 0,
      failed: 0,
      translationsHidden: false,
      targetLanguage,
      ...(!blocks.length ? { message: '当前页面没有识别到适合双语阅读的正文。' } : {}),
    };
    publish();
    if (!blocks.length) return snapshot();
    installTranslationStyle();
    taskRevision += 1;
    observeBlocks();
    observeArticleMutations();
    blocks.filter(eligibleForViewport).forEach((block) => enqueue(block));
    if (!queue.length && blocks[0]) enqueue(blocks[0]);
    navigationTimer = window.setInterval(() => {
      if (pageIdentity(options.pageUrl()) !== sourcePageIdentity) {
        resetForArticleChange('页面已切换，请重新开始正文翻译。');
        return;
      }
      if (!articleContainer?.isConnected) scheduleDynamicScan(0);
    }, 750);
    void processQueue();
    return snapshot();
  };

  const control = async (action: BilingualPageAction): Promise<BilingualPageState> => {
    if (action === 'clear') {
      clear();
      return snapshot();
    }
    if (action === 'toggle-translations') {
      if (currentState.phase !== 'idle' && currentState.translated > 0) {
        setAllTranslationsHidden(!currentState.translationsHidden);
      }
      return snapshot();
    }
    if (
      currentState.phase === 'idle' ||
      (currentState.phase === 'complete' && currentState.failed === 0)
    ) return snapshot();
    if (action === 'pause' && currentState.phase === 'running') {
      resumeAfterInteractive = false;
      delete currentState.message;
      setState({ phase: 'paused', pauseReason: 'user' });
    } else if (
      action === 'resume' && (
        ['paused', 'stopped', 'error'].includes(currentState.phase) ||
        (currentState.phase === 'complete' && currentState.failed > 0)
      )
    ) {
      if (currentState.pauseReason === 'interactive' && interactiveSuspensions.size) {
        return snapshot();
      }
      resumeAfterInteractive = false;
      resume();
    } else if (action === 'stop') {
      taskRevision += 1;
      cancelActiveRequest();
      resumeAfterInteractive = false;
      interactionPreemptedRequestIds.clear();
      blocks.forEach((block) => {
        if (block.status !== 'queued' && block.status !== 'translating') return;
        clearBlockPending(block);
        block.status = block.translation?.isConnected ? 'done' : 'idle';
        delete block.bypassCacheNext;
        delete block.restoreStateAfterRetranslation;
        setTranslationBusy(block, false);
      });
      queue = [];
      syncCounts();
      delete currentState.message;
      delete currentState.pauseReason;
      setState({ phase: 'stopped' });
    }
    return snapshot();
  };

  return {
    start,
    control,
    suspendForInteractiveTranslation,
    resumeAfterInteractiveTranslation,
    state: snapshot,
    dispose: () => {
      if (disposed) return;
      clear(false);
      disposed = true;
    },
  };
}
