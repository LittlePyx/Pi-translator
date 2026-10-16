import {describe, expect, it} from 'vitest';
import {renderLatexMathMl} from '../core/translation/latex-mathml';
import {mathMlFontVariants} from '../core/translation/mathml-font-variants';

describe('explicit mathematical glyph styles in MathML Core', () => {
  it.each([
    [String.raw`\mathbf{F}`, '𝐅'], [String.raw`\boldsymbol{x}`, '𝒙'],
    [String.raw`\mathbb{R}`, 'ℝ'], [String.raw`\mathcal{R}`, 'ℛ'],
    [String.raw`\mathfrak{R}`, 'ℜ'],
    [String.raw`\mathsf{F}`, '𝖥'], [String.raw`\mathtt{F}`, '𝙵'],
    [String.raw`\boldsymbol{\beta}`, '𝜷'],
  ])('materializes %s as its explicit styled glyph while preserving source', (tex, glyph) => {
    const html = renderLatexMathMl(tex, false)!;
    expect(html).toContain(`>${glyph}</mi>`);
    expect(html).toContain(`<annotation encoding="application/x-tex">${tex}</annotation>`);
  });
  it('leaves ordinary/normal math, TeX annotations, entities and nonmath text unchanged', () => {
    const input = '<mi mathvariant="normal">R</mi><mn>12</mn><mtext>普通文字</mtext><annotation encoding="application/x-tex">\\mathbf{F}</annotation>';
    expect(mathMlFontVariants(input)).toBe(input);
    expect(mathMlFontVariants('<mi mathvariant="bold">x&amp;y</mi>')).toContain('𝐱&amp;𝐲');
  });
  it('keeps Greek variants, upper/lower case, indices and already styled characters distinct', () => {
    expect(mathMlFontVariants('<mi mathvariant="bold">Θϴθϑ</mi>')).toContain('𝚯𝚹𝛉𝛝');
    expect(mathMlFontVariants('<mn mathvariant="double-struck">12</mn>')).toContain('𝟙𝟚');
    expect(mathMlFontVariants('<mi mathvariant="bold">𝐅</mi>')).toContain('>𝐅</mi>');
    expect(mathMlFontVariants('<mi mathvariant="italic">h</mi>')).toContain('>ℎ</mi>');
    expect(renderLatexMathMl(String.raw`\mathbf{x}_i^2`, false)).toContain('<mi>i</mi>');
  });
});
