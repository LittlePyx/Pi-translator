import { describe, expect, it } from 'vitest';
import {
  isLikelyLatexStructure,
  isLikelySourceCode,
  shouldSuppressPassiveSelectionTranslation,
} from '../core/selection/passive-selection-intent';

describe('passive selection translation intent', () => {
  it('recognizes high-confidence programming, data, shell, and stack-trace selections', () => {
    expect(isLikelySourceCode('const total = items.reduce((sum, item) => sum + item.value, 0);'))
      .toBe(true);
    expect(isLikelySourceCode('public static String translate(String source) {')).toBe(true);
    expect(isLikelySourceCode(`{
      "name": "pi-translator",
      "version": "0.13.0"
    }`)).toBe(true);
    expect(isLikelySourceCode('npm run build:edge')).toBe(true);
    expect(isLikelySourceCode(`TypeError: Cannot read properties of undefined
      at renderResult (app.ts:42:11)`)).toBe(true);
  });

  it('keeps natural prose and short ambiguous selections available', () => {
    expect(isLikelySourceCode('The function returns a list containing all matching elements.'))
      .toBe(false);
    expect(isLikelySourceCode('Private performance fixture 1724227200000.')).toBe(false);
    expect(isLikelySourceCode('Call translate(text) to continue.')).toBe(false);
    expect(isLikelySourceCode(
      String.raw`The objective \mathcal{L}=\sum_i(x_i-y_i)^2 is minimized during training.`,
    )).toBe(false);
    expect(isLikelySourceCode('return')).toBe(false);
    expect(isLikelySourceCode('这段文字解释了如何在网页中使用翻译功能。')).toBe(false);
  });

  it('distinguishes LaTeX structure from prose containing inline commands', () => {
    expect(isLikelyLatexStructure(String.raw`\begin{equation}
      E = mc^2
    \end{equation}`)).toBe(true);
    expect(isLikelyLatexStructure(String.raw`\section{Introduction}`)).toBe(true);
    expect(isLikelyLatexStructure(
      String.raw`This method uses \alpha and \beta variables in the final expression.`,
    )).toBe(false);
  });

  it('uses DOM context on ordinary pages without hiding Overleaf prose', () => {
    const proseInCodeSurface = {
      normalizedText: 'The server returned an error while loading this resource.',
      passiveSelectionEnvironment: 'code' as const,
    };
    expect(shouldSuppressPassiveSelectionTranslation(proseInCodeSurface, 'general')).toBe(true);
    expect(shouldSuppressPassiveSelectionTranslation(proseInCodeSurface, 'overleaf')).toBe(false);
    expect(shouldSuppressPassiveSelectionTranslation({
      ...proseInCodeSurface,
      passiveSelectionEnvironment: 'terminal',
    }, 'overleaf')).toBe(true);
    expect(shouldSuppressPassiveSelectionTranslation(proseInCodeSurface, 'pdf')).toBe(false);
  });

  it('suppresses code text in any passive webpage flow and LaTeX structure in Overleaf', () => {
    expect(shouldSuppressPassiveSelectionTranslation({
      normalizedText: 'const result = translate(source);',
    }, 'general')).toBe(true);
    expect(shouldSuppressPassiveSelectionTranslation({
      normalizedText: 'const result = translate(source);',
    }, 'overleaf')).toBe(true);
    expect(shouldSuppressPassiveSelectionTranslation({
      normalizedText: String.raw`\begin{document}\end{document}`,
    }, 'overleaf')).toBe(true);
  });
});
