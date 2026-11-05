import {writeFile} from 'node:fs/promises';
import {context,createTwoPageTextPdf,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

// Fixed, distinct trigger hypotheses. Each scenario runs once, with retries off.
const scenarios = ['pointer-theme', 'space-escape', 'pending-toggle', 'task-completion', 'window-focus'] as const;
for (const scenario of scenarios) {
  test(`keeps the PDF translation menu closed after ${scenario}`, async ({}, testInfo) => {
    const reader = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    const url = 'https://www.overleaf.com/pi-translator-e2e-api/chat/completions';
    const handler = async (route: import('@playwright/test').Route) => {
      requests++;
      const body = route.request().postDataJSON();
      const user = JSON.parse(body.messages.find((message: {role: string}) => message.role === 'user').content);
      await gate;
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: JSON.stringify({
        translation: '固定模拟译文。', detectedLanguage: 'en', warnings: [],
        segments: user.segments.map((segment: {id: string}) => ({id: segment.id, translation: '这段说明用于固定菜单状态验收。'})),
      })}}]})});
    };
    await context.route(url, handler);
    await reader.addInitScript(() => {
      const scope = globalThis as any;
      scope.piMenuEvents = [];
      const record = (value: object) => scope.piMenuEvents.push({time: performance.now(), open: (document.getElementById('pdf-document-translation-copy-menu') as HTMLDetailsElement | null)?.open, active: document.activeElement?.id || document.activeElement?.tagName, ...value});
      const property = Object.getOwnPropertyDescriptor(HTMLDetailsElement.prototype, 'open')!;
      Object.defineProperty(HTMLDetailsElement.prototype, 'open', {...property, set(value) {
        if ((this as HTMLDetailsElement).id === 'pdf-document-translation-copy-menu') record({kind: 'write', value, stack: Error().stack});
        property.set!.call(this, value);
      }});
      for (const name of ['click', 'keydown', 'keyup', 'focusin', 'focusout', 'beforetoggle', 'toggle']) document.addEventListener(name, event => {
        const target = event.target as HTMLElement;
        if (target?.closest?.('#pdf-document-translation-copy-menu')) record({kind: name, target: target.id || target.tagName, key: (event as KeyboardEvent).key, trusted: event.isTrusted});
      }, true);
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(changes => changes.forEach(change => record({kind: 'attribute', old: change.oldValue}))).observe(document.getElementById('pdf-document-translation-copy-menu')!, {attributes: true, attributeFilter: ['open'], attributeOldValue: true});
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => record({kind: 'theme', dark: event.matches}));
        window.addEventListener('focus', () => record({kind: 'window-focus'}));
        window.addEventListener('blur', () => record({kind: 'window-blur'}));
      });
    });
    try {
      await reader.setViewportSize({width: scenario === 'space-escape' ? 360 : 1300, height: 1000});
      await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
      await reader.locator('#file-input').setInputFiles({name: `menu-${scenario}.pdf`, mimeType: 'application/pdf', buffer: createTwoPageTextPdf('This paragraph describes a controlled experiment.', 'The second paragraph explains the evaluation settings.')});
      await reader.locator('#translate-document').click();
      await reader.locator('#pdf-document-translation-primary').click();
      await expect.poll(() => requests).toBe(1);
      const menu = reader.locator('#pdf-document-translation-copy-menu');
      const summary = menu.locator(':scope > summary');
      if (scenario === 'space-escape') await summary.press('Space');
      else await summary.click();
      await expect(menu).toHaveAttribute('open');
      if (scenario === 'pending-toggle') {
        // Open/close in one task, before the queued native toggle is delivered.
        await reader.evaluate(() => {
          const menu = document.getElementById('pdf-document-translation-copy-menu') as HTMLDetailsElement;
          menu.open = false; menu.open = true;
          menu.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
        });
      } else {
        await reader.locator('#pdf-document-translation-clear').focus();
        await reader.keyboard.press('Escape');
      }
      await expect(menu).not.toHaveAttribute('open');
      await expect(summary).toBeFocused();
      if (scenario === 'task-completion') {
        release();
        await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
      }
      if (scenario === 'window-focus') {
        const other = await context.newPage();
        try { await other.bringToFront(); await reader.bringToFront(); } finally { await other.close(); }
      }
      await reader.mouse.move(0, 0);
      await reader.screenshot({path: testInfo.outputPath('closed-light.png')});
      await expect(menu).not.toHaveAttribute('open');
      await reader.emulateMedia({colorScheme: 'dark'});
      await reader.screenshot({path: testInfo.outputPath('closed-dark.png')});
      await expect(menu).not.toHaveAttribute('open');
      await expect(reader.locator('#pdf-document-translation-clear')).toBeHidden();
      await reader.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(menu).not.toHaveAttribute('open');
      const phase = await reader.locator('#pdf-document-translation').getAttribute('data-phase');
      await summary.click(); await expect(menu).toHaveAttribute('open');
      await reader.locator('.pdf-document-translation-title').click();
      await expect(menu).not.toHaveAttribute('open');
      expect(await reader.locator('#pdf-document-translation').getAttribute('data-phase')).toBe(phase);
      expect(requests).toBe(1);
    } finally {
      release();
      if (!reader.isClosed()) await writeFile(testInfo.outputPath('menu-events.json'), JSON.stringify(await reader.evaluate(() => (globalThis as any).piMenuEvents), null, 2));
      await reader.close();
      await context.unroute(url, handler);
    }
  });
}
