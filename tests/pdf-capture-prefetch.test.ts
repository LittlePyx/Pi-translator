import { describe, expect, it, vi } from 'vitest';
import { PdfCapturePrefetch } from '../core/pdf/capture-prefetch';

describe('one-region PDF capture preparation', () => {
  it('starts local work before the next request and consumes the same image once', async () => {
    const buffer = new PdfCapturePrefetch<string>();
    let finish!: (image: string) => void;
    const capture = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    buffer.prepare('page5-region15', capture);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledOnce();
    const fallback = vi.fn(async () => 'wrong');
    const consumed = buffer.take('page5-region15', fallback);
    finish('complete-image');
    expect(await consumed).toEqual({ value: 'complete-image', prefetched: true });
    expect(fallback).not.toHaveBeenCalled();
    expect(await buffer.take('page5-region15', async () => 'fresh')).toEqual({ value: 'fresh', prefetched: false });
  });

  it('never prepares more than one future region', async () => {
    const buffer = new PdfCapturePrefetch<number>();
    const extra = vi.fn(async () => 2);
    buffer.prepare('one', async () => 1);
    buffer.prepare('two', extra);
    await Promise.resolve();
    expect(extra).not.toHaveBeenCalled();
    expect((await buffer.take('one', extra)).value).toBe(1);
  });

  it('discards old geometry and paused buffers without substituting another crop', async () => {
    const buffer = new PdfCapturePrefetch<string>();
    buffer.prepare('old-range', async () => 'old');
    expect(await buffer.take('new-range', async () => 'new')).toEqual({ value: 'new', prefetched: false });
    buffer.prepare('same-range', async () => 'before-pause');
    buffer.clear();
    expect(await buffer.take('same-range', async () => 'after-resume')).toEqual({ value: 'after-resume', prefetched: false });
  });

  it('handles speculative errors and reports them when their region is consumed', async () => {
    const buffer = new PdfCapturePrefetch<string>();
    buffer.prepare('broken', async () => { throw new Error('render failed'); });
    await Promise.resolve();
    await expect(buffer.take('broken', async () => 'retry')).rejects.toThrow('render failed');
    buffer.prepare('discarded', async () => { throw new Error('discarded'); });
    buffer.clear();
    await Promise.resolve();
  });
});
