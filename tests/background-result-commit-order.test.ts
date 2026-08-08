import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backgroundSource = readFileSync(
  fileURLToPath(new URL('../entrypoints/background.ts', import.meta.url)),
  'utf8',
);

function functionSource(start: string, end: string): string {
  const startIndex = backgroundSource.indexOf(start);
  const endIndex = backgroundSource.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return backgroundSource.slice(startIndex, endIndex);
}

function expectHeadBeforeMaintenance(source: string, expectedCommits: number): void {
  const commitIndexes = [...source.matchAll(/await commitTranslationResultState\(/g)]
    .map((match) => match.index);
  const maintenanceIndexes = [...source.matchAll(/await settleTranslationFinalization\(/g)]
    .map((match) => match.index);

  expect(commitIndexes).toHaveLength(expectedCommits);
  expect(maintenanceIndexes).toHaveLength(expectedCommits);
  for (let index = 0; index < expectedCommits; index += 1) {
    expect(commitIndexes[index]).toBeLessThan(maintenanceIndexes[index]!);
  }
}

describe('background result commit ordering', () => {
  it('commits cached and provider text results before best-effort maintenance', () => {
    const source = functionSource('async function translate(', 'function correctionTermSourceKey(');
    expectHeadBeforeMaintenance(source, 2);
  });

  it('uses the lifecycle-safe result commit for cached and provider image results', () => {
    const source = functionSource(
      'async function translateImageRegion(',
      'async function testConnection(',
    );
    expectHeadBeforeMaintenance(source, 2);
    expect(source).not.toMatch(/await writeTranslationHead\(/);
  });

  it('checks lifecycle after writing the head so stale writes enter rollback', () => {
    const source = functionSource(
      'async function commitTranslationResultState(',
      'async function settleTranslationFinalization(',
    );
    const writeIndex = source.indexOf('await writeTranslationHead(nextHead)');
    const durableSessionIndex = source.indexOf('await publishPdfSidePanelSessionDurably');
    const noSessionAssertionIndex = source.indexOf('assertCurrent();', durableSessionIndex);
    const rollbackIndex = source.indexOf('catch (error)');

    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(durableSessionIndex).toBeGreaterThan(writeIndex);
    expect(noSessionAssertionIndex).toBeGreaterThan(durableSessionIndex);
    expect(rollbackIndex).toBeGreaterThan(noSessionAssertionIndex);
  });

  it('clears the previous result head whenever a tab document is invalidated', () => {
    const source = functionSource(
      'browser.tabs.onUpdated.addListener(',
      'browser.runtime.onMessage.addListener(',
    );
    const invalidations = [...source.matchAll(/tabLifecycles\.invalidate\(tabId\)/g)];
    const headClears = [...source.matchAll(/clearTranslationHead\(tabId\)/g)];

    expect(invalidations).toHaveLength(3);
    expect(headClears).toHaveLength(invalidations.length);
  });
});
