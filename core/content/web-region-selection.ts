import { isSensitiveTextControl } from '../selection/selection-context';
import { MAX_SELECTION_LENGTH, type ViewportRect } from '../selection/types';

export const WEB_REGION_SELECTION_ROOT_ID = 'pi-web-region-selection-root';

export type WebRegionSelectionMode = 'text' | 'image';

export interface WebRegionSelectionResult {
  rect: ViewportRect;
  mode: WebRegionSelectionMode;
  extractedText?: string;
}

export interface WebRegionSelectionHandle {
  result: Promise<WebRegionSelectionResult | undefined>;
  cancel(): void;
}

type Point = { x: number; y: number };
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type DragState =
  | { kind: 'draw'; pointerId: number; start: Point }
  | { kind: 'move'; pointerId: number; start: Point; origin: ViewportRect }
  | {
      kind: 'resize';
      pointerId: number;
      start: Point;
      origin: ViewportRect;
      handle: ResizeHandle;
    };

const MIN_REGION_EDGE = 24;
const CONTROLS_WIDTH = 340;
const CONTROLS_HEIGHT = 132;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeWebRegionRect(start: Point, end: Point): ViewportRect {
  const left = clamp(Math.min(start.x, end.x), 0, innerWidth);
  const top = clamp(Math.min(start.y, end.y), 0, innerHeight);
  const right = clamp(Math.max(start.x, end.x), 0, innerWidth);
  const bottom = clamp(Math.max(start.y, end.y), 0, innerHeight);
  return { left, top, right, bottom };
}

function rectWidth(rect: ViewportRect): number {
  return rect.right - rect.left;
}

function rectHeight(rect: ViewportRect): number {
  return rect.bottom - rect.top;
}

function intersects(left: ViewportRect, right: DOMRect): boolean {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
}

function elementExcludedFromLocalText(element: Element): boolean {
  if (element.closest(
    `#${WEB_REGION_SELECTION_ROOT_ID},#tex-selection-translator-root,script,style,noscript,template,input,textarea,select,option,button,svg,canvas`,
  )) return true;
  const style = getComputedStyle(element);
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number.parseFloat(style.opacity || '1') === 0
  );
}

function meaningfulText(value: string): boolean {
  return (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;
}

/**
 * Reads visible DOM text intersecting the box. This never accesses the
 * network and deliberately ignores form controls and Pi Translator UI.
 */
export function extractLocalTextFromWebRegion(rect: ViewportRect): string | undefined {
  if (!document.body) return undefined;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.textContent?.replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!value || !parent || elementExcludedFromLocalText(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: string[] = [];
  let length = 0;
  let inspectedCharacters = 0;
  const maxInspectedCharacters = 100_000;
  let rangeOperations = 0;
  const maxRangeOperations = 150_000;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const nodeIntersectsRegion = Array.from(range.getClientRects()).some((box) => (
      box.width > 0 && box.height > 0 && intersects(rect, box)
    ));
    if (!nodeIntersectsRegion) {
      range.detach();
      continue;
    }
    const value = node.textContent ?? '';
    let nodePart = '';
    let previousIncludedEnd: number | undefined;
    for (let chunkStart = 0; chunkStart < value.length;) {
      let chunkEnd = Math.min(value.length, chunkStart + 128);
      if (chunkEnd < value.length && /[\uD800-\uDBFF]/u.test(value[chunkEnd - 1] ?? '')) {
        chunkEnd += 1;
      }
      range.setStart(node, chunkStart);
      range.setEnd(node, chunkEnd);
      rangeOperations += 1;
      const chunkIntersects = Array.from(range.getClientRects()).some((box) => (
        box.width > 0 && box.height > 0 && intersects(rect, box)
      ));
      if (chunkIntersects) {
        let offset = chunkStart;
        for (const character of value.slice(chunkStart, chunkEnd)) {
          const start = offset;
          const end = start + character.length;
          offset = end;
          inspectedCharacters += 1;
          if (
            inspectedCharacters > maxInspectedCharacters ||
            rangeOperations > maxRangeOperations
          ) break;
          range.setStart(node, start);
          range.setEnd(node, end);
          rangeOperations += 1;
          const included = Array.from(range.getClientRects()).some((box) => (
            box.width > 0 && box.height > 0 && intersects(rect, box)
          ));
          if (!included) continue;
          if (
            previousIncludedEnd !== undefined &&
            start > previousIncludedEnd &&
            !/\s$/u.test(nodePart)
          ) nodePart += ' ';
          nodePart += character;
          previousIncludedEnd = end;
          if (length + nodePart.length >= MAX_SELECTION_LENGTH) break;
        }
      }
      chunkStart = chunkEnd;
      if (
        length + nodePart.length >= MAX_SELECTION_LENGTH ||
        inspectedCharacters > maxInspectedCharacters ||
        rangeOperations > maxRangeOperations
      ) break;
    }
    range.detach();
    const normalizedPart = nodePart.replace(/\s+/g, ' ').trim();
    if (normalizedPart) {
      const remaining = MAX_SELECTION_LENGTH - length;
      parts.push(normalizedPart.slice(0, remaining));
      length += normalizedPart.length + 1;
    }
    if (
      length >= MAX_SELECTION_LENGTH ||
      inspectedCharacters > maxInspectedCharacters ||
      rangeOperations > maxRangeOperations
    ) break;
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTION_LENGTH);
  return meaningfulText(text) ? text : undefined;
}

function containsSensitiveField(rect: ViewportRect): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(
    'input,textarea,[contenteditable="true"],[data-private="true"],[data-sensitive="true"]',
  )).some((element) => {
    const bounds = element.getBoundingClientRect();
    if (!intersects(rect, bounds)) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return isSensitiveTextControl(element);
    }
    return Boolean(element.closest('[data-private="true"],[data-sensitive="true"]'));
  });
}

