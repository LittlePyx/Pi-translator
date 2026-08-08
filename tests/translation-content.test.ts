import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTranslationContents } from '../ui/translation-content';

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  add(...names: string[]): void {
    const values = new Set(this.owner.className.split(/\s+/u).filter(Boolean));
    names.forEach((name) => values.add(name));
    this.owner.className = [...values].join(' ');
  }
}

class FakeNode {
  children: FakeNode[] = [];
  isConnected = true;
  textContent = '';

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [...nodes];
  }
}

class FakeElement extends FakeNode {
  className = '';
  classList = new FakeClassList(this);
  innerHTML = '';

  constructor(readonly tagName: string) {
    super();
  }
}

class FakeTextNode extends FakeNode {
  constructor(value: string) {
    super();
    this.textContent = value;
  }
}

function installFakeDom(): void {
  vi.stubGlobal('document', {
    createElement: (tagName: string) => new FakeElement(tagName),
    createTextNode: (text: string) => new FakeTextNode(text),
  });
}

function installFakeTiming(...timestamps: number[]): ReturnType<typeof vi.fn> {
  const now = vi.fn();
  timestamps.forEach((timestamp) => now.mockReturnValueOnce(timestamp));
  now.mockReturnValue(timestamps.at(-1) ?? 0);
  vi.stubGlobal('performance', { now });
  return now;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared translation content renderer', () => {
  it('aggregates formulae from several containers into one runtime message', async () => {
    installFakeDom();
    const sendMessage = vi.fn(async (message: {
      payload: { items: Array<{ tex: string; displayMode: boolean }> };
    }) => ({
      ok: true,
      data: { html: message.payload.items.map((_item, index) => `<math>${index}</math>`) },
    }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const first = new FakeElement('div');
    const second = new FakeElement('div');

    renderTranslationContents([
      {
        container: first as unknown as HTMLElement,
        text: '**左侧 $x$ 右侧**',
        renderLatex: true,
      },
      {
        container: second as unknown as HTMLElement,
        text: String.raw`\[y=z\tag{(8)}\]`,
        renderLatex: true,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'RENDER_LATEX_MATHML_BATCH',
      payload: {
        items: [
          { tex: 'x', displayMode: false },
          { tex: 'y=z', displayMode: true },
        ],
      },
    });
    expect(first.children.map((child) => (
      child instanceof FakeElement ? [child.tagName, child.className, child.textContent] : child.textContent
    ))).toEqual([
      ['strong', 'pi-rich-strong', '左侧 '],
      ['span', 'pi-math pi-math-inline pi-rich-strong', '$x$'],
      ['strong', 'pi-rich-strong', ' 右侧'],
    ]);
    const numbered = second.children[0] as FakeElement;
    expect(numbered.className).toContain('pi-math-numbered');
    expect((numbered.children[1] as FakeElement).textContent).toBe('(8)');
  });

  it('uses one effective display mode through strong markup, DOM, tags, and MathML jobs', async () => {
    installFakeDom();
    const sendMessage = vi.fn(async (message: {
      payload: { items: Array<{ tex: string; displayMode: boolean }> };
    }) => ({
      ok: true,
      data: { html: message.payload.items.map((_item, index) => `<math>${index}</math>`) },
    }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const display = new FakeElement('div');
    const inline = new FakeElement('div');
    const source = String.raw`**$Q^{\Pi^*}=\operatorname{argmin}_{P\in\mathcal{P}(V,\Omega)}\left\{KL(P\|Q)\right\}\tag{8}$**`;

    renderTranslationContents([
      {
        container: display as unknown as HTMLElement,
        text: source,
        renderLatex: true,
      },
      {
        container: inline as unknown as HTMLElement,
        text: 'Ordinary **$x+y$** prose.',
        renderLatex: true,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'RENDER_LATEX_MATHML_BATCH',
      payload: {
        items: [
          {
            tex: String.raw`Q^{\Pi^*}=\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)}\left\{KL(P\|Q)\right\}`,
            displayMode: true,
          },
          { tex: 'x+y', displayMode: false },
        ],
      },
    });
    const numbered = display.children[0] as FakeElement;
    expect(numbered.tagName).toBe('div');
    expect(numbered.className).toContain('pi-math-display');
    expect(numbered.className).toContain('pi-rich-strong');
    expect(numbered.className).toContain('pi-math-numbered');
    expect((numbered.children[1] as FakeElement).textContent).toBe('(8)');
    expect((inline.children[1] as FakeElement).tagName).toBe('span');
    expect((inline.children[1] as FakeElement).className).toContain('pi-math-inline');
    expect(source).toContain(String.raw`\operatorname{argmin}_`);
  });

  it('reports synchronous text timing exactly once when no formula needs rendering', async () => {
    installFakeDom();
    installFakeTiming(10, 16);
    const sendMessage = vi.fn();
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const callback = vi.fn();
    const container = new FakeElement('div');

    const metrics = await renderTranslationContents([
      {
        container: container as unknown as HTMLElement,
        text: 'Plain translated text.',
        renderLatex: true,
      },
    ], callback);

    expect(metrics).toEqual({
      textRenderMs: 6,
      mathRenderMs: 0,
      mathBatchCount: 0,
      mathRenderFailed: false,
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(metrics);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('waits for every MathML batch before reporting render timing', async () => {
    installFakeDom();
    installFakeTiming(100, 107, 151);
    const first = deferred<{
      ok: true;
      data: { html: string[] };
    }>();
    const second = deferred<{
      ok: true;
      data: { html: string[] };
    }>();
    const sendMessage = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const callback = vi.fn();
    const container = new FakeElement('div');
    const render = renderTranslationContents([
      {
        container: container as unknown as HTMLElement,
        text: Array.from({ length: 65 }, (_, index) => `$x_{${index}}$`).join(' '),
        renderLatex: true,
      },
    ], callback);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    second.resolve({ ok: true, data: { html: ['<math>last</math>'] } });
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
    first.resolve({
      ok: true,
      data: { html: Array.from({ length: 64 }, () => '<math>item</math>') },
    });

    await expect(render).resolves.toEqual({
      textRenderMs: 7,
      mathRenderMs: 44,
      mathBatchCount: 2,
      mathRenderFailed: false,
    });
    expect(callback).toHaveBeenCalledOnce();
  });

  it('settles and reports a failed MathML batch without exposing render input', async () => {
    installFakeDom();
    installFakeTiming(20, 23, 31);
    const sendMessage = vi.fn(async () => {
      throw new Error('private formula and translated text');
    });
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const callback = vi.fn();
    const container = new FakeElement('div');

    const metrics = await renderTranslationContents([
      {
        container: container as unknown as HTMLElement,
        text: '$private_formula$',
        renderLatex: true,
      },
    ], callback);

    expect(metrics).toEqual({
      textRenderMs: 3,
      mathRenderMs: 8,
      mathBatchCount: 1,
      mathRenderFailed: true,
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(JSON.stringify(callback.mock.calls)).not.toContain('private_formula');
  });

  it('treats an empty MathML renderer result as a render failure', async () => {
    installFakeDom();
    installFakeTiming(40, 43, 49);
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: { html: [null] },
    }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const callback = vi.fn();
    const container = new FakeElement('div');

    const metrics = await renderTranslationContents([{
      container: container as unknown as HTMLElement,
      text: '$unsupported_formula$',
      renderLatex: true,
    }], callback);

    expect(metrics).toEqual({
      textRenderMs: 3,
      mathRenderMs: 6,
      mathBatchCount: 1,
      mathRenderFailed: true,
    });
    expect(callback).toHaveBeenCalledWith(metrics);
  });
});
