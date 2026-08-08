import {
  aggregateLocalPerformanceSamples,
  findSlowPerformanceWarnings,
  type LocalDiagnosticEvent,
  type LocalPerformanceSampleV1,
} from './event-log';

export interface LocalDiagnosticReportInput {
  generatedAt: string;
  version: string;
  manifestVersion: number;
  apiState: {
    profileCount: number;
    apiKeyConfigured: boolean;
    apiPermissionGranted: boolean;
  };
  performanceContext: {
    streaming: boolean;
    autoRenderLatex: boolean;
  };
  recentErrors: LocalDiagnosticEvent[];
  recentPerformance: LocalPerformanceSampleV1[];
}

/**
 * Builds the user-copyable report from an explicit content-free allowlist.
 * Unknown caller fields are intentionally ignored rather than serialized.
 */
export function buildLocalDiagnosticReport(input: LocalDiagnosticReportInput): string {
  const {
    generatedAt,
    version,
    manifestVersion,
    apiState,
    performanceContext,
    recentErrors,
    recentPerformance,
  } = input;
  return JSON.stringify({
    reportSchemaVersion: 2,
    product: 'Pi Translator',
    generatedAt,
    version,
    manifestVersion,
    apiState,
    performanceContext,
    recentErrors,
    recentPerformance,
    performanceSummary: aggregateLocalPerformanceSamples(recentPerformance),
    slowStageWarnings: findSlowPerformanceWarnings(recentPerformance),
    privacy: 'This local session report contains only fixed operation names, timing values, error codes, and coarse capability state. It excludes API Keys, API URLs, profile names, models, selected text, translations, page URLs, glossary entries, images, formulas, and site names.',
  }, null, 2);
}
