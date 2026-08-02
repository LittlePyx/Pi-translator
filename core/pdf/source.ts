const REMOTE_PDF_PROTOCOLS = new Set(['http:', 'https:']);
const LOADABLE_PDF_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const EDGE_PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

export function parseRemotePdfUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return REMOTE_PDF_PROTOCOLS.has(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function parsePdfSourceUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return LOADABLE_PDF_PROTOCOLS.has(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function isLikelyPdfUrl(value: string | undefined): boolean {
  const url = parseRemotePdfUrl(value);
  if (!url) return false;
  const candidates = [url.pathname, ...url.searchParams.values(), url.hash];
  return candidates.some((candidate) => /\.pdf(?:$|[?#/])/i.test(candidate));
}

function parseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function isEdgeNativePdfViewerUrl(value: string | undefined): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (url.protocol === 'edge:') {
    return /pdf/i.test(`${url.hostname}${url.pathname}`);
  }
  if (url.protocol !== 'chrome-extension:') return false;
  return (
    url.hostname === EDGE_PDF_VIEWER_EXTENSION_ID ||
    /(?:^|\/)edge_pdf(?:\/|$)/i.test(url.pathname)
  );
}

export function isExtensionPdfReaderUrl(
  value: string | undefined,
  readerUrl: string,
): boolean {
  const candidate = parseUrl(value);
  const expected = parseUrl(readerUrl);
  if (!candidate || !expected) return false;
  const extensionProtocols = new Set(['chrome-extension:', 'extension:', 'moz-extension:']);
  return (
    extensionProtocols.has(candidate.protocol) &&
    extensionProtocols.has(expected.protocol) &&
    candidate.hostname === expected.hostname &&
    candidate.pathname === expected.pathname
  );
}

/**
 * Whether a tab may host Edge's native PDF side panel. This intentionally
 * excludes Pi PDF, which already owns an in-page translation surface.
 */
export function isEdgePdfSidePanelTab(
  value: string | undefined,
  readerUrl: string,
): boolean {
  return (
    !isExtensionPdfReaderUrl(value, readerUrl) &&
    isEdgeNativePdfContext({ ...(value ? { tabUrl: value } : {}) })
  );
}

export function isLikelyPdfDocumentUrl(value: string | undefined): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (isEdgeNativePdfViewerUrl(value)) return true;
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) return false;
  const candidates = [url.pathname, ...url.searchParams.values(), url.hash];
  return candidates.some((candidate) => /\.pdf(?:$|[?#/])/i.test(candidate));
}

function decodedPdfSourceCandidate(value: string): string | undefined {
  let candidate = value.trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (/^(?:https?|file):\/\//i.test(candidate)) return candidate;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return /^(?:https?|file):\/\//i.test(candidate) ? candidate : undefined;
}

export interface PdfContextUrls {
  tabUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
}

export interface PdfTabCandidate {
  id?: number | undefined;
  windowId?: number | undefined;
  url?: string | undefined;
}

export type PdfSidePanelOpenTarget = { tabId: number } | { windowId: number };

export function pdfSidePanelOpenTarget(
  tab: Pick<PdfTabCandidate, 'id' | 'windowId'> | undefined,
  currentWindowId = -2,
): PdfSidePanelOpenTarget {
  if (tab?.id !== undefined && tab.id >= 0) return { tabId: tab.id };
  return {
    windowId: tab?.windowId !== undefined && tab.windowId >= 0
      ? tab.windowId
      : currentWindowId,
  };
}

type ResolvedPdfTabCandidate<T extends PdfTabCandidate> = T & {
  id: number;
  windowId: number;
};

export function isEdgeNativePdfContext(urls: PdfContextUrls): boolean {
  return (
    [urls.pageUrl, urls.frameUrl].some(isEdgeNativePdfViewerUrl) ||
    [urls.tabUrl, urls.pageUrl, urls.frameUrl].some(isLikelyPdfDocumentUrl)
  );
}

export function shouldOpenEdgePdfSidePanelImmediately(
  urls: PdfContextUrls,
  tabId: number | undefined,
  windowId: number | undefined,
): boolean {
  const invalidBrowserTarget =
    tabId === undefined || tabId < 0 || windowId === undefined || windowId < 0;
  return invalidBrowserTarget && isEdgeNativePdfContext(urls);
}

export function edgePdfSourceUrl(urls: PdfContextUrls): string | undefined {
  for (const value of [urls.tabUrl, urls.pageUrl, urls.frameUrl]) {
    const url = parseUrl(value);
    if (!url || isEdgeNativePdfViewerUrl(value)) continue;
    if (['http:', 'https:', 'file:'].includes(url.protocol)) return url.href;
  }

  for (const value of [urls.pageUrl, urls.frameUrl, urls.tabUrl]) {
    const viewer = parseUrl(value);
    if (!viewer || !isEdgeNativePdfViewerUrl(value)) continue;
    const candidates = [
      ...viewer.searchParams.values(),
      viewer.search.slice(1),
      viewer.hash.slice(1),
    ];
    for (const candidate of candidates) {
      const source = decodedPdfSourceCandidate(candidate);
      if (source) return source;
    }
  }
  return undefined;
}

export function resolvePdfContextTab<T extends PdfTabCandidate>(
  candidates: T[],
  contextUrls: PdfContextUrls,
): ResolvedPdfTabCandidate<T> | undefined {
  const valid = candidates.filter(
    (candidate): candidate is ResolvedPdfTabCandidate<T> =>
      candidate.id !== undefined &&
      candidate.id >= 0 &&
      candidate.windowId !== undefined &&
      candidate.windowId >= 0,
  );
  const expectedIdentity = pdfDocumentIdentity(edgePdfSourceUrl(contextUrls));
  if (expectedIdentity) {
    const matching = valid.filter((candidate) => {
      const candidateSource = edgePdfSourceUrl({
        ...(candidate.url ? { tabUrl: candidate.url } : {}),
      }) ?? candidate.url;
      return pdfDocumentIdentity(candidateSource) === expectedIdentity;
    });
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) return undefined;

    // Edge can expose only its opaque internal viewer URL for the real tab,
    // while the context-menu event still contains the source PDF URL. Falling
    // back is safe only when there is exactly one such opaque viewer candidate;
    // never choose a different, explicitly identifiable PDF document.
    const opaqueViewerCandidates = valid.filter((candidate) => (
      !candidate.url || (
        isEdgeNativePdfViewerUrl(candidate.url) &&
        !pdfDocumentIdentity(edgePdfSourceUrl({ tabUrl: candidate.url }) ?? candidate.url)
      )
    ));
    return opaqueViewerCandidates.length === 1 ? opaqueViewerCandidates[0] : undefined;
  }
  const pdfCandidates = valid.filter((candidate) => isEdgeNativePdfContext({
    ...(candidate.url ? { tabUrl: candidate.url } : {}),
  }));
  if (pdfCandidates.length === 1) return pdfCandidates[0];
  if (pdfCandidates.length > 1) return undefined;
  const hiddenUrlCandidates = valid.filter((candidate) => !candidate.url);
  return hiddenUrlCandidates.length === 1 ? hiddenUrlCandidates[0] : undefined;
}

function positivePage(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : undefined;
}

function pageFromUrl(url: URL): number | undefined {
  const direct = positivePage(url.searchParams.get('page') ?? url.searchParams.get('p'));
  if (direct) return direct;
  const hash = url.hash.slice(1);
  const hashParams = new URLSearchParams(hash);
  const fromHash = positivePage(hashParams.get('page') ?? hashParams.get('p'));
  if (fromHash) return fromHash;
  const match = /(?:^|[?&#])(?:page|p)=(\d+)(?:$|[&#])/i.exec(hash);
  return positivePage(match?.[1] ?? (/^\d+$/.test(hash) ? hash : undefined));
}

export function pdfInitialPage(value: string | undefined): number | undefined {
  const url = parseUrl(value);
  if (!url) return undefined;
  const direct = pageFromUrl(url);
  if (direct) return direct;
  if (!isEdgeNativePdfViewerUrl(value)) return undefined;
  for (const candidate of url.searchParams.values()) {
    const source = decodedPdfSourceCandidate(candidate);
    const sourceUrl = parseUrl(source);
    const page = sourceUrl ? pageFromUrl(sourceUrl) : undefined;
    if (page) return page;
  }
  return undefined;
}

export function pdfDocumentIdentity(value: string | undefined): string | undefined {
  const url = parsePdfSourceUrl(value);
  if (!url) return undefined;
  url.hash = '';
  return url.href;
}

export function pdfPermissionPattern(value: string): string | undefined {
  const url = parsePdfSourceUrl(value);
  if (!url) return undefined;
  return url.protocol === 'file:' ? 'file:///*' : `${url.origin}/*`;
}

export function pdfFilename(value: string, fallback = 'document.pdf'): string {
  const url = parsePdfSourceUrl(value);
  if (!url) return fallback;
  const candidates = [url.pathname, ...url.searchParams.values()].reverse();
  for (const candidate of candidates) {
    const name = candidate.split('/').at(-1);
    if (!name || !/\.pdf$/i.test(name)) continue;
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }
  return fallback;
}
