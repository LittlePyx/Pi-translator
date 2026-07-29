import { describe, expect, it } from 'vitest';
import { isRuntimeMessage } from '../core/messaging/messages';

describe('runtime message guard', () => {
  it('accepts the dedicated vision-capability test message', () => {
    expect(isRuntimeMessage({
      type: 'TEST_VISION_CAPABILITY',
      payload: {
        apiBaseUrl: 'https://api.example.com/v1',
        model: 'vision-model',
        profileId: 'vision-profile',
      },
    })).toBe(true);
  });
});
