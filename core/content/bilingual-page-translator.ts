import type {
  BilingualPageSessionResponse,
  RuntimeMessage,
  TranslateRuntimeResponse,
} from '../messaging/messages';
import { translationErrorMessage } from '../messaging/user-facing-error';
import { isLikelyTargetLanguage } from '../language/target-language';
import {
  isSupportedTargetLanguage,
  SUPPORTED_TARGET_LANGUAGES,
  type SupportedTargetLanguage,
} from '../language/supported-target-languages';
import { isLikelySourceCode } from '../selection/passive-selection-intent';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import {
  bilingualPageLanguageSwitchConfirmation,
  bilingualPageViewportPriority,
  buildBilingualPageReferenceContext,
  EMPTY_BILINGUAL_PAGE_STATE,
  isBilingualPageTextCandidate,
  isIsolatedBilingualBlockError,
  normalizeBilingualPageText,
  type BilingualPageAction,
  type BilingualPageState,
} from '../translation/bilingual-page';
import {
  bilingualPageSessionBlockSignature,
  bilingualPageSessionMatchesDocument,
  bilingualPageSessionPageKey,
  type BilingualPageSessionActivity,
  type BilingualPageSessionBlock,
  type BilingualPageSessionDescriptor,
  type BilingualPageSessionSnapshot,
  type BilingualPageSessionUpdate,
} from '../translation/bilingual-page-session';

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
const LAUNCHER_HOST_ID = 'pi-translator-bilingual-page-launcher';
const STYLE_ID = 'pi-translator-bilingual-page-style';
const SCOPE_STYLE_ID = 'pi-translator-bilingual-page-scope-style';
const SCOPE_PREVIEW_ATTRIBUTE = 'data-pi-bilingual-scope-preview';
const MIN_LAUNCHER_BLOCKS = 4;
const MIN_LAUNCHER_TEXT_LENGTH = 480;
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
  `#${LAUNCHER_HOST_ID}`,
].join(',');

type BlockStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

interface BilingualBlock {
  element: HTMLElement;
  text: string;
  status: BlockStatus;
  sessionSignature?: string;
  restoredFromSession?: boolean;
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
  preferredTargetLanguage(): SupportedTargetLanguage;
  launcherEnabled(): boolean;
  launcherSuppressed(): boolean;
  onStateChange(state: BilingualPageState): void;
}

