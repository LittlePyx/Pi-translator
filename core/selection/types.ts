export type SelectionSource =
  | 'context-menu'
  | 'window-selection'
  | 'text-control'
  | 'contenteditable'
  | 'overleaf-adapter';

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
  rect?: ViewportRect;
}

export const MAX_SELECTION_LENGTH = 8_000;
