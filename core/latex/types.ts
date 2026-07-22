import type { TranslationWarning } from '../translation/types';

export interface ProtectedFragment {
  token: string;
  raw: string;
}

export interface ProtectedLatex {
  sourceText: string;
  protectedText: string;
  fragments: ProtectedFragment[];
  warnings: TranslationWarning[];
}

export interface RestoredLatex {
  text: string;
  warnings: TranslationWarning[];
}
