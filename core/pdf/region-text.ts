import type { RegionRect } from './region-capture';

export interface PositionedPdfText {
  text: string;
  rect: RegionRect;
}

export interface PdfRegionTextExtraction {
  text: string;
  reliable: boolean;
  itemCount: number;
}

interface TextLine {
  centerY: number;
  height: number;
  items: PositionedPdfText[];
}

function intersectionRatio(item: RegionRect, region: RegionRect): number {
  const width = Math.max(0, Math.min(item.right, region.right) - Math.max(item.left, region.left));
  const height = Math.max(0, Math.min(item.bottom, region.bottom) - Math.max(item.top, region.top));
  const itemArea = Math.max(1, item.width * item.height);
  return (width * height) / itemArea;
}

function normalizedItem(item: PositionedPdfText): PositionedPdfText | undefined {
  const text = item.text.replaceAll(/\s+/g, ' ').trim();
  if (!text || item.rect.width <= 0 || item.rect.height <= 0) return undefined;
  return { text, rect: item.rect };
}

function appendText(previous: PositionedPdfText | undefined, current: PositionedPdfText): string {
  if (!previous) return current.text;
  const previousText = previous.text;
  const currentText = current.text;
  if (/\s$/u.test(previousText) || /^\s/u.test(currentText)) return currentText;
  if (/^[,.;:!?%\])}，。；：！？、）】》]/u.test(currentText)) return currentText;
  if (/[([{（【《]$/u.test(previousText)) return currentText;
  if (/\p{Script=Han}$/u.test(previousText) && /^\p{Script=Han}/u.test(currentText)) {
    return currentText;
  }
  const gap = current.rect.left - previous.rect.right;
  const averageCharacterWidth = previous.rect.width / Math.max(1, [...previousText].length);
  return `${gap > Math.max(1, averageCharacterWidth * 0.22) ? ' ' : ''}${currentText}`;
}

export function extractPdfRegionText(
  items: PositionedPdfText[],
  region: RegionRect,
): PdfRegionTextExtraction {
  const selected = items
    .map(normalizedItem)
    .filter((item): item is PositionedPdfText => Boolean(item))
    .filter((item) => intersectionRatio(item.rect, region) >= 0.58)
    .sort((left, right) => (
      left.rect.top - right.rect.top || left.rect.left - right.rect.left
    ));
  if (!selected.length) return { text: '', reliable: false, itemCount: 0 };

  const orderedHeights = selected.map((item) => item.rect.height).sort((a, b) => a - b);
  const medianHeight = orderedHeights[Math.floor(orderedHeights.length / 2)] ?? 10;
  const lineTolerance = Math.max(2, medianHeight * 0.58);
  const lines: TextLine[] = [];
  for (const item of selected) {
    const centerY = (item.rect.top + item.rect.bottom) / 2;
    const line = lines.find((candidate) => Math.abs(candidate.centerY - centerY) <= lineTolerance);
    if (line) {
      const count = line.items.length;
      line.centerY = (line.centerY * count + centerY) / (count + 1);
      line.height = Math.max(line.height, item.rect.height);
      line.items.push(item);
    } else {
      lines.push({ centerY, height: item.rect.height, items: [item] });
    }
  }

  const text = lines
    .sort((left, right) => left.centerY - right.centerY)
    .map((line) => {
      const ordered = line.items.sort((left, right) => left.rect.left - right.rect.left);
      return ordered.reduce(
        (value, item, index) => value + appendText(ordered[index - 1], item),
        '',
      );
    })
    .join('\n')
    .trim();
  const characters = [...text].filter((character) => !/\s/u.test(character));
  const readableCharacters = characters.filter((character) => /[\p{L}\p{N}\p{P}\p{S}]/u.test(character));
  const privateUseCharacters = characters.filter((character) => /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(character));
  const replacementCharacters = characters.filter((character) => character === '\uFFFD');
  const readableRatio = readableCharacters.length / Math.max(1, characters.length);
  const unreliableCharacters = privateUseCharacters.length + replacementCharacters.length;
  const reliable = (
    characters.length >= 2 &&
    readableRatio >= 0.82 &&
    unreliableCharacters / Math.max(1, characters.length) <= 0.05
  );
  return { text, reliable, itemCount: selected.length };
}
