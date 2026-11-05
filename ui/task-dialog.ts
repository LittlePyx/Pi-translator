/** Keep the task and its actions visible while long previews/forms scroll. */
export function layoutTaskDialog(
  dialog: HTMLDialogElement,
  title: HTMLElement,
  content: readonly Node[],
  actions: HTMLElement,
  status?: HTMLElement,
  form?: HTMLFormElement,
): void {
  dialog.classList.add('pi-task-dialog');
  const layout = form ?? dialog;
  layout.classList.add('pi-task-layout');
  const header = document.createElement('header');
  const body = document.createElement('div');
  const footer = document.createElement('footer');
  header.className = 'pi-task-heading';
  body.className = 'pi-task-body';
  footer.className = 'pi-task-footer';
  header.append(title);
  body.append(...content);
  if (status) footer.append(status);
  footer.append(actions);
  layout.replaceChildren(header, body, footer);
  if (form) dialog.replaceChildren(form);
}