function styleText(): string {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .stage {
      position: fixed;
      inset: 0;
      overflow: hidden;
      color: #f8fafc;
      background: rgba(15, 23, 42, .54);
      cursor: crosshair;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
      touch-action: none;
    }
    .stage[data-has-selection="true"] { background: transparent; }
    .intro {
      position: fixed;
      top: 18px;
      left: 50%;
      max-width: min(560px, calc(100vw - 32px));
      transform: translateX(-50%);
      padding: 9px 14px;
      border: 1px solid rgba(255, 255, 255, .24);
      border-radius: 999px;
      color: #fff;
      background: rgba(15, 23, 42, .9);
      box-shadow: 0 10px 28px rgba(15, 23, 42, .28);
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .selection {
      position: fixed;
      display: none;
      border: 2px solid #8b7cf6;
      border-radius: 4px;
      background: rgba(255, 255, 255, .04);
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, .58), 0 0 0 1px rgba(255, 255, 255, .72);
      cursor: move;
    }
    .selection[data-visible="true"] { display: block; }
    .handle {
      position: absolute;
      width: 18px;
      height: 18px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: #6558d9;
      box-shadow: 0 2px 7px rgba(15, 23, 42, .3);
    }
    .handle[data-handle="nw"] { top: -10px; left: -10px; cursor: nwse-resize; }
    .handle[data-handle="ne"] { top: -10px; right: -10px; cursor: nesw-resize; }
    .handle[data-handle="sw"] { bottom: -10px; left: -10px; cursor: nesw-resize; }
    .handle[data-handle="se"] { right: -10px; bottom: -10px; cursor: nwse-resize; }
    .controls {
      position: fixed;
      display: none;
      width: min(${CONTROLS_WIDTH}px, calc(100vw - 24px));
      padding: 11px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 10px;
      color: #e5e7eb;
      background: rgba(17, 24, 39, .97);
      box-shadow: 0 16px 40px rgba(15, 23, 42, .35);
      cursor: default;
    }
    .controls[data-visible="true"] { display: block; }
    .status { margin: 0; color: #fff; font-weight: 650; }
    .privacy { margin: 3px 0 10px; color: #aeb8c8; font-size: 11px; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
    button {
      min-height: 34px;
      border: 1px solid #4b5563;
      border-radius: 7px;
      padding: 6px 10px;
      color: #e5e7eb;
      background: #252f3f;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
    }
    button:hover:not(:disabled) { border-color: #8179eb; background: #313a4b; }
    button:focus-visible { outline: 3px solid rgba(167, 139, 250, .45); outline-offset: 2px; }
    .confirm { border-color: #7668e8; color: #fff; background: #6558d9; }
    .confirm:hover:not(:disabled) { background: #594acb; }
    button:disabled { opacity: .48; cursor: not-allowed; }
    .sensitive .status { color: #fecdd3; }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;
}

export function createWebRegionSelection(): WebRegionSelectionHandle {
  document.getElementById(WEB_REGION_SELECTION_ROOT_ID)?.remove();
  const host = document.createElement('div');
  host.id = WEB_REGION_SELECTION_ROOT_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styleText();
  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.tabIndex = -1;
  stage.setAttribute('role', 'dialog');
  stage.setAttribute('aria-label', '框选网页区域');
  stage.innerHTML = `
    <div class="intro">拖动框选网页图像或复杂内容 · Esc 取消</div>
    <div class="selection" data-visible="false">
      <span class="handle" data-handle="nw" aria-hidden="true"></span>
      <span class="handle" data-handle="ne" aria-hidden="true"></span>
      <span class="handle" data-handle="sw" aria-hidden="true"></span>
      <span class="handle" data-handle="se" aria-hidden="true"></span>
    </div>
    <section class="controls" data-visible="false" aria-label="框选确认">
      <p class="status" role="status"></p>
      <p class="privacy"></p>
      <div class="actions">
        <button class="mode" type="button"></button>
        <button class="cancel" type="button">取消</button>
        <button class="confirm" type="button"></button>
      </div>
    </section>
  `;
  shadow.append(style, stage);
  document.documentElement.append(host);

  const selection = shadow.querySelector<HTMLElement>('.selection')!;
  const controls = shadow.querySelector<HTMLElement>('.controls')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  const privacy = shadow.querySelector<HTMLElement>('.privacy')!;
  const modeButton = shadow.querySelector<HTMLButtonElement>('.mode')!;
  const cancelButton = shadow.querySelector<HTMLButtonElement>('.cancel')!;
  const confirmButton = shadow.querySelector<HTMLButtonElement>('.confirm')!;
  let currentRect: ViewportRect | undefined;
  let extractedText: string | undefined;
  let mode: WebRegionSelectionMode = 'image';
  let modeExplicitlyChosen = false;
  let sensitive = false;
  let drag: DragState | undefined;
  let settled = false;
  let resolveResult: (value: WebRegionSelectionResult | undefined) => void = () => undefined;
  const result = new Promise<WebRegionSelectionResult | undefined>((resolve) => {
    resolveResult = resolve;
  });

  function finish(value: WebRegionSelectionResult | undefined): void {
    if (settled) return;
    settled = true;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', cancel, true);
    window.removeEventListener('scroll', cancel, true);
    host.remove();
    resolveResult(value);
  }

  function cancel(): void {
    finish(undefined);
  }

  function preview(value: string): string {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  }

  function update(analyzeContent = true): void {
    const rect = currentRect;
    if (!rect) {
      stage.dataset.hasSelection = 'false';
      selection.dataset.visible = 'false';
      controls.dataset.visible = 'false';
      return;
    }
    stage.dataset.hasSelection = 'true';
    selection.dataset.visible = 'true';
    selection.style.left = `${rect.left}px`;
    selection.style.top = `${rect.top}px`;
    selection.style.width = `${rectWidth(rect)}px`;
    selection.style.height = `${rectHeight(rect)}px`;
    if (!analyzeContent) {
      controls.dataset.visible = 'false';
      return;
    }
    extractedText = extractLocalTextFromWebRegion(rect);
    sensitive = containsSensitiveField(rect);
    if (!extractedText) mode = 'image';
    else if (!modeExplicitlyChosen) mode = 'text';
    controls.classList.toggle('sensitive', sensitive);
    if (sensitive) {
      status.textContent = '框内包含密码、验证码或支付字段';
      privacy.textContent = '为避免泄露敏感信息，此区域不能发送。请调整选框。';
    } else if (mode === 'text' && extractedText) {
      status.textContent = `已在本地提取文字：“${preview(extractedText)}”`;
      privacy.textContent = '确认后只发送框内文字，不上传网页截图。';
    } else {
      status.textContent = extractedText
        ? '已切换为截图翻译'
        : '框内没有可靠的可编辑文字，将使用截图翻译';
      privacy.textContent = '确认后只截取当前可见页中的框内区域，并发送给已配置的图像接口。';
    }
    modeButton.hidden = !extractedText;
    modeButton.textContent = mode === 'text' ? '改用截图' : '改用本地文字';
    confirmButton.textContent = mode === 'text' ? '翻译文字' : '翻译截图';
    confirmButton.disabled = sensitive;
    const width = Math.min(CONTROLS_WIDTH, innerWidth - 24);
    const left = clamp(rect.left, 12, Math.max(12, innerWidth - width - 12));
    controls.style.left = `${left}px`;
    controls.dataset.visible = 'true';
    const controlsHeight = controls.offsetHeight || CONTROLS_HEIGHT;
    const below = rect.bottom + 10;
    const top = below + controlsHeight <= innerHeight
      ? below
      : Math.max(12, rect.top - controlsHeight - 10);
    controls.style.top = `${top}px`;
  }

  function currentPoint(event: PointerEvent): Point {
    return {
      x: clamp(event.clientX, 0, innerWidth),
      y: clamp(event.clientY, 0, innerHeight),
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.composedPath()[0];
    if (!(target instanceof Element) || controls.contains(target)) return;
    const point = currentPoint(event);
    const handle = target instanceof HTMLElement
      ? target.dataset.handle as ResizeHandle | undefined
      : undefined;
    if (currentRect && handle) {
      drag = { kind: 'resize', pointerId: event.pointerId, start: point, origin: currentRect, handle };
    } else if (currentRect && selection.contains(target)) {
      drag = { kind: 'move', pointerId: event.pointerId, start: point, origin: currentRect };
    } else {
      drag = { kind: 'draw', pointerId: event.pointerId, start: point };
      modeExplicitlyChosen = false;
      currentRect = { left: point.x, right: point.x, top: point.y, bottom: point.y };
    }
    controls.dataset.visible = 'false';
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = currentPoint(event);
    if (drag.kind === 'draw') {
      currentRect = normalizeWebRegionRect(drag.start, point);
    } else if (drag.kind === 'move') {
      const width = rectWidth(drag.origin);
      const height = rectHeight(drag.origin);
      const left = clamp(drag.origin.left + point.x - drag.start.x, 0, innerWidth - width);
      const top = clamp(drag.origin.top + point.y - drag.start.y, 0, innerHeight - height);
      currentRect = { left, top, right: left + width, bottom: top + height };
    } else {
      const horizontal = drag.handle.includes('w')
        ? normalizeWebRegionRect(point, { x: drag.origin.right, y: point.y })
        : normalizeWebRegionRect({ x: drag.origin.left, y: point.y }, point);
      const vertical = drag.handle.includes('n')
        ? normalizeWebRegionRect({ x: point.x, y: point.y }, { x: point.x, y: drag.origin.bottom })
        : normalizeWebRegionRect({ x: point.x, y: drag.origin.top }, { x: point.x, y: point.y });
      currentRect = {
        left: horizontal.left,
        right: horizontal.right,
        top: vertical.top,
        bottom: vertical.bottom,
      };
    }
    update(false);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (
      !currentRect ||
      rectWidth(currentRect) < MIN_REGION_EDGE ||
      rectHeight(currentRect) < MIN_REGION_EDGE
    ) currentRect = undefined;
    update();
    event.preventDefault();
    event.stopPropagation();
  }

  function confirm(): void {
    if (!currentRect || sensitive) return;
    finish({
      rect: currentRect,
      mode,
      ...(extractedText ? { extractedText } : {}),
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'Enter' && currentRect && !sensitive) {
      event.preventDefault();
      event.stopPropagation();
      confirm();
    }
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  modeButton.addEventListener('click', () => {
    if (!extractedText) return;
    modeExplicitlyChosen = true;
    mode = mode === 'text' ? 'image' : 'text';
    update();
  });
  cancelButton.addEventListener('click', cancel);
  confirmButton.addEventListener('click', confirm);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', cancel, true);
  window.addEventListener('scroll', cancel, true);
  queueMicrotask(() => stage.focus({ preventScroll: true }));

  return { result, cancel };
}
