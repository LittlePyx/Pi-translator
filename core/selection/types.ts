export type SelectionSource =
  | 'context-menu'
  | 'window-selection'
  | 'text-control'
  | 'contenteditable'
  | 'overleaf-adapter';

export type PassiveSelectionEnvironment = 'code' | 'terminal';

export interface ViewportRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface SelectionSnapshot {
  requestId: string;
  sourceText: string;
  normalizedText: string;
  source: SelectionSource;
  pageUrl: string;
  capturedAt: number;
  selectionHash: string;
  contextText?: string;
  sensitiveField?: boolean;
  passiveSelectionEnvironment?: PassiveSelectionEnvironment;
  rect?: ViewportRect;
}

export const MAX_SELECTION_LENGTH = 32_000;
