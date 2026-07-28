export interface SourceTranslationSegment {
  id: string;
  text: string;
}

const MAX_SEGMENTS = 24;

function fallbackSegments(text: string): string[] {
  const matches = text.match(/[^。！？!?\n]+(?:[。！？!?]+|\n+|$)/g);
  return matches?.map((value) => value.trim()).filter(Boolean) ?? [text.trim()];
}

export function splitTranslationSegments(
  text: string,
  language: string,
): SourceTranslationSegment[] {
  const normalized = text.trim();
  if (!normalized) return [];

  let values: string[];
  try {
    const locale = language === 'auto' ? undefined : language;
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    values = [...segmenter.segment(normalized)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  } catch {
    values = fallbackSegments(normalized);
  }

  if (values.length <= 1) {
    values = fallbackSegments(normalized);
  }
  if (values.length > MAX_SEGMENTS) {
    const retained = values.slice(0, MAX_SEGMENTS - 1);
    retained.push(values.slice(MAX_SEGMENTS - 1).join(' '));
    values = retained;
  }
  return values.map((value, index) => ({
    id: `S${index + 1}`,
    text: value,
  }));
}
