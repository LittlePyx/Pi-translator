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

  it('accepts document-memory operations', () => {
    expect(isRuntimeMessage({
      type: 'GET_DOCUMENT_MEMORY',
      payload: { pageUrl: 'https://example.com/paper' },
    })).toBe(true);
    expect(isRuntimeMessage({
      type: 'UPSERT_DOCUMENT_TERM',
      payload: {
        pageUrl: 'https://example.com/paper',
        term: { source: 'ROI', target: '感兴趣区域' },
      },
    })).toBe(true);
  });
});
