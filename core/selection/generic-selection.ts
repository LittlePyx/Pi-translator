import type { SelectionSnapshot, SelectionSource, ViewportRect } from './types';

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

function createSnapshot(
  sourceText: string,
  source: SelectionSource,
  rect?: ViewportRect,
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
  return createSnapshot(
    active.value.slice(start, end),
    'text-control',
    toViewportRect(active.getBoundingClientRect()),
  );
}

function captureWindowSelection(): SelectionSnapshot | undefined {
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

  return createSnapshot(selection.toString(), source, toViewportRect(rect));
}

export function captureSelectionSnapshot(): SelectionSnapshot | undefined {
  return captureTextControl() ?? captureWindowSelection();
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
