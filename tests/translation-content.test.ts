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
});
