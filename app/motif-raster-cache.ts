export class MotifRasterCache<T> {
  private values = new Map<string, { signature: string; value: T }>();
  private readonly maxEntries: number;
  private readonly dispose?: (value: T) => void;

  constructor(maxEntries = 48, dispose?: (value: T) => void) {
    this.maxEntries = maxEntries;
    this.dispose = dispose;
  }

  get(motifId: string, signature: string, variant: string) {
    const entry = this.values.get(motifId + "\u001f" + variant);
    return entry?.signature === signature ? entry.value : undefined;
  }

  reusable(motifId: string, variant: string) {
    return this.values.get(motifId + "\u001f" + variant)?.value;
  }

  set(motifId: string, signature: string, variant: string, value: T) {
    const key = motifId + "\u001f" + variant;
    if (!this.values.has(key) && this.values.size >= this.maxEntries) {
      this.clear();
    }
    const previous = this.values.get(key)?.value;
    if (previous !== undefined && previous !== value) this.dispose?.(previous);
    this.values.set(key, { signature, value });
  }

  clear() {
    if (this.dispose) for (const { value } of this.values.values()) this.dispose(value);
    this.values.clear();
  }

  get size() {
    return this.values.size;
  }
}
