import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Opt-in: run against immutable release ZIPs, never a daily browser profile.
const packageZip = process.env.PI_RELEASE_PACKAGE_ZIP;
const fixturePath = process.env.PI_RELEASE_STORAGE_FIXTURE;
const baselines = [
  ['published', process.env.PI_RELEASE_PUBLISHED_BASELINE_ZIP],
  ['development', process.env.PI_RELEASE_DEVELOPMENT_BASELINE_ZIP],
] as const;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function extract(zip: string, destination: string, root: string) {
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Installation directory must be inside the test temporary root.');
  }
  // Validate entry names before tar extracts the explicitly supplied package.
  const entries = execFileSync('tar', ['-tf', path.resolve(zip)], { encoding: 'utf8' });
  for (const entry of entries.trim().split(/\r?\n/)) {
    if (path.isAbsolute(entry) || entry.replaceAll('\\', '/').split('/').includes('..')) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  execFileSync('tar', ['-xf', path.resolve(zip), '-C', destination]);
  return JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
}

async function launch(profile: string, install: string) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    headless: false,
    args: [`--disable-extensions-except=${install}`, `--load-extension=${install}`,
      '--no-first-run', '--no-default-browser-check'],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  // Block and count all outbound HTTP(S), including service-worker fetches.
  let networkAttempts = 0;
  await context.route(/^https?:/, route => { networkAttempts++; return route.abort(); });
  await worker.evaluate(() => {
    const g = globalThis as any, original = g.fetch.bind(g);
    g.releaseNetworkAttempts = 0;
    g.fetch = (...args: any[]) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
      if (/^https?:/i.test(url)) {
        g.releaseNetworkAttempts++;
        throw new Error('Network blocked during saved-data release acceptance');
      }
      return original(...args);
    };
  });
  const page = await context.newPage();
  const url = `chrome-extension://${extensionId}/options.html`;
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  return { context, worker, page, extensionId,
    attempts: async () => networkAttempts + await worker.evaluate(() => (globalThis as any).releaseNetworkAttempts) };
}

