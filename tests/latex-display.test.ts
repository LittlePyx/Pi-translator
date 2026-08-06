import { describe, expect, it } from 'vitest';
import {
  containsRenderableLatex,
  latexRenderParts,
  splitLatexDisplaySegments,
} from '../core/translation/latex-display';
import { renderLatexMathMl } from '../core/translation/latex-mathml';
import { normalizeVisionLatexText } from '../core/translation/formula-output-validation';

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

  it('recognizes vision output with double-escaped bracket delimiters', () => {
    const source = String.raw`正文 \\[\\mathbf{x}=\\mathbb{Q}\\] 后文`;
    expect(splitLatexDisplaySegments(source)).toEqual([
      { kind: 'text', text: '正文 ' },
      {
        kind: 'math',
        tex: String.raw`\\mathbf{x}=\\mathbb{Q}`,
        raw: String.raw`\\[\\mathbf{x}=\\mathbb{Q}\\]`,
        displayMode: true,
      },
      { kind: 'text', text: ' 后文' },
    ]);
    expect(splitLatexDisplaySegments(String.raw`正文 \\\\[x=y\\\\] 后文`)).toEqual([
      { kind: 'text', text: '正文 ' },
      {
        kind: 'math',
        tex: 'x=y',
        raw: String.raw`\\\\[x=y\\\\]`,
        displayMode: true,
      },
      { kind: 'text', text: ' 后文' },
    ]);
  });

  it('segments and renders the mixed prose shape returned by over-escaped vision JSON', () => {
    const source = String.raw`退出分布 $\\mathbb{Q}_\\Omega\\$ 与目标分布匹配。$\\[\\mathbf{x}=\\mathrm{A}\\]$`;
    const formulae = splitLatexDisplaySegments(source).filter(
      (segment) => segment.kind === 'math',
    );
    expect(formulae).toHaveLength(2);
    for (const formula of formulae) {
      if (formula.kind !== 'math') throw new Error('Expected math segment.');
      expect(renderLatexMathMl(formula.tex, formula.displayMode)).toContain('<math');
    }
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

  it('renders a promoted standalone optimizer with its limit underneath', () => {
    const normalized = normalizeVisionLatexText([
      'before',
      String.raw`$\arg\min P\in\mathcal{P}(V,\Omega)\left\{KL(P\|Q)\right\}$ (8)`,
      'after',
    ].join('\n'));
    const formula = splitLatexDisplaySegments(normalized).find(
      (segment) => segment.kind === 'math',
    );
    expect(formula).toMatchObject({ kind: 'math', displayMode: true });
    if (formula?.kind !== 'math') throw new Error('Expected math segment.');

    const parts = latexRenderParts(formula.tex, formula.displayMode);
    expect(parts.equationTag).toBe('8');
    const rendered = renderLatexMathMl(parts.tex, formula.displayMode) ?? '';
    expect(rendered).toContain('display="block"');
    expect(rendered).toContain('<munder>');
    expect(rendered).not.toContain('<msub>');
  });

  it('renders deterministic over-escaped commands while preserving the source string', () => {
    const source = String.raw`\\mathbb{Q}_\\Omega\\`;
    const rendered = renderLatexMathMl(source, false) ?? '';
    expect(rendered).toContain('mathvariant="double-struck"');
    expect(rendered).toContain('>Ω</mi>');
    expect(source).toBe(String.raw`\\mathbb{Q}_\\Omega\\`);
    const repeatedlyEscaped = String.raw`\\\\mathbb{Q}_\\\\Omega\\\\`;
    expect(renderLatexMathMl(repeatedlyEscaped, false))
      .toContain('mathvariant="double-struck"');
  });

  it('unwraps redundant escaped display delimiters nested inside dollar math', () => {
    const source = String.raw`\\[\\mathbf{x}=\\mathrm{A}\\]`;
    const rendered = renderLatexMathMl(source, false) ?? '';
    expect(rendered).toContain('mathvariant="bold"');
    expect(rendered).toContain('mathvariant="normal"');
  });

  it('repairs bare font pseudo commands only in canonicalized vision math', () => {
    const source = '$mathbbQ_mathrmX$ 与普通正文 mathbbQ';
    const canonical = normalizeVisionLatexText(source);
    const segments = splitLatexDisplaySegments(canonical);
    const formula = segments.find((segment) => segment.kind === 'math');
    expect(formula).toMatchObject({
      kind: 'math',
      tex: String.raw`\mathbb{Q}_\mathrm{X}`,
    });
    if (formula?.kind !== 'math') throw new Error('Expected math segment.');
    const rendered = renderLatexMathMl(formula.tex, false) ?? '';
    expect(rendered).toContain('mathvariant="double-struck"');
    expect(rendered).toContain('mathvariant="normal"');
    expect(segments.at(-1)).toEqual({ kind: 'text', text: ' 与普通正文 mathbbQ' });
  });

  it('does not reinterpret valid bare variables in the generic exact renderer', () => {
    const rendered = renderLatexMathMl('mathbbQ', false) ?? '';
    expect(rendered).not.toContain('mathvariant="double-struck"');
    expect(rendered).toContain('>m</mi>');
  });

  it('does not collapse legitimate row separators in aligned and cases environments', () => {
    const aligned = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
    const cases = String.raw`\begin{cases}\mathbb{Q},&x>0\\\Omega,&x\le0\end{cases}`;
    const alignedRendered = renderLatexMathMl(aligned, true) ?? '';
    const casesRendered = renderLatexMathMl(cases, true) ?? '';
    expect(alignedRendered.match(/<mtr>/gu)).toHaveLength(2);
    expect(casesRendered.match(/<mtr>/gu)).toHaveLength(2);
    expect(casesRendered).toContain('>Ω</mi>');
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

  it('extracts an over-escaped equation number without leaving one stray slash', () => {
    const source = String.raw`\\mathbb{Q}(Z)\\tag{(8)}\\`;
    expect(latexRenderParts(source, true)).toEqual({
      tex: String.raw`\\mathbb{Q}(Z)\\`,
      equationTag: '8',
    });
    const parts = latexRenderParts(source, true);
    expect(renderLatexMathMl(parts.tex, true)).toContain('<math');
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
