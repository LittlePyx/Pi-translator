/** Keep disclosure menus reachable in short windows, including after scrolling. */
export function bindAnchoredMenus(menuSelector: string, panelSelector: string): void {
  function place(menu: HTMLDetailsElement): void {
    if (!menu.open) return;
    const anchor = menu.querySelector<HTMLElement>(':scope > summary');
    const panel = menu.querySelector<HTMLElement>(panelSelector);
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (rect.bottom < 0 || rect.top > height) { menu.open = false; return; }
    Object.assign(panel.style, {
      position: 'fixed', right: 'auto', bottom: 'auto', zIndex: '60',
      maxWidth: `${Math.max(0, width - 16)}px`, boxSizing: 'border-box',
      overflowY: 'auto',
    });
    const below = Math.max(0, height - rect.bottom - 16);
    const above = Math.max(0, rect.top - 16);
    const desired = Math.min(440, panel.scrollHeight + 2);
    const upwards = below < desired && above > below;
    panel.style.maxHeight = `${Math.min(440, upwards ? above : below)}px`;
    const size = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right - size.width, width - size.width - 8))}px`;
    panel.style.top = `${upwards ? rect.top - size.height - 8 : rect.bottom + 8}px`;
  }
  function openMenus(): HTMLDetailsElement[] {
    return [...document.querySelectorAll<HTMLDetailsElement>(menuSelector)].filter(menu => menu.open);
  }
  // Native details toggles are delivered in a later task. Position on activation
  // before the unconstrained absolute panel can affect scrolling or be measured.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const summary = event.target.closest('summary');
    const menu = summary?.parentElement;
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches(menuSelector)) return;
    event.preventDefault();
    menu.open = !menu.open;
    if (menu.open) {
      for (const other of openMenus()) if (other !== menu) other.open = false;
      place(menu);
    }
  });
  document.addEventListener('toggle', event => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches(menuSelector) || !menu.open) return;
    for (const other of openMenus()) if (other !== menu) other.open = false;
    place(menu);
  }, true);
  document.addEventListener('pointerdown', event => {
    for (const menu of openMenus()) if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = openMenus()[0];
    if (!menu) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector<HTMLElement>(':scope > summary')?.focus({preventScroll: true});
  });
  window.addEventListener('resize', () => openMenus().forEach(place));
  document.addEventListener('scroll', event => {
    for (const menu of openMenus()) {
      const panel = menu.querySelector(panelSelector);
      if (!(event.target instanceof Node) || !panel?.contains(event.target)) place(menu);
    }
  }, true);
}
