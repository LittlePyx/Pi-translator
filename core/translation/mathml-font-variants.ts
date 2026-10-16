/** KaTeX emits legacy MathML mathvariant values. MathML Core only requires
 * "normal"; materialize the explicit Unicode mathematical alphabet for the
 * other styles. This changes display glyphs, never the TeX annotation. */
const alphabets: Record<string, {upper: number; lower: number; digits?: number; greek?: number}> = {
  bold: {upper: 0x1d400, lower: 0x1d41a, digits: 0x1d7ce, greek: 0x1d6a8},
  italic: {upper: 0x1d434, lower: 0x1d44e, greek: 0x1d6e2},
  'bold-italic': {upper: 0x1d468, lower: 0x1d482, greek: 0x1d71c},
  script: {upper: 0x1d49c, lower: 0x1d4b6},
  'bold-script': {upper: 0x1d4d0, lower: 0x1d4ea},
  fraktur: {upper: 0x1d504, lower: 0x1d51e},
  'double-struck': {upper: 0x1d538, lower: 0x1d552, digits: 0x1d7d8},
  'bold-fraktur': {upper: 0x1d56c, lower: 0x1d586},
  'sans-serif': {upper: 0x1d5a0, lower: 0x1d5ba, digits: 0x1d7e2},
  'bold-sans-serif': {upper: 0x1d5d4, lower: 0x1d5ee, digits: 0x1d7ec, greek: 0x1d756},
  'sans-serif-italic': {upper: 0x1d608, lower: 0x1d622},
  'sans-serif-bold-italic': {upper: 0x1d63c, lower: 0x1d656, greek: 0x1d790},
  monospace: {upper: 0x1d670, lower: 0x1d68a, digits: 0x1d7f6},
};
const exceptions: Record<string, Record<string, string>> = {
  italic: {h: 'ℎ'},
  script: {B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ'},
  fraktur: {C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ'},
  'double-struck': {C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ'},
};
const greek = [...'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ'];

export function mathMlFontVariants(html: string): string {
  return html.replace(/<(mi|mn|mo|mtext)([^>]*\bmathvariant="([^"]+)"[^>]*)>([^<]*)<\/\1>/gu,
    (original, tag: string, attributes: string, variant: string, text: string) => {
      const alphabet = alphabets[variant];
      if (!alphabet) return original;
      const mapped = text.replace(/&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);|[\s\S]/giu, character => {
        if (character.startsWith('&')) return character;
        const exception = exceptions[variant]?.[character];
        if (exception) return exception;
        if (/^[A-Z]$/u.test(character)) return String.fromCodePoint(alphabet.upper + character.charCodeAt(0) - 65);
        if (/^[a-z]$/u.test(character)) return String.fromCodePoint(alphabet.lower + character.charCodeAt(0) - 97);
        if (alphabet.digits && /^\d$/u.test(character)) return String.fromCodePoint(alphabet.digits + Number(character));
        const index = greek.indexOf(character);
        if (alphabet.greek && index >= 0) return String.fromCodePoint(alphabet.greek + index);
        if (variant === 'bold' && character === 'Ϝ') return '𝟊';
        if (variant === 'bold' && character === 'ϝ') return '𝟋';
        return character;
      });
      return `<${tag}${attributes}>${mapped}</${tag}>`;
    });
}
