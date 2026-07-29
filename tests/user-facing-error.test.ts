import { describe, expect, it } from 'vitest';
import {
  runtimeConnectionErrorMessage,
  translationErrorMessage,
} from '../core/messaging/user-facing-error';

describe('user-facing errors', () => {
  it('provides actionable provider errors', () => {
    expect(translationErrorMessage('PROVIDER_ERROR')).toContain('模型');
    expect(translationErrorMessage('NETWORK_ERROR')).toContain('网络');
  });

  it('explains how to fix image-region translation errors', () => {
    expect(translationErrorMessage('VISION_NOT_CONFIGURED')).toContain('视觉翻译 API');
    expect(translationErrorMessage('VISION_MODEL_UNSUPPORTED')).toContain('图片输入');
    expect(translationErrorMessage('IMAGE_REGION_INVALID')).toContain('重新框选');
  });

  it('keeps vision-test failure categories actionable and distinct', () => {
    expect(translationErrorMessage('API_PERMISSION_REQUIRED')).toContain('授权');
    expect(translationErrorMessage('AUTH_FAILED')).toContain('API Key');
    expect(translationErrorMessage('PAYMENT_REQUIRED')).toContain('余额');
    expect(translationErrorMessage('NETWORK_ERROR')).toContain('网络');
  });

  it('distinguishes an invalidated extension context', () => {
    expect(
      runtimeConnectionErrorMessage(new Error('Extension context invalidated.')),
    ).toContain('刷新当前网页');
  });

  it('distinguishes a missing page receiver', () => {
    expect(
      runtimeConnectionErrorMessage(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toContain('翻译组件');
  });
});
