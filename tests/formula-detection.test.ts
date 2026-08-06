import { describe, expect, it } from 'vitest';
import {
  containsExplicitLatex,
  shouldUseVisionForPdfFormula,
  shouldUseVisionForRenderedFormula,
} from '../core/translation/formula-detection';

describe('rendered formula detection', () => {
  it('keeps exact LaTeX source on the text translation path', () => {
    expect(containsExplicitLatex(String.raw`We minimize $\mathcal{L}=\sum_i x_i^2$.`)).toBe(true);
    expect(shouldUseVisionForRenderedFormula(
      String.raw`We minimize $\mathcal{L}=\sum_i x_i^2$.`,
    )).toBe(false);
    expect(containsExplicitLatex(String.raw`\alpha_i=\beta_i`)).toBe(true);
    expect(shouldUseVisionForRenderedFormula(String.raw`x_i=y_i`)).toBe(false);
    expect(shouldUseVisionForPdfFormula(String.raw`x_i=y_i`)).toBe(true);
  });

  it('uses vision for rendered mathematical symbols and damaged glyphs', () => {
    expect(shouldUseVisionForRenderedFormula('The loss is ∑ᵢ ‖xᵢ − x̂ᵢ‖².')).toBe(true);
    expect(shouldUseVisionForRenderedFormula('Reconstruction \uFFFD = Ax + b')).toBe(true);
    expect(shouldUseVisionForRenderedFormula(
      'Q = arg min P in P(V, Omega) { KL(P || Q) }, s.t. P = Pi.',
    )).toBe(true);
    expect(shouldUseVisionForRenderedFormula('The confidence is 1 - \u000f.')).toBe(true);
  });

  it('uses vision for equations fragmented by a PDF text layer', () => {
    expect(shouldUseVisionForPdfFormula('Q (d Z ) = Q (d x ) Q (d Z | Z = x )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('d Z = d W')).toBe(true);
    expect(shouldUseVisionForPdfFormula('L ( θ ) = E P [ log p θ ( x ) ]')).toBe(true);
    expect(shouldUseVisionForPdfFormula('= − E P [ log π * ( Z τ ) ]')).toBe(true);
    expect(shouldUseVisionForPdfFormula('b ( y ) = ∇ y log h ( y )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('r 6 = r t t')).toBe(true);
    expect(shouldUseVisionForPdfFormula('the model P is d Z =')).toBe(true);
  });

  it('uses vision for structured operators whose PDF spacing lost their layout', () => {
    expect(shouldUseVisionForPdfFormula('arg min P in P ( V, Ω ) KL ( P || Q )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('min P in P ( V, Ω )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('sup x ∈ Ω f ( x )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('log d P / d Q ( Z )')).toBe(true);
    expect(shouldUseVisionForPdfFormula('max')).toBe(false);
    expect(shouldUseVisionForPdfFormula(':=')).toBe(true);
  });

  it('uses vision when a PDF text layer contains non-printing control glyphs', () => {
    expect(shouldUseVisionForPdfFormula('1 - \u000f with \u000f = 0.01')).toBe(true);
  });

  it('uses vision when overprinted table decimals are concatenated', () => {
    expect(shouldUseVisionForPdfFormula('Accuracy 50.4150.4150.41')).toBe(true);
    expect(shouldUseVisionForPdfFormula('Accuracy 50.41 and 50.41')).toBe(false);
  });

  it('does not mistake URL query parameters for PDF equations', () => {
    expect(shouldUseVisionForPdfFormula('https://example.test/search?q=argmin_x&mode=a=b')).toBe(false);
    expect(shouldUseVisionForPdfFormula(
      'Documentation is available at https://example.test/read?id=42&view=full.',
    )).toBe(false);
    expect(shouldUseVisionForPdfFormula('//www.example.test/read?id=')).toBe(false);
  });

  it('does not send ordinary academic prose to the vision model', () => {
    expect(shouldUseVisionForRenderedFormula(
      'The proposed method improves reconstruction quality on three datasets.',
    )).toBe(false);
    expect(shouldUseVisionForPdfFormula(
      'The proposed method improves reconstruction quality on three datasets.',
    )).toBe(false);
    expect(shouldUseVisionForPdfFormula('We log every result for later inspection.')).toBe(false);
    expect(shouldUseVisionForPdfFormula('The experiment finishes in 10 min.')).toBe(false);
  });
});
