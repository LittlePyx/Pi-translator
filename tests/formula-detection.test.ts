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
  });

  it('does not send ordinary academic prose to the vision model', () => {
    expect(shouldUseVisionForRenderedFormula(
      'The proposed method improves reconstruction quality on three datasets.',
    )).toBe(false);
  });
});