test('fresh installation loads the exact 0.16.0 ZIP without provider calls', async ({}, info) => {
  test.skip(!packageZip, 'Set PI_RELEASE_PACKAGE_ZIP to the final ZIP.');
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(tmpdir(), 'pi-release-fresh-'));
  let context: BrowserContext | undefined;
  try {
    const manifest = await extract(packageZip!, path.join(root, 'extension'), root);
    expect(manifest.version).toBe('0.16.0');
    const app = await launch(path.join(root, 'profile'), path.join(root, 'extension'));
    context = app.context;
    await expect(app.page.locator('#onboarding-dialog')).toBeVisible();
    await app.page.locator('#onboarding-skip').click();
    await expect(app.page.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(app.page.locator('#status')).toContainText('已进入完整设置');
    const pdf = await context.newPage();
    await pdf.goto(`chrome-extension://${app.extensionId}/pdf.html`);
    await expect(pdf.locator('#file-input')).toBeAttached();
    await app.page.screenshot({ path: info.outputPath('fresh-settings.png'), fullPage: true });
    expect(await app.attempts()).toBe(0);
    await writeFile(info.outputPath('report.json'), JSON.stringify({ version: manifest.version,
      extensionId: app.extensionId, sha256: createHash('sha256').update(await readFile(packageZip!)).digest('hex'),
      providerAttempts: 0, onboarding: true, pdfReader: true }, null, 2));
  } finally {
    await context?.close();
    // root is the exact absolute directory returned by mkdtemp above.
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, baseline] of baselines) {
  test(`same-ID upgrade from ${name} 0.15.0 preserves saved results and corrections`, async ({}, info) => {
    test.skip(!packageZip || !baseline || !fixturePath, 'Set final ZIP, baseline ZIP and storage fixture paths.');
    test.setTimeout(180_000);
    const fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
    const root = await mkdtemp(path.join(tmpdir(), `pi-release-upgrade-${name}-`));
    const install = path.join(root, 'extension'), profile = path.join(root, 'profile');
    let context: BrowserContext | undefined;
    try {
      expect((await extract(baseline!, install, root)).version).toBe('0.15.0');
      const old = await launch(profile, install);
      context = old.context;
      expect(await old.worker.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version)).toBe('0.15.0');
      await expect(old.page.locator('#onboarding-dialog')).toBeVisible();
      await old.page.locator('#onboarding-skip').click();
      await expect(old.page.locator('#onboarding-dialog')).not.toBeVisible();
      await expect(old.page.locator('#status')).toContainText('已进入完整设置');
      await old.worker.evaluate(async (values) => {
        await (globalThis as any).chrome.storage.local.set(values);
      }, fixture.local);
      const keys = Object.keys(fixture.local);
      const before = await old.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      expect(before).toEqual(fixture.local);
      expect((await extract(packageZip!, install, root)).version).toBe('0.16.0');
      // Unpacked extensions require Reload to replace their cached worker code;
      // replacing files and restarting Edge alone can execute the old worker.
      const reloadedWorker = context.waitForEvent('serviceworker', worker => worker !== old.worker);
      await old.worker.evaluate(() => (globalThis as any).chrome.runtime.reload()).catch(error => {
        if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message)) throw error;
      });
      const newWorker = await reloadedWorker;
      expect(await newWorker.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version)).toBe('0.16.0');
      expect(await newWorker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys)).toEqual(before);
      await context.close(); context = undefined;

      const upgraded = await launch(profile, install);
      context = upgraded.context;
      expect(upgraded.extensionId).toBe(old.extensionId);
      await expect(upgraded.page.locator('#onboarding-dialog')).not.toBeVisible();
      const after = await upgraded.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      await writeFile(info.outputPath('after-upgrade.json'), JSON.stringify(after, null, 2));
      expect(after).toEqual(before);
      await upgraded.page.locator('[data-settings-target="storage"]').click();
      const entries = upgraded.page.locator('.library-entry');
      try {
        await expect(entries).toHaveCount(fixture.documentCount);
      } catch (error) {
        await writeFile(info.outputPath('library-error.txt'), await upgraded.page.locator('body').innerText());
        await upgraded.page.screenshot({ path: info.outputPath('library-error.png'), fullPage: true });
        throw error;
      }
      const pdf = await context.newPage();
      await pdf.goto(`chrome-extension://${upgraded.extensionId}/pdf.html?library=${encodeURIComponent(fixture.openDocumentId)}`);
      await expect(pdf.locator('.pdf-document-translation-block')).toHaveCount(fixture.visibleBlockCount);
      await expect(pdf.locator('.katex').first()).toBeVisible();
      await pdf.screenshot({ path: info.outputPath('upgraded-saved-formulas.png'), fullPage: true });
      await expect.poll(async () => upgraded.worker.evaluate(async () =>
        Object.keys((await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1).length))
        .toBe(Object.keys(before.piPdfReadingStatesV1).length + 1);
      await pdf.close();
      await upgraded.page.locator('#library-storage-tools > summary').click();
      const pending = upgraded.page.waitForEvent('download');
      await upgraded.page.locator('#export-library-backup').click();
      await (await pending).saveAs(info.outputPath('library-backup.json'));
      const backup = JSON.parse(await readFile(info.outputPath('library-backup.json'), 'utf8'));
      expect(backup.version).toBe(3);
      expect(backup.documents).toHaveLength(fixture.documentCount);
      for (const record of fixture.local.pdfDocumentTranslationRetainedV1) {
        const exported = backup.documents.find((entry: any) => entry.record.documentKey === record.documentKey);
        expect(exported.record.blocks).toEqual(record.blocks);
        expect(exported.record.archivedBlocks).toEqual(record.archivedBlocks);
        expect(exported.record.documentSignatures).toEqual(record.documentSignatures);
      }
      expect(backup.documentTerms).toEqual(fixture.local.documentTranslationMemoryV1);
      expect(backup.webExcerpts).toEqual(fixture.local.piWebExcerptsV1);
      expect(JSON.stringify(backup)).not.toContain('release-upgrade-test-key');
      const afterOpen = await upgraded.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      const { piPdfReadingStatesV1: oldPositions, ...oldPayloads } = before;
      const { piPdfReadingStatesV1: newPositions, ...newPayloads } = afterOpen;
      expect(newPayloads).toEqual(oldPayloads);
      for (const key of Object.keys(oldPositions)) expect(newPositions[key]).toEqual(oldPositions[key]);
      const addedPositions = Object.keys(newPositions).filter(key => !(key in oldPositions));
      expect(addedPositions).toHaveLength(1);
      expect(newPositions[addedPositions[0]!].translation).toMatchObject({ mode: 'reading',
        signature: fixture.local.pdfDocumentTranslationRetainedV1.find((r: any) =>
          fixture.openDocumentId.includes(r.documentKey)).documentSignatures[0] });
      expect(await upgraded.attempts()).toBe(0);
      await context.close(); context = undefined;
      const restarted = await launch(profile, install);
      context = restarted.context;
      expect(restarted.extensionId).toBe(old.extensionId);
      expect(await restarted.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys)).toEqual(afterOpen);
      expect(await restarted.attempts()).toBe(0);
      await writeFile(info.outputPath('report.json'), JSON.stringify({ baseline: name,
        baselineSha256: createHash('sha256').update(await readFile(baseline!)).digest('hex'),
        packageSha256: createHash('sha256').update(await readFile(packageZip!)).digest('hex'),
        extensionId: old.extensionId, oldVersion: '0.15.0', newVersion: '0.16.0',
        protectedKeys: keys, wholeLocalValuesUnchangedAtUpgrade: true, secondRestart: true,
        savedPayloadsAndOldPositionsUnchangedAfterReading: true, newReadingAnchors: addedPositions,
        backupVersion: backup.version, actualSavedResultsReplayed: fixture.actualSavedResults,
        providerAttempts: 0 }, null, 2));
    } finally {
      await context?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
