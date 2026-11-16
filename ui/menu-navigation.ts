/** Share keyboard behavior between native pages and shadow-root translation menus. */
export function bindMenuNavigation(root: Document | ShadowRoot, selector: string): () => void {
  let disposed = false;
  const items = (menu: HTMLDetailsElement) => [...menu.querySelectorAll<HTMLElement>('button,a[href]')]
    .filter(item => !item.matches(':disabled,[aria-disabled="true"]') && item.getClientRects().length > 0);
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const origin = event.composedPath()[0];
    if (!(origin instanceof Element) || origin.closest('input,select,textarea') ||
      (origin instanceof HTMLElement && origin.isContentEditable)) return;
    const menu = origin.closest<HTMLDetailsElement>(selector);
    if (!menu) return;
    const summary = menu.querySelector<HTMLElement>(':scope > summary');
    if (!menu.open) {
      if (origin !== summary || !['ArrowDown','ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      summary.click();
      requestAnimationFrame(() => {
        if (disposed || !menu.isConnected || !menu.open) return;
        const actions = items(menu);
        (event.key === 'ArrowUp' ? actions.at(-1) : actions[0])?.focus();
      });
      return;
    }
    const actions = items(menu);
    if (!actions.length) return;
    const index = actions.findIndex(item => item === origin || item.contains(origin));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
      : index < 0 ? event.key === 'ArrowUp' ? actions.length - 1 : 0
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length;
    event.preventDefault();
    event.stopPropagation();
    actions[next]?.focus();
  };
  const focusin = (event: FocusEvent) => {
    const origin = event.composedPath()[0];
    if (!(origin instanceof Node)) return;
    if (origin instanceof Element && origin.closest('dialog[open]')) return;
    for (const menu of root.querySelectorAll<HTMLDetailsElement>(selector)) {
      if (menu.open && !menu.contains(origin)) menu.open = false;
    }
  };
  root.addEventListener('keydown', keydown as EventListener);
  root.addEventListener('focusin', focusin as EventListener);
  return () => {
    disposed = true;
    root.removeEventListener('keydown', keydown as EventListener);
    root.removeEventListener('focusin', focusin as EventListener);
  };
}
