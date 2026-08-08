import { describe, expect, it } from 'vitest';
import {
  applyManualCorrection,
  createManualCorrectionDraft,
  createManualCorrectionSession,
  ManualCorrectionError,
  undoManualCorrection,
  validateManualCorrectionText,
} from '../core/translation/manual-correction';

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof ManualCorrectionError ? error.code : undefined;
  }
}

describe('manual translation correction', () => {
  it('keeps printable layout escapes editable instead of presenting them as formulas', () => {
    const session = createManualCorrectionSession({
      translatedText: String.raw`第一段\n\[Q^{\Pi^*}=x\]\n第二段`,
    });
    const draft = createManualCorrectionDraft(session);

    expect(draft.parts.filter((part) => part.kind === 'latex').map((part) => part.text))
      .toEqual([String.raw`\[Q^{\Pi^*}=x\]`]);
    expect(draft.parts.filter((part) => part.kind === 'text').map((part) => part.text).join(''))
      .toBe(String.raw`第一段\n\n第二段`);
    const applied = applyManualCorrection(session, {
      revision: draft.revision,
      edits: [
        { partId: 'text-0', text: '第一段 ' },
        { partId: 'text-2', text: ' 第二段' },
      ],
    });
    expect(applied.correction.correctedTranslation)
      .toBe(String.raw`第一段 \[Q^{\Pi^*}=x\] 第二段`);
  });

  it('exposes prose as editable parts and LaTeX as locked parts', () => {
    const session = createManualCorrectionSession({
      translatedText: 'The value $f(x)=0$ follows from \\eqref{eq:main}.',
    });
    const draft = createManualCorrectionDraft(session);

    expect(draft.revision).toBe(0);
    expect(draft.parts).toEqual([
      { id: 'text-0', kind: 'text', text: 'The value ' },
      { id: 'latex-1', kind: 'latex', text: '$f(x)=0$' },
      { id: 'text-2', kind: 'text', text: ' follows from ' },
      { id: 'latex-3', kind: 'latex', text: '\\eqref{eq:main}' },
      { id: 'text-4', kind: 'text', text: '.' },
    ]);
  });

  it('applies only prose edits and returns an exact safe comparison', () => {
    const session = createManualCorrectionSession({
      sourceText: 'The value follows from Equation 1.',
      translatedText: '数值 $f(x)=0$ 来自 \\eqref{eq:main}。',
    });
    const result = applyManualCorrection(session, {
      revision: 0,
      edits: [
        { partId: 'text-0', text: '函数值 ' },
        { partId: 'text-2', text: ' 可由 ' },
      ],
    });

    expect(result.correction).toEqual({
      scope: 'current',
      previousTranslation: '数值 $f(x)=0$ 来自 \\eqref{eq:main}。',
      correctedTranslation: '函数值 $f(x)=0$ 可由 \\eqref{eq:main}。',
      textChanges: [
        { partId: 'text-0', before: '数值 ', after: '函数值 ' },
        { partId: 'text-2', before: ' 来自 ', after: ' 可由 ' },
      ],
    });
    expect(result.session.currentTranslation).toBe(
      '函数值 $f(x)=0$ 可由 \\eqref{eq:main}。',
    );
    expect(result.session.undoStack).toEqual([
      '数值 $f(x)=0$ 来自 \\eqref{eq:main}。',
    ]);
  });

  it('keeps the content inside text-bearing LaTeX macros editable', () => {
    const session = createManualCorrectionSession({
      translatedText: 'This is \\textbf{important}.',
    });
    const draft = createManualCorrectionDraft(session);
    expect(draft.parts).toEqual([
      { id: 'text-0', kind: 'text', text: 'This is ' },
      { id: 'latex-1', kind: 'latex', text: '\\textbf{' },
      { id: 'text-2', kind: 'text', text: 'important' },
      { id: 'latex-3', kind: 'latex', text: '}' },
      { id: 'text-4', kind: 'text', text: '.' },
    ]);

    const result = applyManualCorrection(session, {
      revision: draft.revision,
      edits: [{ partId: 'text-2', text: 'critical' }],
    });
    expect(result.correction.correctedTranslation).toBe(
      'This is \\textbf{critical}.',
    );
  });

  it('rejects edits targeting locked LaTeX parts', () => {
    const session = createManualCorrectionSession({
      translatedText: 'Value $x$ is stable.',
    });
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'latex-1', text: '$y$' }],
    }))).toBe('LATEX_CHANGED');
  });

  it('rejects newly injected LaTeX from an editable prose part', () => {
    const session = createManualCorrectionSession({
      translatedText: 'Value $x$ is stable.',
    });
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-2', text: ' equals $y$.' }],
    }))).toBe('LATEX_CHANGED');
  });

  it('rejects duplicate, unknown, stale, empty, and unchanged edits', () => {
    const session = createManualCorrectionSession({ translatedText: 'Original.' });

    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [
        { partId: 'text-0', text: 'First.' },
        { partId: 'text-0', text: 'Second.' },
      ],
    }))).toBe('INVALID_EDIT');
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-9', text: 'Unknown.' }],
    }))).toBe('INVALID_EDIT');
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 1,
      edits: [{ partId: 'text-0', text: 'Stale.' }],
    }))).toBe('STALE_DRAFT');
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-0', text: '   ' }],
    }))).toBe('EMPTY_TRANSLATION');
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-0', text: 'Original.' }],
    }))).toBe('NO_CHANGES');
  });

  it('undoes session-only corrections without changing protected LaTeX', () => {
    const initial = createManualCorrectionSession({
      translatedText: 'Value $x$ is stable.',
    });
    const first = applyManualCorrection(initial, {
      revision: 0,
      edits: [{ partId: 'text-0', text: 'The value ' }],
    });
    const second = applyManualCorrection(first.session, {
      revision: 1,
      edits: [{ partId: 'text-2', text: ' remains stable.' }],
    });

    const undoSecond = undoManualCorrection(second.session);
    expect(undoSecond?.restoredTranslation).toBe('The value $x$ is stable.');
    expect(undoSecond?.session.revision).toBe(3);
    const undoFirst = undoManualCorrection(undoSecond!.session);
    expect(undoFirst?.restoredTranslation).toBe('Value $x$ is stable.');
    expect(undoManualCorrection(undoFirst!.session)).toBeUndefined();
  });

  it('refuses a tampered undo state that would replace a formula', () => {
    const session = createManualCorrectionSession({
      translatedText: 'Value $x$ is stable.',
    });
    const tampered = {
      ...session,
      undoStack: ['Value $y$ is stable.'],
    };
    expect(errorCode(() => undoManualCorrection(tampered))).toBe('LATEX_CHANGED');
  });

  it('never infers a term candidate but carries an explicit user pair', () => {
    const session = createManualCorrectionSession({
      sourceText: 'We use adaptive sensing.',
      translatedText: '我们使用自适应测量。',
    });
    const withoutTerm = applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-0', text: '我们使用自适应感知。' }],
    });
    expect(withoutTerm.correction.termCandidateDraft).toBeUndefined();

    const withTerm = applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-0', text: '我们使用自适应感知。' }],
      explicitTermCandidate: {
        source: ' adaptive sensing ',
        target: ' 自适应感知 ',
      },
    });
    expect(withTerm.correction.termCandidateDraft).toEqual({
      source: 'adaptive sensing',
      target: '自适应感知',
      confirmedByUser: true,
    });
  });

  it('rejects formula-like content as an explicit terminology pair', () => {
    const session = createManualCorrectionSession({ translatedText: 'Value is stable.' });
    expect(errorCode(() => applyManualCorrection(session, {
      revision: 0,
      edits: [{ partId: 'text-0', text: 'The value is stable.' }],
      explicitTermCandidate: { source: '$x$', target: '变量 x' },
    }))).toBe('INVALID_TERM_CANDIDATE');
  });

  it('validates reconstructed text again at the persistence boundary', () => {
    expect(() => validateManualCorrectionText(
      '数值 $x$ 保持不变。',
      '函数值 $x$ 保持稳定。',
    )).not.toThrow();
    expect(errorCode(() => validateManualCorrectionText(
      '数值 $x$ 保持不变。',
      '函数值 $y$ 保持稳定。',
    ))).toBe('LATEX_CHANGED');
  });
});
