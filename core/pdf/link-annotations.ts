export type PdfLinkDestination = string | unknown[];

export type SafePdfLinkAction =
  | { kind: 'external'; url: string }
  | { kind: 'destination'; destination: PdfLinkDestination }
  | { kind: 'named'; action: SafePdfNamedAction };

export interface SafePdfLinkAnnotation {
  id: string;
  rect: [number, number, number, number];
  action: SafePdfLinkAction;
}

export type SafePdfNamedAction = 'FirstPage' | 'LastPage' | 'NextPage' | 'PrevPage';

const SAFE_NAMED_ACTIONS = new Set<SafePdfNamedAction>([
  'FirstPage',
  'LastPage',
  'NextPage',
  'PrevPage',
]);

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedRect(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finiteNumber)) return undefined;
  const [x1, y1, x2, y2] = value as [number, number, number, number];
  if (x1 === x2 || y1 === y2) return undefined;
  return [x1, y1, x2, y2];
}

export function safePdfExternalUrl(
  value: unknown,
  sourceUrl?: string,
): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) return undefined;
  try {
    const base = sourceUrl && /^https?:/iu.test(sourceUrl) ? sourceUrl : undefined;
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function normalizedDestination(value: unknown): PdfLinkDestination | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  return Array.isArray(value) && value.length ? value : undefined;
}

export function safePdfLinkAnnotation(
  value: unknown,
  linkAnnotationType: number,
  sourceUrl?: string,
): SafePdfLinkAnnotation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const annotation = value as Record<string, unknown>;
  if (annotation.annotationType !== linkAnnotationType) return undefined;
  const rect = normalizedRect(annotation.rect);
  if (!rect) return undefined;

  const rawExternalUrl = typeof annotation.url === 'string' && annotation.url
    ? annotation.url
    : annotation.unsafeUrl;
  if (rawExternalUrl !== undefined) {
    // PDF.js also exposes Launch/GoToR file targets through `unsafeUrl` after
    // recovering a guessed absolute URL. Only an explicitly authored HTTP(S)
    // target is accepted here, so a local filename cannot turn into a link.
    if (
      typeof annotation.unsafeUrl === 'string' &&
      !/^https?:\/\//iu.test(annotation.unsafeUrl.trim())
    ) return undefined;
    const url = safePdfExternalUrl(rawExternalUrl, sourceUrl);
    if (!url) return undefined;
    return {
      id: typeof annotation.id === 'string' ? annotation.id.slice(0, 160) : crypto.randomUUID(),
      rect,
      action: { kind: 'external', url },
    };
  }

  const destination = normalizedDestination(annotation.dest);
  if (destination) {
    return {
      id: typeof annotation.id === 'string' ? annotation.id.slice(0, 160) : crypto.randomUUID(),
      rect,
      action: { kind: 'destination', destination },
    };
  }

  const namedAction = annotation.action;
  if (typeof namedAction !== 'string' || !SAFE_NAMED_ACTIONS.has(namedAction as SafePdfNamedAction)) {
    return undefined;
  }
  return {
    id: typeof annotation.id === 'string' ? annotation.id.slice(0, 160) : crypto.randomUUID(),
    rect,
    action: { kind: 'named', action: namedAction as SafePdfNamedAction },
  };
}

export function safePdfLinkAnnotations(
  annotations: readonly unknown[],
  linkAnnotationType: number,
  sourceUrl?: string,
  limit = 500,
): SafePdfLinkAnnotation[] {
  const safeLimit = Math.max(1, Math.round(limit));
  const links: SafePdfLinkAnnotation[] = [];
  for (const annotation of annotations) {
    const link = safePdfLinkAnnotation(annotation, linkAnnotationType, sourceUrl);
    if (link) links.push(link);
    if (links.length >= safeLimit) break;
  }
  return links;
}

export function pdfDestinationTopCoordinate(destination: readonly unknown[]): number | undefined {
  const mode = destination[1];
  const name = mode && typeof mode === 'object' && 'name' in mode
    ? (mode as { name?: unknown }).name
    : undefined;
  const candidate = name === 'XYZ'
    ? destination[3]
    : ['FitH', 'FitBH'].includes(String(name))
      ? destination[2]
      : name === 'FitR'
        ? destination[5]
        : undefined;
  return finiteNumber(candidate) ? candidate : undefined;
}
