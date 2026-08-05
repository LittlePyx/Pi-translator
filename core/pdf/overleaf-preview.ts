import { edgePdfSourceUrl } from './source';

export type OverleafPdfCandidateKind = 'frame' | 'embed' | 'object' | 'download';

export interface OverleafPdfCandidate {
  url: string;
  kind: OverleafPdfCandidateKind;
  visible: boolean;
  label?: string;
}

export interface OverleafPdfPreview {
  detected: boolean;
  sourceUrl?: string;
}

function parseCandidateUrl(value: string, pageUrl: string): URL | undefined {
  try {
    return new URL(value, pageUrl);
  } catch {
    return undefined;
  }
}

function looksLikePdfSource(url: URL, label = ''): boolean {
  const searchable = [
    url.pathname,
    url.search,
    url.hash,
    ...url.searchParams.values(),
    label,
  ].join(' ');
  return (
    /\.pdf(?:$|[\s?#/&])/iu.test(searchable) ||
    /(?:^|\/)output(?:\/|$)/iu.test(url.pathname) ||
    /pdf/iu.test(label)
  );
}

function scoreCandidate(candidate: OverleafPdfCandidate, url: URL): number {
  let score = candidate.visible ? 80 : 0;
  if (candidate.kind !== 'download') score += 45;
  if (/\/output\/output\.pdf(?:$|\/)/iu.test(url.pathname)) score += 50;
  else if (/\.pdf$/iu.test(url.pathname)) score += 35;
  if (/pdf/iu.test(candidate.label ?? '')) score += 12;
  return score;
}

/**
 * Chooses the currently visible Overleaf PDF preview without coupling the
 * content script to Overleaf's private class names. Blob previews are reported
 * as detected but are never handed to Pi PDF because extension pages cannot
 * reliably inherit another page's blob URL.
 */
export function resolveOverleafPdfPreview(
  candidates: OverleafPdfCandidate[],
  pageUrl: string,
): OverleafPdfPreview {
  let detected = false;
  const loadable: Array<{ url: URL; score: number; order: number }> = [];

  candidates.forEach((candidate, order) => {
    const value = candidate.url.trim();
    if (!value) return;
    const url = parseCandidateUrl(value, pageUrl);
    if (!url || !looksLikePdfSource(url, candidate.label)) return;
    detected = true;
    const inheritedSource = edgePdfSourceUrl({ frameUrl: url.href });
    const loadableUrl = inheritedSource ? parseCandidateUrl(inheritedSource, pageUrl) : url;
    if (!loadableUrl || !['http:', 'https:'].includes(loadableUrl.protocol)) return;
    loadable.push({
      url: loadableUrl,
      score: scoreCandidate(candidate, loadableUrl),
      order,
    });
  });

  loadable.sort((left, right) => right.score - left.score || left.order - right.order);
  const sourceUrl = loadable[0]?.url.href;
  return {
    detected,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}
