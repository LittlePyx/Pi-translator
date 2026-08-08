import { protectLatex } from '../latex/protector';
import { MAX_SELECTION_LENGTH } from '../selection/types';
import { MAX_GLOSSARY_TERM_LENGTH } from './glossary';

export const MANUAL_CORRECTION_UNDO_LIMIT = 20;

export type ManualCorrectionErrorCode =
  | 'EMPTY_TRANSLATION'
  | 'TRANSLATION_TOO_LONG'
  | 'STALE_DRAFT'
  | 'INVALID_EDIT'
  | 'LATEX_CHANGED'
  | 'NO_CHANGES'
  | 'INVALID_TERM_CANDIDATE';

export class ManualCorrectionError extends Error {
  constructor(
    public readonly code: ManualCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManualCorrectionError';
  }
}

export interface ManualCorrectionSession {
  /** Optional source text is kept only so an explicit term draft has context. */
  readonly sourceText?: string;
  readonly currentTranslation: string;
  readonly revision: number;
  /** In-memory only. Persistence belongs to the caller. */
  readonly undoStack: readonly string[];
}

export interface EditableManualCorrectionPart {
  readonly id: string;
  readonly kind: 'text';
  readonly text: string;
}

export interface LockedManualCorrectionPart {
  readonly id: string;
  readonly kind: 'latex';
  /** Exact LaTeX that the editor must render as read-only. */
  readonly text: string;
}

export type ManualCorrectionPart =
  | EditableManualCorrectionPart
  | LockedManualCorrectionPart;

export interface ManualCorrectionDraft {
  readonly revision: number;
  readonly parts: readonly ManualCorrectionPart[];
}

export interface ManualCorrectionEdit {
  readonly partId: string;
  readonly text: string;
}

/**
 * Deliberately requires an explicit user-provided source/target pair. The core
 * never attempts to infer terminology from a free-form translation edit.
 */
export interface ExplicitManualTermCandidateInput {
  readonly source: string;
  readonly target: string;
}

export interface ManualTermCandidateDraft {
  readonly source: string;
  readonly target: string;
  readonly confirmedByUser: true;
}

export interface ApplyManualCorrectionRequest {
  readonly revision: number;
  readonly edits: readonly ManualCorrectionEdit[];
  readonly explicitTermCandidate?: ExplicitManualTermCandidateInput;
}

export interface ManualCorrectionTextChange {
  readonly partId: string;
  readonly before: string;
  readonly after: string;
}

export interface SafeManualCorrection {
  readonly scope: 'current';
  readonly previousTranslation: string;
  readonly correctedTranslation: string;
  readonly textChanges: readonly ManualCorrectionTextChange[];
  /** A draft for a later explicit adoption action; never auto-saved. */
  readonly termCandidateDraft?: ManualTermCandidateDraft;
}

export interface ApplyManualCorrectionResult {
  readonly session: ManualCorrectionSession;
  readonly correction: SafeManualCorrection;
}

export interface UndoManualCorrectionResult {
  readonly session: ManualCorrectionSession;
  readonly previousTranslation: string;
  readonly restoredTranslation: string;
}

function assertTranslationLength(value: string): void {
  if (!value.trim()) {
    throw new ManualCorrectionError(
      'EMPTY_TRANSLATION',
      'The corrected translation cannot be empty.',
    );
  }
  if (value.length > MAX_SELECTION_LENGTH * 4) {
    throw new ManualCorrectionError(
      'TRANSLATION_TOO_LONG',
      'The corrected translation is too long.',
    );
  }
}

function isEditableLayoutEscape(raw: string): boolean {
  return raw === String.raw`\n` || raw === String.raw`\r` || raw === String.raw`\t`;
}

function canonicalParts(translation: string): ManualCorrectionPart[] {
  const protectedLatex = protectLatex(translation, 'MANUAL_EDIT');
  if (!protectedLatex.fragments.length) {
    return [{ id: 'text-0', kind: 'text', text: translation }];
  }

  const parts: ManualCorrectionPart[] = [];
  let cursor = 0;
  let partIndex = 0;
  let pendingText = '';
  for (const fragment of protectedLatex.fragments) {
    const tokenIndex = protectedLatex.protectedText.indexOf(fragment.token, cursor);
    if (tokenIndex < 0) {
      throw new ManualCorrectionError(
        'LATEX_CHANGED',
        'The translation contains a LaTeX fragment that cannot be protected safely.',
      );
    }
    pendingText += protectedLatex.protectedText.slice(cursor, tokenIndex);
    // Some model responses contain printable JSON-style layout escapes. They
    // are prose separators, not mathematical commands, and must not create a
    // misleading locked “formula” row in the correction editor.
    if (isEditableLayoutEscape(fragment.raw)) {
      pendingText += fragment.raw;
      cursor = tokenIndex + fragment.token.length;
      continue;
    }
    parts.push({ id: `text-${partIndex}`, kind: 'text', text: pendingText });
    partIndex += 1;
    pendingText = '';
    parts.push({
      id: `latex-${partIndex}`,
      kind: 'latex',
      text: fragment.raw,
    });
    partIndex += 1;
    cursor = tokenIndex + fragment.token.length;
  }
  pendingText += protectedLatex.protectedText.slice(cursor);
  parts.push({
    id: `text-${partIndex}`,
    kind: 'text',
    text: pendingText,
  });
  return parts;
}

