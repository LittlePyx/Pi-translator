export interface PdfOutlineSourceItem {
  title: string;
  dest: string | unknown[] | null;
  count?: number;
  items: PdfOutlineSourceItem[];
}

export interface PdfOutlineEntry {
  id: string;
  title: string;
  depth: number;
  parentId?: string;
  pageNumber?: number;
  initiallyExpanded: boolean;
  children: PdfOutlineEntry[];
}

export interface PdfOutlineBuildResult {
  entries: PdfOutlineEntry[];
  count: number;
  truncated: boolean;
}

export const PDF_OUTLINE_ITEM_LIMIT = 1_200;
const PDF_OUTLINE_DEPTH_LIMIT = 16;
const PDF_OUTLINE_TITLE_LIMIT = 240;

export function normalizePdfOutlineTitle(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, PDF_OUTLINE_TITLE_LIMIT);
}

export async function buildPdfOutlineEntries(
  source: readonly PdfOutlineSourceItem[],
  resolvePageNumber: (destination: string | unknown[]) => Promise<number | undefined>,
  limit = PDF_OUTLINE_ITEM_LIMIT,
): Promise<PdfOutlineBuildResult> {
  const safeLimit = Math.max(1, Math.round(limit));
  let count = 0;
  let truncated = false;

  const visit = async (
    items: readonly PdfOutlineSourceItem[],
    depth: number,
    parentId: string | undefined,
    path: readonly number[],
  ): Promise<PdfOutlineEntry[]> => {
    if (depth > PDF_OUTLINE_DEPTH_LIMIT) {
      if (items.length) truncated = true;
      return [];
    }
    const entries: PdfOutlineEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (count >= safeLimit) {
        truncated = true;
        break;
      }
      count += 1;
      const item = items[index]!;
      const id = `outline-${[...path, index].join('-')}`;
      const title = normalizePdfOutlineTitle(item.title) || '未命名章节';
      let pageNumber: number | undefined;
      if (item.dest !== null) {
        try {
          const resolved = await resolvePageNumber(item.dest);
          if (resolved !== undefined && Number.isFinite(resolved)) {
            pageNumber = Math.max(1, Math.round(resolved));
          }
        } catch {
          pageNumber = undefined;
        }
      }
      const children = await visit(item.items, depth + 1, id, [...path, index]);
      if (pageNumber === undefined && children.length === 0) continue;
      entries.push({
        id,
        title,
        depth,
        ...(parentId ? { parentId } : {}),
        ...(pageNumber === undefined ? {} : { pageNumber }),
        initiallyExpanded: depth === 1 && children.length > 0,
        children,
      });
    }
    return entries;
  };

  const entries = await visit(source, 1, undefined, []);
  return { entries, count, truncated };
}

export function flattenPdfOutlineEntries(
  entries: readonly PdfOutlineEntry[],
): PdfOutlineEntry[] {
  const flattened: PdfOutlineEntry[] = [];
  const visit = (items: readonly PdfOutlineEntry[]): void => {
    for (const item of items) {
      flattened.push(item);
      visit(item.children);
    }
  };
  visit(entries);
  return flattened;
}

export function pdfOutlineEntryForPage(
  entries: readonly PdfOutlineEntry[],
  pageNumber: number,
): PdfOutlineEntry | undefined {
  let current: PdfOutlineEntry | undefined;
  for (const entry of flattenPdfOutlineEntries(entries)) {
    if (entry.pageNumber === undefined || entry.pageNumber > pageNumber) continue;
    if (
      !current ||
      entry.pageNumber > current.pageNumber! ||
      entry.pageNumber === current.pageNumber
    ) {
      current = entry;
    }
  }
  return current;
}
