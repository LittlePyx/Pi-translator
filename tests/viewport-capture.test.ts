import { describe, expect, it } from 'vitest';
import { mapViewportRectToImage } from '../core/selection/viewport-capture';

describe('visible tab selection crop mapping', () => {
  it('maps CSS viewport coordinates to device-pixel screenshots with padding', () => {
    expect(mapViewportRectToImage(
      { left: 100, top: 50, right: 300, bottom: 150 },
      1000,
      500,
      2000,
      1000,
      10,
    )).toEqual({ sx: 180, sy: 80, sw: 440, sh: 240 });
  });

  it('clips a crop to screenshot bounds', () => {
    expect(mapViewportRectToImage(
      { left: -4, top: -2, right: 20, bottom: 20 },
      100,
      100,
      100,
      100,
      8,
    )).toEqual({ sx: 0, sy: 0, sw: 28, sh: 28 });
  });
});
