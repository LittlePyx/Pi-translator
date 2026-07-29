import { describe, expect, it } from 'vitest';
import {
  isUsableRegion,
  mapRegionToCanvas,
  moveRegion,
  normalizeRegion,
  resizeRegion,
  scaledImageDimensions,
} from '../core/pdf/region-capture';

describe('PDF image region geometry', () => {
  it('normalizes forward and reverse drags identically', () => {
    const bounds = { left: 100, top: 50, width: 400, height: 600 };
    const forward = normalizeRegion({ x: 140, y: 110 }, { x: 300, y: 350 }, bounds);
    const reverse = normalizeRegion({ x: 300, y: 350 }, { x: 140, y: 110 }, bounds);
    expect(reverse).toEqual(forward);
    expect(forward).toEqual({
      left: 140,
      top: 110,
      right: 300,
      bottom: 350,
      width: 160,
      height: 240,
    });
  });

  it('clamps a drag to the page and maps CSS coordinates to canvas pixels', () => {
    const page = { left: 100, top: 50, width: 400, height: 600 };
    const region = normalizeRegion({ x: 140, y: 110 }, { x: 300, y: 350 }, page);
    expect(mapRegionToCanvas(region, page, 800, 1200)).toEqual({
      sx: 80,
      sy: 120,
      sw: 320,
      sh: 480,
    });

    expect(normalizeRegion({ x: -50, y: -80 }, { x: 900, y: 1000 }, page)).toEqual({
      left: 100,
      top: 50,
      right: 500,
      bottom: 650,
      width: 400,
      height: 600,
    });
  });

  it('uses outward rounding without exceeding canvas bounds', () => {
    const page = { left: 0, top: 0, width: 333.3, height: 500.5 };
    const region = normalizeRegion({ x: 1.2, y: 2.3 }, { x: 333.3, y: 500.5 }, page);
    const mapped = mapRegionToCanvas(region, page, 1000, 1500);
    expect(mapped.sx).toBe(3);
    expect(mapped.sy).toBe(6);
    expect(mapped.sx + mapped.sw).toBe(1000);
    expect(mapped.sy + mapped.sh).toBe(1500);
  });

  it('rejects tiny regions and scales large crops without upscaling', () => {
    expect(isUsableRegion({ width: 17, height: 100 })).toBe(false);
    expect(isUsableRegion({ width: 18, height: 18 })).toBe(true);
    expect(scaledImageDimensions(4096, 1024)).toEqual({ width: 2048, height: 512 });
    expect(scaledImageDimensions(1024, 4096)).toEqual({ width: 512, height: 2048 });
    expect(scaledImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('moves an existing region while preserving its size and constraining it to the page', () => {
    const bounds = { left: 0, top: 0, width: 400, height: 600 };
    const region = normalizeRegion({ x: 100, y: 120 }, { x: 250, y: 300 }, bounds);
    expect(moveRegion(region, { x: 45, y: -30 }, bounds)).toEqual({
      left: 145,
      top: 90,
      right: 295,
      bottom: 270,
      width: 150,
      height: 180,
    });
    expect(moveRegion(region, { x: 900, y: 900 }, bounds)).toEqual({
      left: 250,
      top: 420,
      right: 400,
      bottom: 600,
      width: 150,
      height: 180,
    });
  });

  it('resizes from a corner with minimum-size and page-bound constraints', () => {
    const bounds = { left: 0, top: 0, width: 400, height: 600 };
    const region = normalizeRegion({ x: 100, y: 120 }, { x: 250, y: 300 }, bounds);
    expect(resizeRegion(region, 'se', { x: 360, y: 480 }, bounds)).toEqual({
      left: 100,
      top: 120,
      right: 360,
      bottom: 480,
      width: 260,
      height: 360,
    });
    expect(resizeRegion(region, 'nw', { x: 500, y: 500 }, bounds)).toEqual({
      left: 232,
      top: 282,
      right: 250,
      bottom: 300,
      width: 18,
      height: 18,
    });
    expect(resizeRegion(region, 'nw', { x: -50, y: -60 }, bounds)).toEqual({
      left: 0,
      top: 0,
      right: 250,
      bottom: 300,
      width: 250,
      height: 300,
    });
  });
});
