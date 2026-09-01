import type {
  PublicSettings,
  PublicSettingsResponse,
  RuntimeMessage,
} from '../messaging/messages';
import { errorResponse } from './runtime-response';
import type { RuntimeMessageHandlers } from './runtime-message-router';

type LocalPerformancePayload = Extract<
  RuntimeMessage,
  { type: 'RECORD_LOCAL_PERFORMANCE' }
>['payload'];

export interface UtilityMessageHandlerContext {
  getPublicSettings(): Promise<PublicSettings>;
  recordLocalPerformance(payload: LocalPerformancePayload): Promise<void>;
  getLocalDiagnosticReport(): Promise<string>;
}

type UtilityMessageType =
  | 'GET_PUBLIC_SETTINGS'
  | 'RENDER_LATEX_MATHML'
  | 'RENDER_LATEX_MATHML_BATCH'
  | 'RECORD_LOCAL_PERFORMANCE'
  | 'GET_LOCAL_DIAGNOSTIC_REPORT';

export function createUtilityMessageHandlers(
  context: UtilityMessageHandlerContext,
): Required<Pick<RuntimeMessageHandlers, UtilityMessageType>> {
  return {
    GET_PUBLIC_SETTINGS: async (): Promise<PublicSettingsResponse> => ({
      ok: true,
      data: await context.getPublicSettings(),
    }),
    RENDER_LATEX_MATHML: async (message) => {
      const tex = message.payload.tex.trim();
      if (!tex || tex.length > 10_000) return { ok: true as const, data: {} };
      try {
        const { renderLatexMathMl } = await import('../translation/latex-mathml');
        const html = renderLatexMathMl(tex, message.payload.displayMode);
        return { ok: true as const, data: { ...(html ? { html } : {}) } };
      } catch {
        return { ok: true as const, data: {} };
      }
    },
    RENDER_LATEX_MATHML_BATCH: async (message) => {
      const items = message.payload.items.slice(0, 64);
      try {
        const { renderLatexMathMl } = await import('../translation/latex-mathml');
        return {
          ok: true as const,
          data: {
            html: items.map((item) => {
              const tex = item.tex.trim();
              if (!tex || tex.length > 10_000) return null;
              return renderLatexMathMl(tex, item.displayMode) ?? null;
            }),
          },
        };
      } catch {
        return {
          ok: true as const,
          data: { html: items.map(() => null) },
        };
      }
    },
    RECORD_LOCAL_PERFORMANCE: async (message) => {
      await context.recordLocalPerformance(message.payload);
      return { ok: true as const, data: { recorded: true as const } };
    },
    GET_LOCAL_DIAGNOSTIC_REPORT: async () => {
      try {
        const report = await context.getLocalDiagnosticReport();
        return { ok: true as const, data: { report } };
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