function latexFragments(value: string): string[] {
  return protectLatex(value, 'MANUAL_VERIFY').fragments
    .map(({ raw }) => raw)
    .filter((raw) => !isEditableLayoutEscape(raw));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Defense-in-depth validation for callers that persist a reconstructed edit.
 * The UI should still submit per-part edits, but persistence boundaries can
 * use this check without trusting DOM state.
 */
export function validateManualCorrectionText(
  previousTranslation: string,
  correctedTranslation: string,
): void {
  assertTranslationLength(previousTranslation);
  assertTranslationLength(correctedTranslation);
  if (previousTranslation === correctedTranslation) {
    throw new ManualCorrectionError(
      'NO_CHANGES',
      'The corrected translation is unchanged.',
    );
  }
  if (!sameStrings(
    latexFragments(previousTranslation),
    latexFragments(correctedTranslation),
  )) {
    throw new ManualCorrectionError(
      'LATEX_CHANGED',
      'The correction added, removed, reordered, or changed a protected LaTeX fragment.',
    );
  }
}

export function validateManualTermCandidate(
  value: ExplicitManualTermCandidateInput,
): ManualTermCandidateDraft {
  const source = value.source.trim();
  const target = value.target.trim();
  if (
    !source ||
    !target ||
    source.length > MAX_GLOSSARY_TERM_LENGTH ||
    target.length > MAX_GLOSSARY_TERM_LENGTH ||
    protectLatex(source, 'TERM_SOURCE').fragments.length > 0 ||
    protectLatex(target, 'TERM_TARGET').fragments.length > 0
  ) {
    throw new ManualCorrectionError(
      'INVALID_TERM_CANDIDATE',
      'A term candidate must be an explicit, short natural-language source/target pair.',
    );
  }
  return { source, target, confirmedByUser: true };
}

export function createManualCorrectionSession(input: {
  translatedText: string;
  sourceText?: string;
}): ManualCorrectionSession {
  assertTranslationLength(input.translatedText);
  return {
    ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
    currentTranslation: input.translatedText,
    revision: 0,
    undoStack: [],
  };
}

export function createManualCorrectionDraft(
  session: ManualCorrectionSession,
): ManualCorrectionDraft {
  return {
    revision: session.revision,
    parts: canonicalParts(session.currentTranslation),
  };
}

export function applyManualCorrection(
  session: ManualCorrectionSession,
  request: ApplyManualCorrectionRequest,
): ApplyManualCorrectionResult {
  if (request.revision !== session.revision) {
    throw new ManualCorrectionError(
      'STALE_DRAFT',
      'This correction draft is stale. Reopen the editor and try again.',
    );
  }

  const parts = canonicalParts(session.currentTranslation);
  const editableById = new Map(
    parts
      .filter((part): part is EditableManualCorrectionPart => part.kind === 'text')
      .map((part) => [part.id, part] as const),
  );
  const lockedIds = new Set(
    parts.filter((part) => part.kind === 'latex').map((part) => part.id),
  );
  const edits = new Map<string, string>();
  for (const edit of request.edits) {
    if (edits.has(edit.partId)) {
      throw new ManualCorrectionError(
        'INVALID_EDIT',
        `The editable part ${edit.partId} was submitted more than once.`,
      );
    }
    if (lockedIds.has(edit.partId)) {
      throw new ManualCorrectionError(
        'LATEX_CHANGED',
        'LaTeX parts are read-only and cannot be edited.',
      );
    }
    if (!editableById.has(edit.partId)) {
      throw new ManualCorrectionError(
        'INVALID_EDIT',
        `Unknown editable part ${edit.partId}.`,
      );
    }
    edits.set(edit.partId, edit.text);
  }

  const correctedTranslation = parts.map((part) => (
    part.kind === 'latex' ? part.text : (edits.get(part.id) ?? part.text)
  )).join('');
  validateManualCorrectionText(session.currentTranslation, correctedTranslation);

  const textChanges: ManualCorrectionTextChange[] = [];
  for (const part of editableById.values()) {
    const after = edits.get(part.id) ?? part.text;
    if (after !== part.text) {
      textChanges.push({ partId: part.id, before: part.text, after });
    }
  }
  if (!textChanges.length) {
    throw new ManualCorrectionError(
      'NO_CHANGES',
      'The corrected translation is unchanged.',
    );
  }

  const termCandidateDraft = request.explicitTermCandidate
    ? validateManualTermCandidate(request.explicitTermCandidate)
    : undefined;
  const undoStack = [
    ...session.undoStack,
    session.currentTranslation,
  ].slice(-MANUAL_CORRECTION_UNDO_LIMIT);
  const nextSession: ManualCorrectionSession = {
    ...(session.sourceText !== undefined ? { sourceText: session.sourceText } : {}),
    currentTranslation: correctedTranslation,
    revision: session.revision + 1,
    undoStack,
  };
  const correction: SafeManualCorrection = {
    scope: 'current',
    previousTranslation: session.currentTranslation,
    correctedTranslation,
    textChanges,
    ...(termCandidateDraft ? { termCandidateDraft } : {}),
  };
  return { session: nextSession, correction };
}

export function undoManualCorrection(
  session: ManualCorrectionSession,
): UndoManualCorrectionResult | undefined {
  const restoredTranslation = session.undoStack.at(-1);
  if (restoredTranslation === undefined) return undefined;
  if (!sameStrings(
    latexFragments(session.currentTranslation),
    latexFragments(restoredTranslation),
  )) {
    throw new ManualCorrectionError(
      'LATEX_CHANGED',
      'The undo state does not preserve the protected LaTeX fragments.',
    );
  }
  const nextUndoStack = session.undoStack.slice(0, -1);
  return {
    session: {
      ...(session.sourceText !== undefined ? { sourceText: session.sourceText } : {}),
      currentTranslation: restoredTranslation,
      revision: session.revision + 1,
      undoStack: nextUndoStack,
    },
    previousTranslation: session.currentTranslation,
    restoredTranslation,
  };
}
