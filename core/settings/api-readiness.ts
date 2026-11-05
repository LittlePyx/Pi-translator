import { t } from '../i18n/ui-language';
import type { SettingsFocus, TranslationProviderRole } from '../messaging/user-facing-error';
import type { ApiModelCapabilities } from '../translation/api-capability-repository';

export type ApiReadinessTone = 'ready' | 'quiet' | 'issue';

export interface ProviderReadinessSnapshot {
  hasProfile: boolean;
  hasValidBaseUrl: boolean;
  hasModel: boolean;
  hasApiKey: boolean;
  hasPermission: boolean;
  capabilities: ApiModelCapabilities;
}

export interface ApiReadinessStatus {
  role: TranslationProviderRole;
  label: string;
  value: string;
  detail: string;
  tone: ApiReadinessTone;
  settingsFocus: SettingsFocus;
}

function hasObservedTextCapability(capabilities: ApiModelCapabilities): boolean {
  // `false` compatibility hints can be recorded before a fallback request
  // finishes, so they are useful for request shaping but are not proof that a
  // text translation completed. Only positive observations earn “verified”.
  return capabilities.textStreaming === true || capabilities.thinkingControl === true;
}

function blockingStatus(
  role: TranslationProviderRole,
  label: string,
  value: string,
  detail: string,
  settingsFocus: SettingsFocus,
): ApiReadinessStatus {
  return { role, label, value, detail, tone: 'issue', settingsFocus };
}

export function textApiReadiness(snapshot: ProviderReadinessSnapshot): ApiReadinessStatus {
  if (!snapshot.hasProfile || !snapshot.hasValidBaseUrl) {
    return blockingStatus(
      'text',
      t('文字翻译'),
      t('需配置'),
      t('文字翻译接口尚未完整配置。'),
      'api',
    );
  }
  if (!snapshot.hasModel) {
    return blockingStatus(
      'text',
      t('文字翻译'),
      t('缺少模型'),
      t('请为当前文字 API 选择或填写模型。'),
      'api-model',
    );
  }
  if (!snapshot.hasApiKey) {
    return blockingStatus(
      'text',
      t('文字翻译'),
      t('缺少 Key'),
      t('当前文字 API 没有可用的 API Key。'),
      'api',
    );
  }
  if (!snapshot.hasPermission) {
    return blockingStatus(
      'text',
      t('文字翻译'),
      t('待授权'),
      t('还需允许 Pi Translator 访问当前 API 域名。'),
      'api-permission',
    );
  }
  const observed = hasObservedTextCapability(snapshot.capabilities);
  return {
    role: 'text',
    label: t('文字翻译'),
    value: observed ? t('已验证') : t('已配置'),
    detail: observed
      ? t('当前模型已在本浏览器会话中成功使用。')
      : t('文字 API、模型、Key 和域名权限均已配置。'),
    tone: 'ready',
    settingsFocus: 'api',
  };
}

export function visionApiReadiness(
  snapshot: ProviderReadinessSnapshot | undefined,
): ApiReadinessStatus {
  if (!snapshot?.hasProfile) {
    return {
      role: 'vision',
      label: t('图像翻译'),
      value: t('按需配置'),
      detail: t('普通文字翻译可继续使用；网页区域、扫描 PDF 或公式图像需要视觉 API。'),
      tone: 'quiet',
      settingsFocus: 'vision',
    };
  }
  if (!snapshot.hasValidBaseUrl) {
    return blockingStatus(
      'vision',
      t('图像翻译'),
      t('检查配置'),
      t('视觉 API 的接口地址无效。文字翻译不受影响。'),
      'vision',
    );
  }
  if (!snapshot.hasModel) {
    return blockingStatus(
      'vision',
      t('图像翻译'),
      t('缺少模型'),
      t('请为网页区域与 PDF 图像识别选择支持图片输入的模型。'),
      'vision-model',
    );
  }
  if (!snapshot.hasApiKey) {
    return blockingStatus(
      'vision',
      t('图像翻译'),
      t('缺少 Key'),
      t('视觉 API 没有可用的 API Key。普通文字翻译不受影响。'),
      'vision',
    );
  }
  if (!snapshot.hasPermission) {
    return blockingStatus(
      'vision',
      t('图像翻译'),
      t('待授权'),
      t('还需允许 Pi Translator 访问视觉 API 域名。'),
      'vision-permission',
    );
  }
  if (snapshot.capabilities.vision === false) {
    return blockingStatus(
      'vision',
      t('图像翻译'),
      t('不支持图片'),
      t('当前模型已被确认不支持图片输入。文字翻译不受影响。'),
      'vision-model',
    );
  }
  if (snapshot.capabilities.vision === true) {
    return {
      role: 'vision',
      label: t('图像翻译'),
      value: t('已验证'),
      detail: t('当前模型已在本浏览器会话中通过图片输入测试。'),
      tone: 'ready',
      settingsFocus: 'vision',
    };
  }
  return {
    role: 'vision',
    label: t('图像翻译'),
    value: t('待验证'),
    detail: t('视觉 API 已配置，但尚未在本会话中确认图片输入能力。'),
    tone: 'quiet',
    settingsFocus: 'vision-permission',
  };
}
