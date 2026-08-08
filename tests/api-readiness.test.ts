import { describe, expect, it } from 'vitest';
import {
  textApiReadiness,
  visionApiReadiness,
  type ProviderReadinessSnapshot,
} from '../core/settings/api-readiness';

function snapshot(
  patch: Partial<ProviderReadinessSnapshot> = {},
): ProviderReadinessSnapshot {
  return {
    hasProfile: true,
    hasValidBaseUrl: true,
    hasModel: true,
    hasApiKey: true,
    hasPermission: true,
    capabilities: {},
    ...patch,
  };
}

describe('compact API readiness indicators', () => {
  it('keeps configured text translation ready while vision is optional', () => {
    expect(textApiReadiness(snapshot())).toMatchObject({
      role: 'text',
      value: '已配置',
      tone: 'ready',
    });
    expect(visionApiReadiness(undefined)).toMatchObject({
      role: 'vision',
      value: '按需配置',
      tone: 'quiet',
      settingsFocus: 'vision',
    });
  });

  it('uses cached observations without requiring a new connection request', () => {
    expect(textApiReadiness(snapshot({ capabilities: { textStreaming: true } }))).toMatchObject({
      value: '已验证',
      tone: 'ready',
    });
    expect(textApiReadiness(snapshot({ capabilities: { textStreaming: false } }))).toMatchObject({
      value: '已配置',
      tone: 'ready',
    });
    expect(visionApiReadiness(snapshot({ capabilities: { vision: true } }))).toMatchObject({
      value: '已验证',
      tone: 'ready',
    });
    expect(visionApiReadiness(snapshot({ capabilities: { vision: false } }))).toMatchObject({
      value: '不支持图片',
      tone: 'issue',
      settingsFocus: 'vision-model',
    });
  });

  it('routes each blocking configuration state to the exact settings control', () => {
    expect(textApiReadiness(snapshot({ hasApiKey: false }))).toMatchObject({
      value: '缺少 Key',
      settingsFocus: 'api',
    });
    expect(textApiReadiness(snapshot({ hasPermission: false }))).toMatchObject({
      value: '待授权',
      settingsFocus: 'api-permission',
    });
    expect(visionApiReadiness(snapshot({ hasModel: false }))).toMatchObject({
      value: '缺少模型',
      settingsFocus: 'vision-model',
    });
    expect(visionApiReadiness(snapshot({ hasPermission: false }))).toMatchObject({
      value: '待授权',
      settingsFocus: 'vision-permission',
    });
  });

  it('treats an unobserved configured vision model as neutral rather than broken', () => {
    expect(visionApiReadiness(snapshot())).toMatchObject({
      value: '待验证',
      tone: 'quiet',
      settingsFocus: 'vision-permission',
    });
  });
});
