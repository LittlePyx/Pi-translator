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
});
