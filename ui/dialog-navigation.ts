/** Let the focused dialog handle keys before background reading controls. */
export function keyEventDialog(event:KeyboardEvent):HTMLDialogElement|undefined {
  return event.composedPath().find((node):node is HTMLDialogElement=>node instanceof HTMLDialogElement&&node.open)
    // Disabling a focused Save button can leave focus on the inert document body.
    ??document.querySelector<HTMLDialogElement>('dialog:modal')??undefined;
}

/** Menu actions can hide themselves before opening their dialog. */
export function dialogReturnTarget():HTMLElement|undefined {
  const origin=document.activeElement;
  if(!(origin instanceof HTMLElement))return;
  return origin.closest('details:not([open])')?.querySelector<HTMLElement>(':scope > summary')??origin;
}
