export interface SidebarObstructionInput {
  viewportWidth: number;
  insetLeft: number;
  insetRight: number;
  sidebarWidth: number;
  meaningfulContentCovered: boolean;
}

export function shouldSuggestBrowserSidebar(input: SidebarObstructionInput): boolean {
  const availableWidth = Math.max(
    0,
    input.viewportWidth - input.insetLeft - input.insetRight,
  );
  if (availableWidth < 840 || input.sidebarWidth <= 340) return false;
  const sidebarWidth = Math.min(availableWidth, Math.max(0, input.sidebarWidth));
  const occupiedRatio = sidebarWidth / availableWidth;
  const remainingWidth = availableWidth - sidebarWidth;
  if (occupiedRatio >= 0.3) return true;
  return input.meaningfulContentCovered &&
    occupiedRatio >= 0.24 &&
    remainingWidth < 1_100;
}
