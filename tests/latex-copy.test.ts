import { describe, expect, it } from 'vitest';
import {
  normalizeFormulaLatexForClipboard,
  normalizeLatexForClipboard,
} from '../ui/latex-copy';

describe('LaTeX clipboard normalization', () => {
  it('turns JSON-style doubled commands into editable LaTeX', () => {
    expect(normalizeLatexForClipboard(
      String.raw`其中 $\\mathbb{Q}_\\Omega\\$ 是目标分布。`,
    )).toBe(String.raw`其中 $\mathbb{Q}_\Omega$ 是目标分布。`);
  });

  it('normalizes standalone formula metadata', () => {
    expect(normalizeFormulaLatexForClipboard(
      String.raw`\\frac{\\mathrm{d}\\Pi^*}{\\mathrm{d}Q_\\Omega}`,
    )).toBe(String.raw`\frac{\mathrm{d}\Pi^*}{\mathrm{d}Q_\Omega}`);
  });

  it('preserves genuine TeX row separators', () => {
    const formula = String.raw`\begin{aligned}a&=b\\ c&=d\end{aligned}`;
    expect(normalizeFormulaLatexForClipboard(formula)).toBe(formula);
  });

  it('preserves row separators without whitespace and optional row spacing', () => {
    const formula = String.raw`\begin{aligned}a&=b\\c&=d\\[4pt]e&=f\end{aligned}`;
    expect(normalizeFormulaLatexForClipboard(formula)).toBe(formula);
  });

  it('removes one JSON escape layer from commands and row separators', () => {
    expect(normalizeFormulaLatexForClipboard(
      String.raw`\\begin{aligned}a&=b\\\\ c&=d\\end{aligned}`,
    )).toBe(String.raw`\begin{aligned}a&=b\\ c&=d\end{aligned}`);
  });

  it('does not rewrite plain text backslashes', () => {
    const plain = String.raw`临时文件位于 C:\\Users\\Name。`;
    expect(normalizeLatexForClipboard(plain)).toBe(plain);
  });

  it('does not rewrite path backslashes beside a normalized formula', () => {
    expect(normalizeLatexForClipboard(
      String.raw`公式 $\\mathbb{Q}_\\Omega\\$；路径 C:\\Users\\Name。`,
    )).toBe(String.raw`公式 $\mathbb{Q}_\Omega$；路径 C:\\Users\\Name。`);
  });

  it('repairs legacy bare font commands in standalone formula metadata', () => {
    expect(normalizeFormulaLatexForClipboard(String.raw`mathbbQ_\Omega+mathrmX`))
      .toBe(String.raw`\mathbb{Q}_\Omega+\mathrm{X}`);
  });
});
