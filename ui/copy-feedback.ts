/** Keep brief feedback in the action row; detailed announcements remain in its live region. */
export function setCopyStateLabel(button: HTMLElement, text: string): void {
  const footer = button.closest('.result-footer,.session-actions');
  if (!footer || button.parentElement !== footer) return;
  let label = footer.querySelector<HTMLElement>('.copy-state-label');
  if (!label && text) {
    label = document.createElement('span');
    label.className = 'copy-state-label';
    label.ariaHidden = 'true';
    button.after(label);
  }
  if (label) label.textContent = text;
}
