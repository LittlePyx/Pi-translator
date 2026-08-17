export const TRANSLATE_SELECTION_COMMAND = 'translate-selection';

export interface ExtensionCommandDescriptor {
  name?: string;
  shortcut?: string;
}

export function assignedTranslationShortcut(
  commands: readonly ExtensionCommandDescriptor[],
): string | undefined {
  const shortcut = commands.find(
    (command) => command.name === TRANSLATE_SELECTION_COMMAND,
  )?.shortcut?.trim();
  return shortcut || undefined;
}

export function shortcutKeyParts(shortcut: string): string[] {
  return shortcut.split('+').map((part) => part.trim()).filter(Boolean);
}
