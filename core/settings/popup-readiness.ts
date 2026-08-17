import type { SettingsFocus } from '../messaging/user-facing-error';
import type { ApiReadinessStatus } from './api-readiness';
import type { GeneralPageMode } from './schema';
import { isInjectableWebUrl, isOverleafProjectUrl } from './site-access';

export type PopupPageState = 'neutral' | 'supported' | 'disabled' | 'restricted';
export type PopupShortcutState = 'assigned' | 'missing' | 'unknown';

export type PopupReadinessAction =
  | { kind: 'settings'; focus: SettingsFocus }
  | { kind: 'shortcuts' };

export interface PopupReadinessIssue {
  id: 'text-api' | 'shortcut' | 'page';
  title: string;
  detail: string;
  actionLabel: string;
  action: PopupReadinessAction;
}

export interface PopupReadinessResult {
  issues: PopupReadinessIssue[];
  contextNote?: string;
}

export function popupPageState(
  url: string | undefined,
  generalPageMode: GeneralPageMode,
  hasPdfContext = false,
): PopupPageState {
  if (hasPdfContext || (url && isOverleafProjectUrl(url))) return 'supported';
  if (!url) return 'neutral';
  if (isInjectableWebUrl(url)) {
    return generalPageMode === 'off' ? 'disabled' : 'supported';
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'chrome-extension:' || protocol === 'moz-extension:') return 'neutral';
  } catch {
    return 'neutral';
  }
  return 'restricted';
}

function apiActionLabel(readiness: ApiReadinessStatus): string {
  if (readiness.settingsFocus === 'api-model') return '选择模型';
  if (readiness.settingsFocus === 'api-permission') return '授权接口';
  return '配置翻译服务';
}

export function popupReadiness(input: {
  textApi: ApiReadinessStatus;
  shortcut: PopupShortcutState;
  page: PopupPageState;
}): PopupReadinessResult {
  const issues: PopupReadinessIssue[] = [];
  if (input.textApi.tone === 'issue') {
    issues.push({
      id: 'text-api',
      title: input.textApi.detail,
      detail: '完成后即可在网页、Overleaf 和文字型 PDF 中翻译。',
      actionLabel: apiActionLabel(input.textApi),
      action: { kind: 'settings', focus: input.textApi.settingsFocus },
    });
  }
  if (input.shortcut === 'missing') {
    issues.push({
      id: 'shortcut',
      title: '翻译快捷键尚未设置',
      detail: 'Edge 没有为翻译命令分配按键，右键菜单仍可使用。',
      actionLabel: '设置快捷键',
      action: { kind: 'shortcuts' },
    });
  } else if (input.shortcut === 'unknown') {
    issues.push({
      id: 'shortcut',
      title: '暂时无法读取翻译快捷键',
      detail: '可在 Edge 快捷键页面确认翻译命令是否已分配按键。',
      actionLabel: '检查快捷键',
      action: { kind: 'shortcuts' },
    });
  }
  if (input.page === 'disabled') {
    issues.push({
      id: 'page',
      title: '普通网页翻译当前已关闭',
      detail: '当前网页需要先开启按需翻译或网站自动划词。',
      actionLabel: '开启网页翻译',
      action: { kind: 'settings', focus: 'pages' },
    });
  }
  return {
    issues,
    ...(input.page === 'restricted'
      ? { contextNote: '当前页面受 Edge 限制，请在普通网页、Overleaf 或 PDF 中使用。' }
      : {}),
  };
}
