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
