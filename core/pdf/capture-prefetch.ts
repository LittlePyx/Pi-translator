/** One local capture ahead, with no network activity and no persistent image storage. */
export class PdfCapturePrefetch<T> {
  private slot?: { key: string; result: Promise<{ value: T } | { error: unknown }> };

  prepare(key: string, capture: () => Promise<T>): void {
    if (this.slot) return;
    this.slot = { key, result: Promise.resolve().then(capture).then(
      (value) => ({ value }), (error: unknown) => ({ error }),
    ) };
  }

  async take(key: string, capture: () => Promise<T>): Promise<{ value: T; prefetched: boolean }> {
    const slot = this.slot;
    delete this.slot;
    if (!slot || slot.key !== key) return { value: await capture(), prefetched: false };
    const result = await slot.result;
    if ('error' in result) throw result.error;
    return { value: result.value, prefetched: true };
  }

  clear(): void { delete this.slot; }
}
