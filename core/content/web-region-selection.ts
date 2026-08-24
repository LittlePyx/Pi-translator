import { isSensitiveTextControl } from '../selection/selection-context';
import { type ViewportRect } from '../selection/types';

export const WEB_REGION_SELECTION_ROOT_ID = 'pi-web-region-selection-root';

export type WebRegionSelectionMode = 'image';

export interface WebRegionSelectionResult {
  rect: ViewportRect;
  mode: WebRegionSelectionMode;
}

export interface WebRegionSelectionSeed {
  rect: ViewportRect;
  mode: WebRegionSelectionMode;
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

function fitRectToViewport(rect: ViewportRect): ViewportRect {
  const viewportWidth = Math.max(1, innerWidth);
  const viewportHeight = Math.max(1, innerHeight);
  const width = Math.min(viewportWidth, Math.max(MIN_REGION_EDGE, rectWidth(rect)));
  const height = Math.min(viewportHeight, Math.max(MIN_REGION_EDGE, rectHeight(rect)));
  const left = clamp(rect.left, 0, viewportWidth - width);
  const top = clamp(rect.top, 0, viewportHeight - height);
  return { left, top, right: left + width, bottom: top + height };
}

function defaultKeyboardRect(): ViewportRect {
  const width = Math.min(innerWidth, Math.max(MIN_REGION_EDGE, Math.min(560, innerWidth * 0.6)));
  const height = Math.min(innerHeight, Math.max(MIN_REGION_EDGE, Math.min(360, innerHeight * 0.45)));
  const left = Math.max(0, (innerWidth - width) / 2);
  const top = Math.max(0, (innerHeight - height) / 2);
  return { left, top, right: left + width, bottom: top + height };
}

function intersects(left: ViewportRect, right: DOMRect): boolean {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
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

export function createWebRegionSelection(
  initialSelection?: WebRegionSelectionSeed,
): WebRegionSelectionHandle {
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
    <div class="intro">拖动框选网页文字、公式、图表或图像 · Esc 取消</div>
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
  const cancelButton = shadow.querySelector<HTMLButtonElement>('.cancel')!;
  const confirmButton = shadow.querySelector<HTMLButtonElement>('.confirm')!;
  selection.tabIndex = 0;
  selection.setAttribute('role', 'group');
  selection.setAttribute(
    'aria-label',
    '网页翻译选区。方向键移动，Shift 加方向键调整宽度或高度。按 Tab 进入确认按钮。',
  );
  let currentRect: ViewportRect | undefined = initialSelection
    ? fitRectToViewport(initialSelection.rect)
    : undefined;
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
    sensitive = containsSensitiveField(rect);
    controls.classList.toggle('sensitive', sensitive);
    if (sensitive) {
      status.textContent = '框内包含密码、验证码或支付字段';
      privacy.textContent = '为避免泄露敏感信息，此区域不能发送。请调整选框。';
    } else {
      status.textContent = '将截取框内画面并使用多模态模型翻译';
      privacy.textContent = '确认后只截取当前可见页中的框内区域，并发送给已配置的视觉接口。';
    }
    confirmButton.textContent = '翻译框选内容';
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
      mode: 'image',
    });
  }

  function adjustWithKeyboard(event: KeyboardEvent): boolean {
    if (!currentRect || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return false;
    }
    const step = event.ctrlKey ? 1 : 6;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (event.shiftKey) {
      currentRect = {
        ...currentRect,
        right: clamp(
          currentRect.right + dx,
          currentRect.left + Math.min(MIN_REGION_EDGE, innerWidth),
          innerWidth,
        ),
        bottom: clamp(
          currentRect.bottom + dy,
          currentRect.top + Math.min(MIN_REGION_EDGE, innerHeight),
          innerHeight,
        ),
      };
    } else {
      const width = rectWidth(currentRect);
      const height = rectHeight(currentRect);
      const left = clamp(currentRect.left + dx, 0, innerWidth - width);
      const top = clamp(currentRect.top + dy, 0, innerHeight - height);
      currentRect = { left, top, right: left + width, bottom: top + height };
    }
    update();
    selection.focus({ preventScroll: true });
    return true;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    const eventTarget = event.composedPath()[0];
    if (eventTarget instanceof HTMLButtonElement) return;
    if (adjustWithKeyboard(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (!currentRect) {
      currentRect = defaultKeyboardRect();
      update();
      selection.focus({ preventScroll: true });
    } else if (!sensitive) {
      confirm();
    }
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  cancelButton.addEventListener('click', cancel);
  confirmButton.addEventListener('click', confirm);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', cancel, true);
  window.addEventListener('scroll', cancel, true);
  if (currentRect) update();
  queueMicrotask(() => (currentRect ? selection : stage).focus({ preventScroll: true }));

  return { result, cancel };
}