export interface BilingualPageTranslator {
  start(targetLanguage: SupportedTargetLanguage): Promise<BilingualPageState>;
  restoreSession(): Promise<BilingualPageState | undefined>;
  control(action: BilingualPageAction): Promise<BilingualPageState>;
  suspendForInteractiveTranslation(): string | undefined;
  resumeAfterInteractiveTranslation(token: string | undefined): void;
  refreshDiscovery(): void;
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

function candidateElements(
  root: ParentNode,
  targetLanguage: string,
  excludedElements?: ReadonlySet<HTMLElement>,
): BilingualBlock[] {
  const candidates: BilingualBlock[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (
      excludedElements?.has(element) ||
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

function articleRoot(
  targetLanguage: string,
  excludedElements?: ReadonlySet<HTMLElement>,
): { root: HTMLElement; blocks: BilingualBlock[] } {
  const containers = [...document.querySelectorAll<HTMLElement>('article, main, [role="main"]')]
    .filter((element) => !element.closest(EXCLUDED_ANCESTOR_SELECTOR) && elementVisible(element));
  let best: { root: HTMLElement; blocks: BilingualBlock[]; score: number } | undefined;
  for (const root of containers) {
    const blocks = candidateElements(root, targetLanguage, excludedElements);
    const score = blocks.reduce((total, block) => total + Math.min(block.text.length, 800), 0);
    if (!best || score > best.score) best = { root, blocks, score };
  }
  if (best && (best.blocks.length >= 2 || best.score >= 240)) return best;
  const root = document.body;
  return {
    root,
    blocks: root ? candidateElements(root, targetLanguage, excludedElements) : [],
  };
}

function launcherCandidate(blocks: BilingualBlock[]): boolean {
  if (blocks.length < MIN_LAUNCHER_BLOCKS) return false;
  const textLength = blocks.reduce(
    (total, block) => total + Math.min(block.text.length, 800),
    0,
  );
  return textLength >= MIN_LAUNCHER_TEXT_LENGTH;
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
  const logoUrl = browser.runtime.getURL('/brand/pi_logo.png');
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
  let launcherHost: HTMLElement | undefined;
  let launcherRefreshTimer: number | undefined;
  let launcherNavigationTimer: number | undefined;
  let launcherPlacementTimer: number | undefined;
  let launcherLastScrollAt = 0;
  let launcherPageIdentity = '';
  let launcherDismissedPageIdentity = '';
  let launcherCandidateCount = 0;
  let consecutiveIsolatedFailures = 0;
  let actionsHintClaimed = false;
  const interactiveSuspensions = new Set<string>();
  const interactionPreemptedRequestIds = new Set<string>();
  let resumeAfterInteractive = false;
  let pendingLanguageSwitch: SupportedTargetLanguage | undefined;
  let scopePreviewActive = false;
  let resumeAfterScopePreview = false;
  let scopePreviewBlocks: BilingualBlock[] = [];
  let scopeDraftExcludedElements = new Set<HTMLElement>();
  const scopeExcludedElements = new Set<HTMLElement>();
  let activeSessionDescriptor: BilingualPageSessionDescriptor | undefined;
  let sessionDocumentSignatures: string[] = [];
  let sessionExcludedSignatures = new Set<string>();
  let sessionPersistenceTimer: number | undefined;
  let sessionWriteTail: Promise<void> = Promise.resolve();
  let scheduleSessionStatePersistence: () => void = () => undefined;
  let persistSessionBlock: (block: BilingualBlock) => Promise<void> = async () => undefined;

  const assignSessionSignatures = (candidates: BilingualBlock[]): void => {
    const occurrences = new Map<string, number>();
    for (const block of candidates) {
      const base = blockSignature(block);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      block.sessionSignature = bilingualPageSessionBlockSignature(
        block.element.tagName,
        block.text,
        occurrence,
      );
    }
  };

  const sessionDescriptor = (
    targetLanguage: SupportedTargetLanguage,
  ): BilingualPageSessionDescriptor => {
    const config = options.requestConfig();
    return {
      pageKey: bilingualPageSessionPageKey(pageIdentity(options.pageUrl())),
      targetLanguage,
      sourceLanguage: config.sourceLanguage,
      style: config.style,
      contentMode: config.contentMode,
    };
  };

  const sessionActivity = (): BilingualPageSessionActivity => {
    if (currentState.phase === 'paused' && currentState.pauseReason === 'user') return 'paused';
    if (currentState.phase === 'stopped' || currentState.phase === 'error') return 'stopped';
    return 'active';
  };

  const sessionUpdate = (block?: BilingualPageSessionBlock): BilingualPageSessionUpdate | undefined => {
    if (!activeSessionDescriptor || !sessionDocumentSignatures.length) return undefined;
    return {
      descriptor: activeSessionDescriptor,
      documentSignatures: [...sessionDocumentSignatures],
      excludedSignatures: [...sessionExcludedSignatures]
        .filter((signature) => sessionDocumentSignatures.includes(signature)),
      translationsHidden: currentState.translationsHidden,
      activity: sessionActivity(),
      ...(block ? { block } : {}),
    };
  };

  const enqueueSessionWrite = (update: BilingualPageSessionUpdate): Promise<void> => {
    const write = sessionWriteTail.catch(() => undefined).then(async () => {
      const response = await browser.runtime.sendMessage({
        type: 'SAVE_BILINGUAL_PAGE_SESSION',
        payload: update,
      } satisfies RuntimeMessage) as BilingualPageSessionResponse;
      if (!response.ok) throw new Error(response.error.message);
    });
    sessionWriteTail = write.catch(() => undefined);
    return sessionWriteTail;
  };

  const persistSessionState = async (): Promise<void> => {
    const update = sessionUpdate();
    if (update) await enqueueSessionWrite(update);
  };

  scheduleSessionStatePersistence = (): void => {
    if (!activeSessionDescriptor || !sessionDocumentSignatures.length || disposed) return;
    if (sessionPersistenceTimer !== undefined) window.clearTimeout(sessionPersistenceTimer);
    sessionPersistenceTimer = window.setTimeout(() => {
      sessionPersistenceTimer = undefined;
      void persistSessionState();
    }, 120);
  };

  const discardSession = async (
    descriptor = activeSessionDescriptor,
  ): Promise<void> => {
    if (!descriptor) return;
    if (sessionPersistenceTimer !== undefined) window.clearTimeout(sessionPersistenceTimer);
    sessionPersistenceTimer = undefined;
    await sessionWriteTail.catch(() => undefined);
    await browser.runtime.sendMessage({
      type: 'CLEAR_BILINGUAL_PAGE_SESSION',
      payload: { descriptor },
    } satisfies RuntimeMessage).catch(() => undefined);
  };

  const readSession = async (
    descriptor: BilingualPageSessionDescriptor,
  ): Promise<BilingualPageSessionSnapshot | undefined> => {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_BILINGUAL_PAGE_SESSION',
        payload: { descriptor },
      } satisfies RuntimeMessage) as BilingualPageSessionResponse;
      return response.ok ? response.data.session : undefined;
    } catch {
      return undefined;
    }
  };

  const snapshot = (): BilingualPageState => ({ ...currentState });

  const publish = (): void => {
    if (disposed) return;
    renderControl();
    options.onStateChange(snapshot());
    scheduleSessionStatePersistence();
  };

  const setState = (next: Partial<BilingualPageState>): void => {
    currentState = { ...currentState, ...next };
    publish();
  };

  const translatedCount = (): number => blocks.filter((block) => block.status === 'done').length;
  const failedCount = (): number => blocks.filter((block) => block.status === 'error').length;

  const syncCounts = (): void => {
    const restored = blocks.filter(
      (block) => block.status === 'done' && block.restoredFromSession,
    ).length;
    currentState = {
      ...currentState,
      total: blocks.length,
      translated: translatedCount(),
      failed: failedCount(),
      ...(restored ? { restored } : {}),
    };
    if (!restored) delete currentState.restored;
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

  const scheduleLauncherPlacement = (delayMs = 0): void => {
    if (launcherPlacementTimer !== undefined) window.clearTimeout(launcherPlacementTimer);
    launcherPlacementTimer = window.setTimeout(placeLauncher, delayMs);
  };

  const handleLauncherScroll = (): void => {
    launcherLastScrollAt = Date.now();
    scheduleLauncherPlacement(220);
  };

  const handleLauncherViewportChange = (): void => scheduleLauncherPlacement();

  const destroyLauncher = (): void => {
    if (launcherPlacementTimer !== undefined) window.clearTimeout(launcherPlacementTimer);
    launcherPlacementTimer = undefined;
    window.removeEventListener('scroll', handleLauncherScroll, true);
    window.removeEventListener('resize', handleLauncherViewportChange);
    window.visualViewport?.removeEventListener('resize', handleLauncherViewportChange);
    launcherHost?.remove();
    launcherHost = undefined;
  };

  const stopLauncherNavigationMonitor = (): void => {
    if (launcherNavigationTimer !== undefined) window.clearInterval(launcherNavigationTimer);
    launcherNavigationTimer = undefined;
  };

  const ensureLauncherNavigationMonitor = (): void => {
    if (launcherNavigationTimer !== undefined) return;
    launcherNavigationTimer = window.setInterval(() => {
      if (pageIdentity(options.pageUrl()) !== launcherPageIdentity) {
        discoverLauncher();
      } else if (Date.now() - launcherLastScrollAt > 240) {
        scheduleLauncherPlacement();
      }
    }, 1_000);
  };

  const rectanglesOverlap = (first: DOMRect, second: DOMRect, gap = 8): boolean => (
    first.left < second.right + gap &&
    first.right > second.left - gap &&
    first.top < second.bottom + gap &&
    first.bottom > second.top - gap
  );

  const piOverlayObstacles = (): DOMRect[] => {
    const overlay = document.getElementById('tex-selection-translator-root');
    const root = overlay?.shadowRoot;
    if (!overlay || !root) return [];
    const view = overlay.dataset.piView;
    const selector = view === 'sidebar'
      ? '.surface.sidebar'
      : view === 'sidebar-collapsed'
        ? '.collapsed-tab'
        : view === 'card' || view === 'notice'
          ? '.surface.card'
          : '';
    if (!selector) return [];
    return [...root.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => elementVisible(element))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width >= 20 && rect.height >= 20);
  };

  const fixedPageObstaclesAt = (rect: DOMRect): DOMRect[] => {
    const margin = 8;
    const left = Math.max(1, rect.left - margin);
    const right = Math.min(innerWidth - 1, rect.right + margin);
    const top = Math.max(1, rect.top - margin);
    const bottom = Math.min(innerHeight - 1, rect.bottom + margin);
    const xValues = [left, (left + right) / 2, right];
    const yValues = [top, (top + bottom) / 2, bottom];
    const obstacles = new Map<HTMLElement, DOMRect>();
    for (const x of xValues) {
      for (const y of yValues) {
        for (const element of document.elementsFromPoint(x, y)) {
          if (
            element === launcherHost ||
            element === document.documentElement ||
            element === document.body ||
            element.id === LAUNCHER_HOST_ID ||
            element.id === CONTROL_HOST_ID ||
            element.id === 'tex-selection-translator-root'
          ) continue;
          let candidate = element instanceof HTMLElement ? element : element.parentElement;
          while (candidate && candidate !== document.body) {
            const style = getComputedStyle(candidate);
            if (style.position === 'fixed' || style.position === 'sticky') {
              const candidateRect = candidate.getBoundingClientRect();
              const viewportArea = Math.max(1, innerWidth * innerHeight);
              if (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.pointerEvents !== 'none' &&
                Number.parseFloat(style.opacity || '1') > 0.05 &&
                candidateRect.width >= 20 &&
                candidateRect.height >= 20 &&
                candidateRect.width * candidateRect.height < viewportArea * 0.58
              ) obstacles.set(candidate, candidateRect);
              break;
            }
            candidate = candidate.parentElement;
          }
        }
      }
    }
    return [...obstacles.values()];
  };

  function placeLauncher(): void {
    launcherPlacementTimer = undefined;
    if (!launcherHost?.isConnected) return;
    const currentRect = launcherHost.getBoundingClientRect();
    const width = Math.max(1, currentRect.width);
    const height = Math.max(1, currentRect.height);
    const edge = 14;
    const baseBottom = 18;
    const lift = Math.max(52, height + 14);
    const piObstacles = piOverlayObstacles();
    const rightSideOccupied = piObstacles.some((rect) => (
      rect.right > innerWidth / 2 && rect.height > innerHeight * 0.35
    ));
    const preferredSide: 'left' | 'right' = rightSideOccupied ? 'left' : 'right';
    const alternateSide: 'left' | 'right' = preferredSide === 'right' ? 'left' : 'right';
    const placements: Array<{ side: 'left' | 'right'; level: number }> = [
      { side: preferredSide, level: 0 },
      { side: preferredSide, level: 1 },
      { side: alternateSide, level: 0 },
      { side: preferredSide, level: 2 },
      { side: alternateSide, level: 1 },
      { side: preferredSide, level: 3 },
      { side: alternateSide, level: 2 },
      { side: alternateSide, level: 3 },
    ];
    let selected = placements[0]!;
    let selectedBottom = baseBottom;
    for (const placement of placements) {
      const bottomOffset = baseBottom + placement.level * lift;
      const left = placement.side === 'left' ? edge : innerWidth - edge - width;
      const top = innerHeight - bottomOffset - height;
      if (left < 0 || top < 4) continue;
      const candidateRect = new DOMRect(left, top, width, height);
      const obstacles = [...piObstacles, ...fixedPageObstaclesAt(candidateRect)];
      if (obstacles.some((obstacle) => rectanglesOverlap(candidateRect, obstacle))) continue;
      selected = placement;
      selectedBottom = bottomOffset;
      break;
    }
    launcherHost.style.left = selected.side === 'left' ? `${edge}px` : 'auto';
    launcherHost.style.right = selected.side === 'right' ? `${edge}px` : 'auto';
    launcherHost.style.bottom = `${selectedBottom}px`;
    launcherHost.style.visibility = 'visible';
    launcherHost.dataset.piPlacement = selected.level === 0
      ? `bottom-${selected.side}`
      : `raised-${selected.side}-${selected.level}`;
  }

  const renderLauncher = (): void => {
    if (
      disposed ||
      currentState.phase !== 'idle' ||
      scopePreviewActive ||
      launcherCandidateCount === 0
    ) {
      destroyLauncher();
      return;
    }
    if (!launcherHost?.isConnected) {
      launcherHost = document.createElement('div');
      launcherHost.id = LAUNCHER_HOST_ID;
      launcherHost.style.cssText = 'all:initial;position:fixed;z-index:2147483644;right:14px;bottom:18px;visibility:hidden;';
      const shadow = launcherHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { color-scheme: light dark; }
          .launcher { position:relative;display:flex;align-items:center;box-sizing:border-box;border:1px solid rgba(99,102,241,.25);border-radius:999px;padding:3px;color:#30394c;background:rgba(255,255,255,.94);box-shadow:0 6px 22px rgba(15,23,42,.15);font:11px/1.2 Inter,"Segoe UI","Microsoft YaHei",sans-serif;backdrop-filter:blur(10px); }
          button { min-height:30px;box-sizing:border-box;border:0;border-radius:999px;padding:5px 8px;color:#5a50d6;background:transparent;cursor:pointer;font:650 11px/1.2 inherit;white-space:nowrap; }
          button:hover { background:#f0efff; }
          button[data-action="start"] { display:inline-flex;align-items:center;padding-left:9px;color:#fff;background:linear-gradient(135deg,#5b5ee5,#765fe7); }
          button[data-action="start"]:hover { filter:brightness(.97); }
          .mark { display:block;width:15px;height:13px;margin-right:5px;object-fit:contain;filter:brightness(0) invert(1); }
          .count { margin-left:3px;opacity:.82;font-weight:550; }
          button[data-action="dismiss"] { min-width:28px;padding-inline:5px;color:#8791a2;font-size:14px;font-weight:500; }
          details.more { position:relative;display:none; }
          details.more > summary { display:grid;place-items:center;width:30px;min-height:30px;box-sizing:border-box;border-radius:999px;color:#697386;cursor:pointer;font:700 14px/1 inherit;list-style:none; }
          details.more > summary::-webkit-details-marker { display:none; }
          details.more > summary:hover,details.more[open] > summary { background:#f0efff;color:#5a50d6; }
          .menu { position:absolute;right:0;bottom:calc(100% + 7px);display:grid;min-width:112px;box-sizing:border-box;border:1px solid rgba(99,102,241,.2);border-radius:10px;padding:5px;background:rgba(255,255,255,.98);box-shadow:0 10px 28px rgba(15,23,42,.18); }
          .menu button { width:100%;border-radius:7px;text-align:left; }
          @media (prefers-color-scheme: dark) { .launcher{color:#e5e9f0;border-color:#44466d;background:rgba(24,32,47,.95);box-shadow:0 7px 24px rgba(0,0,0,.34)} button{color:#cbc7ff} button:hover,details.more > summary:hover,details.more[open] > summary{background:#292943} button[data-action="start"]{color:#fff;background:linear-gradient(135deg,#6769eb,#8069ee)} button[data-action="dismiss"],details.more > summary{color:#9ca7b8}.menu{border-color:#44466d;background:rgba(24,32,47,.98);box-shadow:0 10px 28px rgba(0,0,0,.38)} }
          @media (max-width:520px) { .launcher{padding:2px} button{min-height:32px}.count,.launcher>button[data-action="scope"],.launcher>button[data-action="dismiss"]{display:none}details.more{display:block} }
        </style>
        <div class="launcher" role="group" aria-label="网页正文翻译">
          <button type="button" data-action="start"><img class="mark" src="${logoUrl}" alt="" aria-hidden="true" />译全文<span class="count"></span></button>
          <button type="button" data-action="scope">范围</button>
          <button type="button" data-action="dismiss" aria-label="暂时隐藏译全文入口" title="暂时隐藏">×</button>
          <details class="more">
            <summary aria-label="更多正文翻译操作" title="更多">•••</summary>
            <div class="menu" role="menu">
              <button type="button" data-action="scope-menu" role="menuitem">调整范围</button>
              <button type="button" data-action="dismiss-menu" role="menuitem">暂时隐藏</button>
            </div>
          </details>
        </div>`;
      shadow.querySelector<HTMLButtonElement>('button[data-action="start"]')
        ?.addEventListener('click', () => {
          destroyLauncher();
          void start(options.preferredTargetLanguage());
        });
      shadow.querySelectorAll<HTMLButtonElement>(
        'button[data-action="scope"],button[data-action="scope-menu"]',
      ).forEach((button) => button.addEventListener('click', () => beginScopePreview()));
      shadow.querySelectorAll<HTMLButtonElement>(
        'button[data-action="dismiss"],button[data-action="dismiss-menu"]',
      ).forEach((button) => button.addEventListener('click', () => {
          launcherDismissedPageIdentity = pageIdentity(options.pageUrl());
          destroyLauncher();
        }));
      document.documentElement.append(launcherHost);
      window.addEventListener('scroll', handleLauncherScroll, true);
      window.addEventListener('resize', handleLauncherViewportChange);
      window.visualViewport?.addEventListener('resize', handleLauncherViewportChange);
    }
    const shadow = launcherHost.shadowRoot;
    const count = shadow?.querySelector<HTMLElement>('.count');
    const startButton = shadow?.querySelector<HTMLButtonElement>('button[data-action="start"]');
    if (count) count.textContent = `· ${launcherCandidateCount} 段`;
    startButton?.setAttribute(
      'aria-label',
      `翻译网页正文，已识别 ${launcherCandidateCount} 段`,
    );
    scheduleLauncherPlacement();
  };

  const discoverLauncher = (): void => {
    if (launcherRefreshTimer !== undefined) window.clearTimeout(launcherRefreshTimer);
    launcherRefreshTimer = undefined;
    if (disposed || !options.launcherEnabled() || options.launcherSuppressed()) {
      destroyLauncher();
      stopLauncherNavigationMonitor();
      return;
    }
    if (currentState.phase !== 'idle' || scopePreviewActive) {
      destroyLauncher();
      stopLauncherNavigationMonitor();
      return;
    }
    ensureLauncherNavigationMonitor();
    const identity = pageIdentity(options.pageUrl());
    if (launcherPageIdentity && launcherPageIdentity !== identity) {
      launcherDismissedPageIdentity = '';
      scopeExcludedElements.clear();
    }
    launcherPageIdentity = identity;
    if (launcherDismissedPageIdentity === identity) {
      destroyLauncher();
      return;
    }
    const selection = articleRoot(options.preferredTargetLanguage(), scopeExcludedElements);
    launcherCandidateCount = launcherCandidate(selection.blocks)
      ? selection.blocks.length
      : 0;
    renderLauncher();
  };

  const scheduleLauncherDiscovery = (delayMs = 650): void => {
    if (launcherRefreshTimer !== undefined) window.clearTimeout(launcherRefreshTimer);
    launcherRefreshTimer = window.setTimeout(discoverLauncher, delayMs);
  };

  const refreshDiscovery = (): void => scheduleLauncherDiscovery();

  const removeScopePreviewPresentation = (): void => {
    document.removeEventListener('click', handleScopePreviewClick, true);
    document.removeEventListener('keydown', handleScopePreviewKeydown, true);
    for (const block of scopePreviewBlocks) {
      block.element.removeAttribute(SCOPE_PREVIEW_ATTRIBUTE);
    }
    document.getElementById(SCOPE_STYLE_ID)?.remove();
  };

  const scopeSelectedCount = (): number => scopePreviewBlocks.filter(
    (block) => !scopeDraftExcludedElements.has(block.element),
  ).length;

  const scopeTranslatedRemovalCount = (): number => scopePreviewBlocks.filter(
    (candidate) =>
      scopeDraftExcludedElements.has(candidate.element) &&
      blocks.some((block) => block.element === candidate.element && block.status === 'done'),
  ).length;

  const renderScopePreviewBlocks = (): void => {
    for (const block of scopePreviewBlocks) {
      block.element.setAttribute(
        SCOPE_PREVIEW_ATTRIBUTE,
        scopeDraftExcludedElements.has(block.element) ? 'excluded' : 'included',
      );
    }
  };

  function handleScopePreviewClick(event: MouseEvent): void {
    if (!scopePreviewActive || !(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>(`[${SCOPE_PREVIEW_ATTRIBUTE}]`);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (scopeDraftExcludedElements.has(element)) scopeDraftExcludedElements.delete(element);
    else scopeDraftExcludedElements.add(element);
    renderScopePreviewBlocks();
    renderControl();
  }

  function handleScopePreviewKeydown(event: KeyboardEvent): void {
    if (!scopePreviewActive || event.key !== 'Escape') return;
    event.preventDefault();
    finishScopePreview(true);
  }

  const installScopePreviewStyle = (): void => {
    document.getElementById(SCOPE_STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = SCOPE_STYLE_ID;
    style.textContent = `
      [${SCOPE_PREVIEW_ATTRIBUTE}] {
        outline: 2px solid rgba(91, 82, 214, .48) !important;
        outline-offset: 3px !important;
        border-radius: 3px !important;
        cursor: pointer !important;
        transition: outline-color .14s ease, background-color .14s ease !important;
      }
      [${SCOPE_PREVIEW_ATTRIBUTE}="included"]:hover {
        outline-color: rgba(79, 70, 229, .86) !important;
        background-color: rgba(99, 102, 241, .055) !important;
      }
      [${SCOPE_PREVIEW_ATTRIBUTE}="excluded"] {
        outline-style: dashed !important;
        outline-color: rgba(120, 128, 145, .62) !important;
        background-color: rgba(148, 163, 184, .09) !important;
      }
    `;
    document.documentElement.append(style);
  };

  const beginScopePreview = (): void => {
    if (disposed || scopePreviewActive || currentState.pauseReason === 'interactive') return;
    const targetLanguage = isSupportedTargetLanguage(currentState.targetLanguage)
      ? currentState.targetLanguage
      : options.preferredTargetLanguage();
    const selection = articleContainer?.isConnected
      ? {
          root: articleContainer,
          blocks: candidateElements(articleContainer, targetLanguage),
        }
      : articleRoot(targetLanguage);
    if (!selection.blocks.length) return;
    assignSessionSignatures(selection.blocks);
    scopePreviewBlocks = selection.blocks;
    scopeDraftExcludedElements = new Set(
      selection.blocks
        .map((block) => block.element)
        .filter((element, index) => (
          scopeExcludedElements.has(element) ||
          sessionExcludedSignatures.has(selection.blocks[index]?.sessionSignature ?? '')
        )),
    );
    resumeAfterScopePreview = currentState.phase === 'running';
    scopePreviewActive = true;
    if (resumeAfterScopePreview) {
      currentState = {
        ...currentState,
        phase: 'paused',
        pauseReason: 'user',
        message: '正在调整正文范围。',
      };
    }
    destroyLauncher();
    stopLauncherNavigationMonitor();
    installScopePreviewStyle();
    renderScopePreviewBlocks();
    document.addEventListener('click', handleScopePreviewClick, true);
    document.addEventListener('keydown', handleScopePreviewKeydown, true);
    publish();
  };

  const finishScopePreview = (resumePreviousState: boolean): void => {
    if (!scopePreviewActive) return;
    removeScopePreviewPresentation();
    scopePreviewActive = false;
    scopePreviewBlocks = [];
    scopeDraftExcludedElements = new Set();
    const shouldResume = resumePreviousState && resumeAfterScopePreview;
    resumeAfterScopePreview = false;
    if (
      shouldResume &&
      currentState.phase === 'paused' &&
      currentState.pauseReason === 'user'
    ) {
      resume(false);
      return;
    }
    if (currentState.phase === 'idle') {
      destroyControl();
      scheduleLauncherDiscovery(0);
    } else publish();
  };

  const applyScopePreview = (): void => {
    if (!scopePreviewActive || scopeSelectedCount() === 0) return;
    scopeExcludedElements.clear();
    sessionExcludedSignatures.clear();
    for (const element of scopeDraftExcludedElements) scopeExcludedElements.add(element);
    for (const block of scopePreviewBlocks) {
      if (
        scopeDraftExcludedElements.has(block.element) &&
        block.sessionSignature
      ) sessionExcludedSignatures.add(block.sessionSignature);
    }
    const shouldStart = currentState.phase === 'idle';
    if (!shouldStart && articleContainer?.isConnected && currentState.targetLanguage) {
      const activeBlock = blocks.find((block) => block.status === 'translating');
      if (activeBlock && scopeExcludedElements.has(activeBlock.element)) cancelActiveRequest();
      reconcileDynamicBlocks(
        candidateElements(
          articleContainer,
          currentState.targetLanguage,
          scopeExcludedElements,
        ),
        articleContainer,
      );
    }
    finishScopePreview(!shouldStart);
    scheduleSessionStatePersistence();
    if (shouldStart) void start(options.preferredTargetLanguage());
  };

  const clear = (notify = true): void => {
    if (scopePreviewActive) {
      removeScopePreviewPresentation();
      scopePreviewActive = false;
      resumeAfterScopePreview = false;
      scopePreviewBlocks = [];
      scopeDraftExcludedElements = new Set();
    }
    taskRevision += 1;
    cancelActiveRequest();
    removeInjectedContent();
    if (navigationTimer !== undefined) window.clearInterval(navigationTimer);
    navigationTimer = undefined;
    if (sessionPersistenceTimer !== undefined) window.clearTimeout(sessionPersistenceTimer);
    sessionPersistenceTimer = undefined;
    activeSessionDescriptor = undefined;
    sessionDocumentSignatures = [];
    sessionExcludedSignatures.clear();
    sourcePageIdentity = '';
    consecutiveIsolatedFailures = 0;
    interactiveSuspensions.clear();
    interactionPreemptedRequestIds.clear();
    resumeAfterInteractive = false;
    pendingLanguageSwitch = undefined;
    currentState = { ...EMPTY_BILINGUAL_PAGE_STATE };
    destroyControl();
    destroyLauncher();
    stopLauncherNavigationMonitor();
    if (notify) {
      options.onStateChange(snapshot());
      scheduleLauncherDiscovery();
    }
  };

  const resetForArticleChange = (message = ARTICLE_CHANGED_MESSAGE): void => {
    const targetLanguage = currentState.targetLanguage;
    clear(false);
    scopeExcludedElements.clear();
    launcherDismissedPageIdentity = '';
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

  persistSessionBlock = async (block: BilingualBlock): Promise<void> => {
    const translatedText = translationText(block);
    if (!block.sessionSignature || !translatedText) return;
    if (sessionPersistenceTimer !== undefined) window.clearTimeout(sessionPersistenceTimer);
    sessionPersistenceTimer = undefined;
    const update = sessionUpdate({
      signature: block.sessionSignature,
      translatedText,
      hidden: block.translation?.hasAttribute(TRANSLATION_HIDDEN_ATTRIBUTE) ?? false,
    });
    if (update) await enqueueSessionWrite(update);
  };

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
    void persistSessionBlock(block);
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
    if (currentState.phase === 'idle' && !scopePreviewActive) {
      destroyControl();
      return;
    }
    destroyLauncher();
    if (!controlHost?.isConnected) {
      controlHost = document.createElement('div');
      controlHost.id = CONTROL_HOST_ID;
      controlHost.style.cssText = 'all:initial;position:fixed;z-index:2147483645;right:16px;bottom:16px;';
      const shadow = controlHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { color-scheme: light dark; }
          .bar { display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:min(560px,calc(100vw - 32px));min-height:38px;box-sizing:border-box;border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:6px 7px 6px 10px;color:#253047;background:rgba(255,255,255,.96);box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px/1.3 Inter,"Segoe UI","Microsoft YaHei",sans-serif;backdrop-filter:blur(12px);}
          .mark { flex:0 0 auto;width:16px;height:14px;object-fit:contain; }
          output { min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
          .language { display:inline-flex;flex:0 0 auto;align-items:center;gap:3px;color:#657084;font-size:10.5px;white-space:nowrap; }
          select { min-height:28px;box-sizing:border-box;border:1px solid rgba(99,102,241,.18);border-radius:6px;padding:3px 22px 3px 6px;color:#4f46e5;background:#f7f7ff;cursor:pointer;font:600 11px/1.2 inherit; }
          select:disabled { opacity:.62;cursor:default; }
          button { min-width:32px;min-height:28px;border:0;border-radius:6px;padding:4px 7px;color:#4f46e5;background:#f0efff;cursor:pointer;font:600 11px/1.2 inherit;white-space:nowrap; }
          button:hover { background:#e4e2ff; }
          button:disabled { opacity:.62;cursor:default; }
          button[data-action="clear"] { color:#657084;background:transparent; }
          .language-confirmation { display:flex;flex:1 0 100%;align-items:center;gap:6px;border-top:1px solid rgba(99,102,241,.16);padding-top:6px;color:#566176; }
          .language-confirmation[hidden] { display:none; }
          .language-confirmation span { min-width:0;flex:1 1 auto;line-height:1.45; }
          .language-confirmation button[data-action="cancel-language"] { color:#657084;background:transparent; }
          .scope-panel { display:flex;flex:1 0 100%;align-items:center;justify-content:flex-end;gap:6px;border-top:1px solid rgba(99,102,241,.16);padding-top:6px;color:#566176; }
          .scope-panel[hidden] { display:none; }
          .scope-panel span { min-width:0;flex:1 1 auto;line-height:1.45; }
          .scope-panel button[data-action="reset-scope"],.scope-panel button[data-action="cancel-scope"] { color:#657084;background:transparent; }
          @media (prefers-color-scheme: dark) { .bar{color:#edf1f7;border-color:#4b4d7d;background:rgba(24,32,47,.96);box-shadow:0 8px 28px rgba(0,0,0,.36)} .mark{filter:brightness(0) invert(1)} .language{color:#aab3c2} select{color:#cbc7ff;border-color:#44466d;background:#222a3a} button{color:#cbc7ff;background:#292943} button:hover{background:#363653} button[data-action="clear"],.language-confirmation button[data-action="cancel-language"],.scope-panel button[data-action="reset-scope"],.scope-panel button[data-action="cancel-scope"]{color:#aab3c2;background:transparent}.language-confirmation,.scope-panel{color:#cbd2dd;border-top-color:#3b4352} }
          @media (max-width:480px) { .bar{gap:5px;padding-left:8px} .mark{display:none} button{padding-inline:6px}.language>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)} }
        </style>
        <div class="bar" role="status" aria-live="polite">
          <img class="mark" src="${logoUrl}" alt="" aria-hidden="true" />
          <output></output>
          <label class="language"><span>译为</span><select data-action="language" aria-label="正文目标语言">${SUPPORTED_TARGET_LANGUAGES.map((language) => `<option value="${language.value}">${language.shortLabel}</option>`).join('')}</select></label>
          <button type="button" data-action="visibility"></button>
          <button type="button" data-action="pause"></button>
          <button type="button" data-action="stop">停止</button>
          <button type="button" data-action="scope">范围</button>
          <button type="button" data-action="clear">清除</button>
          <div class="language-confirmation" role="alert" hidden>
            <span></span>
            <button type="button" data-action="cancel-language">取消</button>
            <button type="button" data-action="confirm-language">清除并改译</button>
          </div>
          <div class="scope-panel" hidden>
            <span></span>
            <button type="button" data-action="reset-scope">全部恢复</button>
            <button type="button" data-action="cancel-scope">取消</button>
            <button type="button" data-action="apply-scope">应用范围</button>
          </div>
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
          } else if (action === 'scope') {
            beginScopePreview();
          } else if (action === 'reset-scope') {
            scopeDraftExcludedElements.clear();
            renderScopePreviewBlocks();
            renderControl();
          } else if (action === 'cancel-scope') {
            finishScopePreview(true);
          } else if (action === 'apply-scope') {
            applyScopePreview();
          } else if (action === 'cancel-language') {
            pendingLanguageSwitch = undefined;
            renderControl();
          } else if (action === 'confirm-language' && pendingLanguageSwitch) {
            const requestedLanguage = pendingLanguageSwitch;
            pendingLanguageSwitch = undefined;
            void start(requestedLanguage);
          }
        });
      });
      shadow.querySelector<HTMLSelectElement>('select[data-action="language"]')
        ?.addEventListener('change', (event) => {
          const select = event.currentTarget as HTMLSelectElement;
          const requestedLanguage = select.value;
          const currentLanguage = currentState.targetLanguage;
          if (
            !isSupportedTargetLanguage(requestedLanguage) ||
            !isSupportedTargetLanguage(currentLanguage) ||
            requestedLanguage === currentLanguage
          ) return;
          select.value = currentLanguage;
          if (bilingualPageLanguageSwitchConfirmation(currentState, requestedLanguage)) {
            pendingLanguageSwitch = requestedLanguage;
            renderControl();
          } else {
            pendingLanguageSwitch = undefined;
            void start(requestedLanguage);
          }
        });
      document.documentElement.append(controlHost);
    }
    const shadow = controlHost.shadowRoot;
    const output = shadow?.querySelector<HTMLOutputElement>('output');
    const visibility = shadow?.querySelector<HTMLButtonElement>('[data-action="visibility"]');
    const pause = shadow?.querySelector<HTMLButtonElement>('[data-action="pause"]');
    const stop = shadow?.querySelector<HTMLButtonElement>('[data-action="stop"]');
    const scope = shadow?.querySelector<HTMLButtonElement>('[data-action="scope"]');
    const clearButton = shadow?.querySelector<HTMLButtonElement>('[data-action="clear"]');
    const language = shadow?.querySelector<HTMLSelectElement>('[data-action="language"]');
    const languageControl = shadow?.querySelector<HTMLElement>('.language');
    const languageConfirmation = shadow?.querySelector<HTMLElement>('.language-confirmation');
    const scopePanel = shadow?.querySelector<HTMLElement>('.scope-panel');
    if (scopePreviewActive) {
      const selected = scopeSelectedCount();
      const translatedRemoval = scopeTranslatedRemovalCount();
      if (output) {
        output.textContent = `正文范围 ${selected}/${scopePreviewBlocks.length} 段 · 点击正文排除或恢复`;
      }
      if (languageControl) languageControl.hidden = true;
      if (visibility) visibility.hidden = true;
      if (pause) pause.hidden = true;
      if (stop) stop.hidden = true;
      if (scope) scope.hidden = true;
      if (clearButton) clearButton.hidden = true;
      if (languageConfirmation) languageConfirmation.hidden = true;
      if (scopePanel) {
        scopePanel.hidden = false;
        const message = scopePanel.querySelector('span');
        if (message) {
          message.textContent = translatedRemoval
            ? `将清除已译 ${translatedRemoval} 段；不会重译其余内容。`
            : '紫色为保留，灰色虚线为排除；预览不会调用接口。';
        }
        const reset = scopePanel.querySelector<HTMLButtonElement>('[data-action="reset-scope"]');
        const apply = scopePanel.querySelector<HTMLButtonElement>('[data-action="apply-scope"]');
        if (reset) reset.disabled = scopeDraftExcludedElements.size === 0;
        if (apply) {
          apply.disabled = selected === 0;
          apply.textContent = currentState.phase === 'idle'
            ? '按此范围翻译'
            : translatedRemoval
              ? `清除 ${translatedRemoval} 段并应用`
              : '应用范围';
        }
      }
      return;
    }
    if (languageControl) languageControl.hidden = false;
    if (scopePanel) scopePanel.hidden = true;
    if (scope) {
      scope.hidden = currentState.total === 0;
      scope.disabled = currentState.pauseReason === 'interactive';
      scope.textContent = currentState.total ? `范围 ${currentState.total}` : '范围';
      scope.title = '查看并调整当前正文范围';
    }
    if (clearButton) clearButton.hidden = false;
    if (output) {
      const restoredPrefix = currentState.restored
        ? `已恢复 ${currentState.restored} 段 · `
        : '';
      output.textContent = restoredPrefix + (currentState.phase === 'error'
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
              : `双语正文 ${currentState.translated}/${currentState.total}${currentState.failed ? ` · ${currentState.failed} 段待重试` : ''} · 滚动继续`);
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
    if (language && isSupportedTargetLanguage(currentState.targetLanguage)) {
      language.value = currentState.targetLanguage;
      language.disabled = currentState.pauseReason === 'interactive';
    }
    if (languageConfirmation) {
      const confirmation = pendingLanguageSwitch
        ? bilingualPageLanguageSwitchConfirmation(currentState, pendingLanguageSwitch)
        : undefined;
      languageConfirmation.hidden = !confirmation;
      const message = languageConfirmation.querySelector('span');
      if (message) message.textContent = confirmation ?? '';
      languageConfirmation.querySelectorAll<HTMLButtonElement>('button')
        .forEach((button) => { button.disabled = currentState.pauseReason === 'interactive'; });
      if (!confirmation) pendingLanguageSwitch = undefined;
    }
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
      `[${TRANSLATION_ATTRIBUTE}], [${TRANSLATION_PENDING_ATTRIBUTE}], [${ERROR_ATTRIBUTE}], #${CONTROL_HOST_ID}, #${LAUNCHER_HOST_ID}`,
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
          delete block.restoredFromSession;
          block.text = candidate.text;
          block.status = 'idle';
          newWork = true;
        }
        if (candidate.sessionSignature) block.sessionSignature = candidate.sessionSignature;
        else delete block.sessionSignature;
      } else {
        const reusable = disconnectedBySignature.get(blockSignature(candidate));
        block = reusable?.find((item) => !used.has(item));
        if (block) {
          observer?.unobserve(block.element);
          block.element = candidate.element;
          if (candidate.sessionSignature) block.sessionSignature = candidate.sessionSignature;
          else delete block.sessionSignature;
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
    assignSessionSignatures(selection.blocks);
    sessionDocumentSignatures = selection.blocks
      .map((block) => block.sessionSignature)
      .filter((signature): signature is string => Boolean(signature));
    scopeExcludedElements.clear();
    for (const block of selection.blocks) {
      if (
        block.sessionSignature &&
        sessionExcludedSignatures.has(block.sessionSignature)
      ) scopeExcludedElements.add(block.element);
    }
    reconcileDynamicBlocks(
      selection.blocks.filter((block) => !scopeExcludedElements.has(block.element)),
      selection.root,
    );
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
      delete block.restoredFromSession;
      consecutiveIsolatedFailures = 0;
      if (!replacingTranslation && !currentState.translationsHidden) {
        void revealTranslationActionsHint(block);
      }
      if (restorePageStateAfterRetranslation(block)) {
        void persistSessionBlock(block);
        return;
      }
      if (!settleCompletedState()) publish();
      void persistSessionBlock(block);
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

  const begin = async (
    targetLanguage: SupportedTargetLanguage,
    requireStoredSession: boolean,
  ): Promise<BilingualPageState | undefined> => {
    if (disposed) return snapshot();
    destroyLauncher();
    stopLauncherNavigationMonitor();
    pendingLanguageSwitch = undefined;
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
      await discardSession();
      clear(false);
    }
    const selection = articleRoot(targetLanguage);
    assignSessionSignatures(selection.blocks);
    const descriptor = sessionDescriptor(targetLanguage);
    let stored = await readSession(descriptor);
    if (disposed) return snapshot();
    const documentSignatures = selection.blocks
      .map((block) => block.sessionSignature)
      .filter((signature): signature is string => Boolean(signature));
    if (stored && !bilingualPageSessionMatchesDocument(
      stored.documentSignatures,
      documentSignatures,
    )) {
      await discardSession(descriptor);
      stored = undefined;
    }
    if (requireStoredSession && !stored) return undefined;

    const selectedScopeSignatures = new Set(
      selection.blocks
        .filter((block) => scopeExcludedElements.has(block.element))
        .map((block) => block.sessionSignature)
        .filter((signature): signature is string => Boolean(signature)),
    );
    activeSessionDescriptor = descriptor;
    sessionDocumentSignatures = documentSignatures;
    sessionExcludedSignatures = new Set(
      stored?.excludedSignatures ?? selectedScopeSignatures,
    );
    scopeExcludedElements.clear();
    for (const block of selection.blocks) {
      if (
        block.sessionSignature &&
        sessionExcludedSignatures.has(block.sessionSignature)
      ) scopeExcludedElements.add(block.element);
    }
    blocks = selection.blocks.filter((block) => !scopeExcludedElements.has(block.element));
    articleContainer = selection.root;
    sourcePageIdentity = pageIdentity(options.pageUrl());
    currentState = {
      phase: blocks.length ? 'running' : 'error',
      total: blocks.length,
      translated: 0,
      failed: 0,
      translationsHidden: stored?.translationsHidden ?? false,
      targetLanguage,
      ...(!blocks.length ? { message: '当前页面没有识别到适合双语阅读的正文。' } : {}),
    };
    if (stored) {
      const storedBlocks = new Map(stored.blocks.map((block) => [block.signature, block]));
      for (const block of blocks) {
        const restored = block.sessionSignature
          ? storedBlocks.get(block.sessionSignature)
          : undefined;
        if (!restored) continue;
        const translation = translationElement(
          block,
          restored.translatedText,
          targetLanguage,
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
        if (restored.hidden) setTranslationHidden(block, true);
        block.status = 'done';
        block.restoredFromSession = true;
      }
      syncCounts();
      if (stored.activity === 'paused') {
        currentState.phase = 'paused';
        currentState.pauseReason = 'user';
        currentState.message = '已恢复上次暂停的正文翻译。';
      } else if (stored.activity === 'stopped') {
        currentState.phase = 'stopped';
        currentState.message = '已恢复上次停止时的正文译文。';
      } else if (currentState.translated === currentState.total) {
        currentState.phase = 'complete';
      }
    }
    publish();
    if (!blocks.length) return snapshot();
    installTranslationStyle();
    taskRevision += 1;
    observeBlocks();
    observeArticleMutations();
    if (currentState.phase === 'running') {
      blocks.filter(eligibleForViewport).forEach((block) => enqueue(block));
      const firstPendingBlock = blocks.find((block) => block.status === 'idle');
      if (!queue.length && firstPendingBlock) enqueue(firstPendingBlock);
    }
    navigationTimer = window.setInterval(() => {
      if (pageIdentity(options.pageUrl()) !== sourcePageIdentity) {
        resetForArticleChange('页面已切换，请重新开始正文翻译。');
        return;
      }
      if (!articleContainer?.isConnected) scheduleDynamicScan(0);
    }, 750);
    void persistSessionState();
    if (currentState.phase === 'running') void processQueue();
    return snapshot();
  };

  const start = async (targetLanguage: SupportedTargetLanguage): Promise<BilingualPageState> =>
    await begin(targetLanguage, false) ?? snapshot();

  const restoreSession = async (): Promise<BilingualPageState | undefined> => {
    if (disposed || currentState.phase !== 'idle') return undefined;
    return begin(options.preferredTargetLanguage(), true);
  };

  const control = async (action: BilingualPageAction): Promise<BilingualPageState> => {
    if (action === 'clear') {
      await discardSession();
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
    restoreSession,
    control,
    refreshDiscovery,
    suspendForInteractiveTranslation,
    resumeAfterInteractiveTranslation,
    state: snapshot,
    dispose: () => {
      if (disposed) return;
      if (launcherRefreshTimer !== undefined) window.clearTimeout(launcherRefreshTimer);
      launcherRefreshTimer = undefined;
      void persistSessionState();
      clear(false);
      scopeExcludedElements.clear();
      stopLauncherNavigationMonitor();
      disposed = true;
    },
  };
}
