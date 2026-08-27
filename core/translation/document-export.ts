export interface DocumentTranslationExportBlock {
  sourceText: string;
  translatedText?: string;
  pageNumber?: number;
}

export interface DocumentTranslationExport {
  translationText: string;
  bilingualMarkdown: string;
  blockCount: number;
  pageCount: number;
}

function cleanExportText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function markdownBlockquote(value: string): string {
  return value.split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
}

/** Builds copy-ready text from completed blocks without changing formulas or code. */
export function buildDocumentTranslationExport(
  blocks: readonly DocumentTranslationExportBlock[],
): DocumentTranslationExport {
  const completed = blocks.flatMap((block) => {
    const sourceText = cleanExportText(block.sourceText);
    const translatedText = cleanExportText(block.translatedText ?? '');
    if (!sourceText || !translatedText) return [];
    return [{
      sourceText,
      translatedText,
      ...(Number.isSafeInteger(block.pageNumber) && (block.pageNumber ?? 0) > 0
        ? { pageNumber: block.pageNumber }
        : {}),
    }];
  });
  const pages = new Set(completed.flatMap((block) => (
    block.pageNumber === undefined ? [] : [block.pageNumber]
  )));
  const bilingualParts: string[] = [];
  let previousPage: number | undefined;
  for (const block of completed) {
    if (block.pageNumber !== undefined && block.pageNumber !== previousPage) {
      bilingualParts.push(`## 第 ${block.pageNumber} 页`);
      previousPage = block.pageNumber;
    }
    bilingualParts.push(`${block.sourceText}\n\n${markdownBlockquote(block.translatedText)}`);
  }
  return {
    translationText: completed.map((block) => block.translatedText).join('\n\n'),
    bilingualMarkdown: bilingualParts.join('\n\n'),
    blockCount: completed.length,
    pageCount: pages.size,
  };
}
