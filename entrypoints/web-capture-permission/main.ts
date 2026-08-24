import { browser } from 'wxt/browser';

import type { RuntimeMessage, RuntimeResponse } from '../../core/messaging/messages';

const VISIBLE_TAB_CAPTURE_PERMISSION = '<all_urls>';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing inline permission element #${id}`);
  return value as T;
}

const grant = element<HTMLButtonElement>('grant');
const label = element<HTMLElement>('label');
const detail = element<HTMLElement>('detail');
const status = element<HTMLElement>('status');
const intent = new URLSearchParams(location.search).get('intent') === 'start'
  ? 'start'
  : 'restore';
let requestPending = false;
let authorizationReady = false;
document.body.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark'
  ? 'dark'
  : 'light';

function setState(
  state: 'idle' | 'pending' | 'denied' | 'error' | 'complete',
  labelText: string,
  detailText: string,
): void {
  document.body.dataset.state = state;
  label.textContent = labelText;
  detail.textContent = detailText;
  status.textContent = `${labelText}。${detailText}`;
}

async function grantAndResume(): Promise<void> {
  if (requestPending || !authorizationReady) return;
  requestPending = true;
  grant.disabled = true;
  setState('pending', '等待 Edge 确认…', '请在浏览器权限提示中选择允许');
  try {
    const granted = await browser.permissions.request({
      origins: [VISIBLE_TAB_CAPTURE_PERMISSION],
    });
    if (!granted) {
      setState('denied', '未允许，点击重试', '也可以改用下方的浏览器侧栏授权');
      return;
    }
    setState(
      'pending',
      intent === 'start' ? '已允许，正在进入框选…' : '已允许，正在恢复…',
      intent === 'start' ? '即将在当前网页开始框选' : '即将回到刚才框选的网页区域',
    );
    const response = await browser.runtime.sendMessage({
      type: 'START_WEB_REGION_SELECTION',
      ...(intent === 'restore' ? { payload: { restorePreviousRegion: true } } : {}),
    } satisfies RuntimeMessage) as RuntimeResponse<{ started: true }>;
    if (!response.ok) throw new Error(response.error.message);
    setState(
      'complete',
      intent === 'start' ? '已进入框选' : '已恢复框选',
      intent === 'start' ? '请在当前网页拖动选择区域' : '请继续调整或翻译当前区域',
    );
  } catch (error) {
    setState(
      'error',
      '无法直接授权，点击重试',
      error instanceof Error && error.message.trim()
        ? error.message
        : '也可以改用下方的浏览器侧栏授权',
    );
  } finally {
    requestPending = false;
    if (document.body.dataset.state !== 'complete' && authorizationReady) grant.disabled = false;
  }
}

grant.addEventListener('click', () => {
  void grantAndResume();
});

window.addEventListener('focus', () => {
  if (authorizationReady && !grant.disabled) grant.focus({ preventScroll: true });
});

async function initialize(): Promise<void> {
  grant.disabled = true;
  setState('pending', '正在验证当前操作…', '只响应刚刚由 Pi Translator 发起的框选');
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_CURRENT_WEB_CAPTURE_PERMISSION_PROMPT',
    } satisfies RuntimeMessage) as RuntimeResponse<{ pending: boolean }>;
    if (!response.ok || !response.data.pending) {
      setState('error', '请从 Pi 框选入口重新操作', '当前页面没有待处理的截图授权');
      return;
    }
    authorizationReady = true;
    grant.disabled = false;
    setState(
      'idle',
      intent === 'start' ? '允许截图并开始框选' : '允许截图并继续',
      intent === 'start'
        ? 'Edge 将询问一次，允许后自动进入框选'
        : 'Edge 将询问一次，授权后自动恢复框选',
    );
    if (document.hasFocus()) grant.focus({ preventScroll: true });
  } catch {
    setState('error', '无法验证授权来源', '请改用下方的浏览器侧栏授权');
  }
}

void initialize();
