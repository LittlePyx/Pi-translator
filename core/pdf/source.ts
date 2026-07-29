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
