const PDF_READING_STATES_KEY = 'piPdfReadingStatesV1';
const MAX_PDF_READING_STATES = 30;

export interface PdfReadingState {
  pageNumber: number;
  pageRatio: number;
  zoomLevel: number;
  fitWidth: boolean;
  sidebarExpanded: boolean;
  updatedAt: number;
}

type PdfReadingStateMap = Record<string, PdfReadingState>;

export function normalizePdfReadingState(value: unknown): PdfReadingState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<PdfReadingState>;
  if (
    typeof state.pageNumber !== 'number' ||
    !Number.isFinite(state.pageNumber) ||
    typeof state.pageRatio !== 'number' ||
    !Number.isFinite(state.pageRatio) ||
    typeof state.zoomLevel !== 'number' ||
    !Number.isFinite(state.zoomLevel)
  ) return undefined;
  return {
    pageNumber: Math.max(1, Math.round(state.pageNumber)),
    pageRatio: Math.min(1, Math.max(0, state.pageRatio)),
    zoomLevel: Math.min(3, Math.max(0.5, state.zoomLevel)),
    fitWidth: state.fitWidth === true,
    sidebarExpanded: state.sidebarExpanded === true,
    updatedAt:
      typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
        ? state.updatedAt
        : Date.now(),
  };
}

export async function pdfReadingStateId(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stateMap(value: unknown): PdfReadingStateMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) => {
      const normalized = normalizePdfReadingState(candidate);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

export async function getPdfReadingState(
  identity: string,
): Promise<PdfReadingState | undefined> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_READING_STATES_KEY),
  ]);
  return stateMap(stored[PDF_READING_STATES_KEY])[id];
}

export async function savePdfReadingState(
  identity: string,
  state: PdfReadingState,
): Promise<void> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_READING_STATES_KEY),
  ]);
  const states = stateMap(stored[PDF_READING_STATES_KEY]);
  states[id] = normalizePdfReadingState(state)!;
  const retained = Object.fromEntries(
    Object.entries(states)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PDF_READING_STATES),
  );
  await browser.storage.local.set({ [PDF_READING_STATES_KEY]: retained });
}
