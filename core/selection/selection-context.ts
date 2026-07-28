import type { ContextMode } from '../settings/schema';

const MAX_CONTEXT_LENGTH = 2_000;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function sentenceContext(text: string, selection: string): string | undefined {
  const normalizedText = compact(text);
  const normalizedSelection = compact(selection);
  const index = normalizedText.indexOf(normalizedSelection);
  if (index < 0) return undefined;
  const boundaries = /(?:[。！？!?]|\.(?=\s|$))\s*/g;
  let start = 0;
  let end = normalizedText.length;
  let match: RegExpExecArray | null;
  while ((match = boundaries.exec(normalizedText))) {
    const boundaryEnd = match.index + match[0].length;
    if (boundaryEnd <= index) start = boundaryEnd;
    else {
      end = boundaryEnd;
      break;
    }
  }
  return normalizedText.slice(start, end).trim().slice(0, MAX_CONTEXT_LENGTH) || undefined;
}

export function selectionContext(
  anchor: Element | null | undefined,
  selection: string,
  mode: ContextMode,
): string | undefined {
  if (mode === 'off' || !anchor) return undefined;
  const block = anchor.closest('p,li,blockquote,figcaption,td,th,[role="paragraph"]') ?? anchor;
  const paragraph = compact(block.textContent ?? '');
  if (!paragraph || paragraph === compact(selection)) return undefined;
  const context = mode === 'sentence' ? sentenceContext(paragraph, selection) : paragraph;
  return context?.slice(0, MAX_CONTEXT_LENGTH);
}

export function isSensitiveTextControl(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  const autocomplete = element.autocomplete.toLocaleLowerCase();
  const name = `${element.name} ${element.id}`.toLocaleLowerCase();
  return (
    element instanceof HTMLInputElement && element.type === 'password'
  ) || /(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(autocomplete) ||
    /(?:password|passwd|credit.?card|card.?number|security.?code|cvv|cvc|otp|验证码)/.test(name) ||
    Boolean(element.closest('[data-private="true"],[data-sensitive="true"]'));
}
