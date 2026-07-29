import { describe, expect, it } from 'vitest';
import {
  protectLatex,
  restoreLatex,
  restoreLatexPreview,
} from '../core/latex/protector';
import { TranslationError } from '../core/messaging/errors';

describe('LaTeX protection', () => {
  it('leaves plain prose available for translation', () => {
    const protectedLatex = protectLatex('We prove the result.');
    expect(protectedLatex.protectedText).toBe('We prove the result.');
    expect(protectedLatex.fragments).toEqual([]);
  });

  it('protects math and citation commands and restores them', () => {
    const source = 'We prove that $f(x)>0$ using \\cite{smith2025}.';
    const protectedLatex = protectLatex(source);
    expect(protectedLatex.fragments.map((fragment) => fragment.raw)).toEqual([
      '$f(x)>0$',
      '\\cite{smith2025}',
    ]);

    const [math, citation] = protectedLatex.fragments.map((fragment) => fragment.token);
    expect(math).toBeDefined();
    expect(citation).toBeDefined();
    const restored = restoreLatex(`我们使用 ${citation!} 证明 ${math!}。`, protectedLatex);
    expect(restored.text).toBe('我们使用 \\cite{smith2025} 证明 $f(x)>0$。');
  });

  it('keeps text-bearing macro structure while exposing its content', () => {
    const protectedLatex = protectLatex('This is \\textbf{important}.');
    expect(protectedLatex.fragments.map((fragment) => fragment.raw)).toEqual([
      '\\textbf{',
      '}',
    ]);
    const [open, close] = protectedLatex.fragments.map((fragment) => fragment.token);
    const restored = restoreLatex(`这是${open!}重要${close!}。`, protectedLatex);
    expect(restored.text).toBe('这是\\textbf{重要}。');
  });

  it('protects unknown macros conservatively', () => {
    const protectedLatex = protectLatex('Use \\custom{opaque value} here.');
    expect(protectedLatex.fragments[0]?.raw).toBe('\\custom{opaque value}');
    expect(protectedLatex.warnings[0]?.code).toBe('UNKNOWN_MACRO_PROTECTED');
  });

  it('protects an incomplete math fragment and emits a warning', () => {
    const protectedLatex = protectLatex('Value $f(x) is positive');
    expect(protectedLatex.fragments[0]?.raw).toBe('$f(x) is positive');
    expect(protectedLatex.warnings[0]?.code).toBe('INCOMPLETE_LATEX_PROTECTED');
  });

  it('rejects missing or duplicated placeholders', () => {
    const protectedLatex = protectLatex('See \\ref{fig:a}.');
    const token = protectedLatex.fragments[0]?.token;
    expect(token).toBeDefined();
    expect(() => restoreLatex('参见图。', protectedLatex)).toThrow(TranslationError);
    expect(() => restoreLatex(`${token!}${token!}`, protectedLatex)).toThrow(
      TranslationError,
    );
  });

  it('restores only complete placeholders in a streaming preview', () => {
    const protectedLatex = protectLatex('Value $x$ is stable.', 'FULL1');
    const token = protectedLatex.fragments[0]?.token;
    expect(token).toBeDefined();
    expect(
      restoreLatexPreview(`数值 ${token!} 保持`, protectedLatex),
    ).toBe('数值 $x$ 保持');
    expect(
      restoreLatexPreview('数值 ⟦FULL1_00', protectedLatex),
    ).toBe('数值 ');
    expect(
      restoreLatexPreview('数值 ⟦MUTATED_0001⟧ 保持', protectedLatex),
    ).toBe('数值  保持');
  });
});
