import type { PdfSourceLocation } from '../translation/types';

export interface DocumentIdentityInput {
  pageUrl: string;
  documentId?: string;
  sourceLabel?: string;
  sourceLocation?: PdfSourceLocation;
}

export interface DocumentIdentity {
  documentId: string;
  label: string;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizedDocumentUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return value.trim();
  }
}

function labelForDocument(input: DocumentIdentityInput): string {
  if (input.sourceLocation) return 'PDF 文档';
  try {
    const url = new URL(input.pageUrl);
    const pdfLike = /\.pdf$/iu.test(url.pathname) || url.protocol === 'file:';
    if (pdfLike) return url.hostname ? `${url.hostname} · PDF` : 'PDF 文档';
    return (url.hostname || '当前文档').slice(0, 160);
  } catch {
    return '当前文档';
  }
}

export function documentIdentity(input: DocumentIdentityInput): DocumentIdentity {
  const explicitDocumentId = input.documentId?.trim();
  const explicitPdfId = input.sourceLocation?.documentId.trim();
  const basis = explicitDocumentId
    ? `explicit:${explicitDocumentId}`
    : explicitPdfId
      ? `pdf:${explicitPdfId}`
      : `url:${normalizedDocumentUrl(input.pageUrl)}`;
  const documentId = explicitDocumentId && /^doc-[a-z0-9]{1,8}$/u.test(explicitDocumentId)
    ? explicitDocumentId
    : `doc-${stableHash(basis!)}`;
  return {
    documentId,
    label: labelForDocument(input),
  };
}
