import { describe, expect, it } from 'vitest';
import { buildLocalDiagnosticReport } from '../core/diagnostics/local-report';

describe('local diagnostic report', () => {
  it('contains stage aggregates while dropping caller-provided sensitive fields', () => {
    const report = buildLocalDiagnosticReport({
      generatedAt: '2026-08-09T00:00:00.000Z',
      version: '0.10.0',
      manifestVersion: 3,
      build: { buildId: 'a'.repeat(64), builtAt: '2026-10-13T00:00:00.000Z', commit: 'b'.repeat(40), sourcePath: 'private workspace' },
      apiState: {
        profileCount: 2,
        apiKeyConfigured: true,
        apiPermissionGranted: true,
      },
      performanceContext: { streaming: true, autoRenderLatex: true },
      recentErrors: [],
      recentPerformance: [{
        schemaVersion: 1,
        operation: 'translate-text',
        timings: {
          providerFirstOutputMs: 250,
          providerMs: 800,
          commitMs: 12,
          maintenanceMs: 20,
          totalMs: 900,
        },
      }],
      apiKey: 'sk-private',
      apiUrl: 'https://private.example/v1',
      model: 'private-model',
      selectedText: 'unpublished paper',
      formula: String.raw`\mathbb{Q}`,
    } as never);

    expect(report).toContain('providerFirstOutputMs');
    expect(report).toContain('performanceSummary');
    expect(JSON.parse(report).build.buildId).toBe('a'.repeat(64));
    expect(report).not.toContain('private workspace');
    for (const sensitive of [
      'sk-private',
      'private.example',
      'private-model',
      'unpublished paper',
      String.raw`\mathbb{Q}`,
    ]) {
      expect(report).not.toContain(sensitive);
    }
  });
});
