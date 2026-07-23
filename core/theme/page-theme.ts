export type PageTheme = 'light' | 'dark';

const DARK_THEME_HINT = /(?:^|[\s_-])(dark|night|black)(?:$|[\s_-])/i;
const LIGHT_THEME_HINT = /(?:^|[\s_-])(light|day|white)(?:$|[\s_-])/i;

export function themeFromBackgroundColor(color: string): PageTheme | undefined {
  const match = color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i,
  );
  if (!match) return undefined;

  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (![red, green, blue, alpha].every(Number.isFinite) || alpha < 0.08) {
    return undefined;
  }

  const composite = (channel: number): number =>
    (channel * alpha + 255 * (1 - alpha)) / 255;
  const toLinear = (channel: number): number =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * toLinear(composite(red)) +
    0.7152 * toLinear(composite(green)) +
    0.0722 * toLinear(composite(blue));
  return luminance < 0.34 ? 'dark' : 'light';
}

function themeHint(element: Element | null): PageTheme | undefined {
  if (!element) return undefined;
  const value = [
    element.getAttribute('class'),
    element.getAttribute('data-theme'),
    element.getAttribute('data-color-mode'),
    element.getAttribute('data-bs-theme'),
  ]
    .filter(Boolean)
    .join(' ');
  if (DARK_THEME_HINT.test(value)) return 'dark';
  if (LIGHT_THEME_HINT.test(value)) return 'light';
  return undefined;
}

export function detectPageTheme(documentValue: Document = document): PageTheme {
  const hinted =
    themeHint(documentValue.documentElement) ?? themeHint(documentValue.body);
  if (hinted) return hinted;

  const rootStyle = getComputedStyle(documentValue.documentElement);
  const bodyStyle = documentValue.body
    ? getComputedStyle(documentValue.body)
    : undefined;
  const colorScheme = `${rootStyle.colorScheme} ${bodyStyle?.colorScheme ?? ''}`;
  if (/\bdark\b/i.test(colorScheme) && !/\blight\b/i.test(colorScheme)) {
    return 'dark';
  }

  const backgroundTheme =
    (bodyStyle && themeFromBackgroundColor(bodyStyle.backgroundColor)) ??
    themeFromBackgroundColor(rootStyle.backgroundColor);
  if (backgroundTheme) return backgroundTheme;

  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
