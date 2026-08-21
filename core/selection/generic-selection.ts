import type {
  PassiveSelectionEnvironment,
  SelectionSnapshot,
  SelectionSource,
  ViewportRect,
} from './types';
import type { ContextMode } from '../settings/schema';
import { isSensitiveTextControl, selectionContext } from './selection-context';

function createRequestId(): string {
  return crypto.randomUUID();
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function toViewportRect(rect: DOMRect): ViewportRect | undefined {
  if (![rect.top, rect.left, rect.right, rect.bottom].every(Number.isFinite)) {
    return undefined;
  }
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
  };
}

const RENDERED_MATH_SELECTOR = [
  '.katex',
  'mjx-container',
  'math',
  '[data-tex]',
  '[data-latex]',
  'script[type^="math/tex"]',
].join(',');

const TERMINAL_SURFACE_SELECTOR = [
  '[role="terminal"]',
  '[data-terminal]',
  '.xterm',
  '.xterm-screen',
  '.terminal',
  '.terminal-view',
  '.terminal-output',
].join(',');

const CODE_SURFACE_SELECTOR = [
  'pre',
  'code',
  'samp',
  '[role="code"]',
  '[data-code-editor]',
  '.monaco-editor',
  '.view-lines',
  '.CodeMirror',
  '.cm-editor',
  '.cm-content',
  '.ace_editor',
  '.ace_content',
  '.blob-code',
  '.code-line',
].join(',');

function nodeElement(node: Node | null): Element | undefined {
  return node instanceof Element ? node : node?.parentElement ?? undefined;
}

function closestAcrossShadowRoots(element: Element | undefined, selector: string): Element | undefined {
  let current = element;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : undefined;
  }
  return undefined;
}

function passiveSelectionEnvironmentForElement(
  element: Element | undefined,
): PassiveSelectionEnvironment | undefined {
  if (closestAcrossShadowRoots(element, TERMINAL_SURFACE_SELECTOR)) return 'terminal';
  if (closestAcrossShadowRoots(element, CODE_SURFACE_SELECTOR)) return 'code';
  return undefined;
}

function passiveSelectionEnvironmentForRange(range: Range): PassiveSelectionEnvironment | undefined {
  const start = passiveSelectionEnvironmentForElement(nodeElement(range.startContainer));
  const end = passiveSelectionEnvironmentForElement(nodeElement(range.endContainer));
  if (start && start === end) return start;
  const common = passiveSelectionEnvironmentForElement(nodeElement(range.commonAncestorContainer));
  return common && (!start || start === common) && (!end || end === common) ? common : undefined;
}

function renderedMathLatex(element: Element): string | undefined {
  const annotation = element.matches('annotation[encoding*="tex" i]')
    ? element
    : element.querySelector('annotation[encoding*="tex" i]');
  const candidate =
    element.getAttribute('data-tex') ??
    element.getAttribute('data-latex') ??
    element.getAttribute('alttext') ??
    (element.matches('script[type^="math/tex"]') ? element.textContent : undefined) ??
    annotation?.textContent;
  const latex = candidate?.trim();
  return latex || undefined;
}

function selectionTextWithMathSource(range: Range, fallback: string): string {
  const fragment = range.cloneContents();
  const candidates = [...fragment.querySelectorAll(RENDERED_MATH_SELECTOR)].filter(
    (element) => !element.parentElement?.closest(RENDERED_MATH_SELECTOR),
  );
  let replaced = false;
  for (const element of candidates) {
    const latex = renderedMathLatex(element);
    if (!latex) continue;
    const alreadyDelimited = /^(?:\$|\\\(|\\\[)/u.test(latex);
    const display = element.classList.contains('katex-display') ||
      element.getAttribute('display') === 'block';
    element.replaceWith(document.createTextNode(
      alreadyDelimited ? latex : display ? `\\[${latex}\\]` : `$${latex}$`,
    ));
    replaced = true;
  }
  return replaced ? fragment.textContent?.trim() || fallback : fallback;
}

function createSnapshot(
  sourceText: string,
  source: SelectionSource,
  rect?: ViewportRect,
  metadata?: Pick<
    SelectionSnapshot,
    'contextText' | 'sensitiveField' | 'passiveSelectionEnvironment'
  >,
): SelectionSnapshot | undefined {
  const normalizedText = sourceText.trim();
  if (!normalizedText) {
    return undefined;
  }
  return {
    requestId: createRequestId(),
    sourceText,
    normalizedText,
    source,
    pageUrl: location.href,
    capturedAt: Date.now(),
    selectionHash: hashText(normalizedText),
    ...(metadata?.contextText ? { contextText: metadata.contextText } : {}),
    ...(metadata?.sensitiveField ? { sensitiveField: true } : {}),
    ...(metadata?.passiveSelectionEnvironment
      ? { passiveSelectionEnvironment: metadata.passiveSelectionEnvironment }
      : {}),
    ...(rect ? { rect } : {}),
  };
}

function captureTextControl(): SelectionSnapshot | undefined {
  const active = document.activeElement;
  const isTextArea = active instanceof HTMLTextAreaElement;
  const isTextInput =
    active instanceof HTMLInputElement &&
    ['text', 'search', 'url', 'email', 'tel'].includes(active.type);
  if (!isTextArea && !isTextInput) {
    return undefined;
  }

  const start = active.selectionStart;
  const end = active.selectionEnd;
  if (start === null || end === null || start === end) {
    return undefined;
  }
  const passiveSelectionEnvironment = passiveSelectionEnvironmentForElement(active);
  return createSnapshot(
    active.value.slice(start, end),
    'text-control',
    toViewportRect(active.getBoundingClientRect()),
    {
      sensitiveField: isSensitiveTextControl(active),
      ...(passiveSelectionEnvironment ? { passiveSelectionEnvironment } : {}),
    },
  );
}

function captureWindowSelection(contextMode: ContextMode): SelectionSnapshot | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    rect = rects.item(rects.length - 1) ?? rect;
  }
  const anchorElement =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
  const source: SelectionSource = anchorElement?.closest('[contenteditable="true"]')
    ? 'contenteditable'
    : 'window-selection';

  const selectedText = selectionTextWithMathSource(range, selection.toString());
  const contextText = selectionContext(anchorElement, selectedText, contextMode);
  const passiveSelectionEnvironment = passiveSelectionEnvironmentForRange(range);
  return createSnapshot(selectedText, source, toViewportRect(rect), {
    ...(contextText ? { contextText } : {}),
    ...(passiveSelectionEnvironment ? { passiveSelectionEnvironment } : {}),
    sensitiveField: Boolean(
      anchorElement?.closest('[data-private="true"],[data-sensitive="true"],input[type="password"]'),
    ),
  });
}

export function captureSelectionSnapshot(contextMode: ContextMode = 'off'): SelectionSnapshot | undefined {
  return captureTextControl() ?? captureWindowSelection(contextMode);
}

export function createContextMenuSnapshot(
  text: string,
  pageUrl: string,
): SelectionSnapshot {
  const normalizedText = text.trim();
  return {
    requestId: createRequestId(),
    sourceText: text,
    normalizedText,
    source: 'context-menu',
    pageUrl,
    capturedAt: Date.now(),
    selectionHash: hashText(normalizedText),
  };
}
