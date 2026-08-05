import { describe, expect, it } from 'vitest';
import {
  containsRenderableLatex,
  latexRenderParts,
  splitLatexDisplaySegments,
} from '../core/translation/latex-display';
import { renderLatexMathMl } from '../core/translation/latex-mathml';

describe('LaTeX result display', () => {
  it('separates inline and display formulae without changing their source', () => {
    expect(splitLatexDisplaySegments(
      '比率 $\\frac{M}{N}$。\n\\[\\boldsymbol{y}=\\mathbf{A}\\boldsymbol{x},\\tag{1}\\]',
    )).toEqual([
      { kind: 'text', text: '比率 ' },
      { kind: 'math', tex: '\\frac{M}{N}', raw: '$\\frac{M}{N}$', displayMode: false },
      { kind: 'text', text: '。\n' },
      {
        kind: 'math',
        tex: '\\boldsymbol{y}=\\mathbf{A}\\boldsymbol{x},\\tag{1}',
        raw: '\\[\\boldsymbol{y}=\\mathbf{A}\\boldsymbol{x},\\tag{1}\\]',
        displayMode: true,
      },
    ]);
  });

  it('leaves escaped dollars and incomplete formulae as ordinary text', () => {
    const text = '价格为 \\$5，未闭合公式 $x+y';
    expect(containsRenderableLatex(text)).toBe(false);
    expect(splitLatexDisplaySegments(text)).toEqual([{ kind: 'text', text }]);
  });

  it('renders bundled MathML and rejects invalid LaTeX locally', () => {
    const rendered = renderLatexMathMl(
      '\\hat{\\boldsymbol{x}}=\\arg\\min_x \\frac{1}{2}\\|y-Ax\\|_2^2',
      true,
    );
    expect(rendered).toContain('<math');
    expect(rendered).toContain('display="block"');
    expect(renderLatexMathMl('\\frac{', false)).toBeUndefined();
    const untrusted = renderLatexMathMl('\\href{javascript:alert(1)}{x}', false) ?? '';
    expect(untrusted).not.toMatch(/\shref\s*=|<script/iu);
  });

  it('separates one top-level equation number from a scrolling display body', () => {
    const source = String.raw`\arg\min_x f(x),\qquad \text{s.t. }g(x)=0,\tag{8}`;
    expect(latexRenderParts(source, true)).toEqual({
      tex: String.raw`\arg\min_x f(x),\qquad \text{s.t. }g(x)=0,`,
      equationTag: '8',
    });
    expect(latexRenderParts(source, false)).toEqual({ tex: source });
  });

  it('keeps one aligned equation number fixed and normalizes existing parentheses', () => {
    const source = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}\tag{(8)}`;
    expect(latexRenderParts(source, true)).toEqual({
      tex: String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,
      equationTag: '8',
    });
  });

  it('leaves multiple row equation numbers in the formula for the local fallback', () => {
    const source = String.raw`\begin{cases}x=1\tag{3}\\y=2\tag{4}\end{cases}`;
    expect(latexRenderParts(source, true)).toEqual({ tex: source });
  });

  it('renders numbered equations nested in cases through a display-only fallback', () => {
    const source = String.raw`\begin{cases}
\boldsymbol{z}_k = \boldsymbol{x}_{k-1} + \rho \mathbf{A}^\top
(\boldsymbol{y} - \mathbf{A}\boldsymbol{x}_{k-1}), \tag{3} \\
\boldsymbol{x}_k = \arg\min_{\boldsymbol{x}} \frac{1}{2\sigma^2}
\|\boldsymbol{z}_k - \boldsymbol{x}\|_2^2 + \mathcal{R}(\boldsymbol{x}), \tag{4}
\end{cases}`;

    const rendered = renderLatexMathMl(source, true);
    expect(rendered).toContain('<math');
    expect(rendered).toContain('display="block"');
    expect(rendered).toContain('<mtext>(3)</mtext>');
    expect(rendered).toContain('<mtext>(4)</mtext>');
    expect(source).toContain('\\tag{3}');
    expect(source).toContain('\\tag{4}');
  });
});
