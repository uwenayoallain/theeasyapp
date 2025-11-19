interface CacheEntry {
  data: unknown;
  timestamp: number;
  etag: string;
}

class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;
  private ttl = 60000;

  private generateETag(data: unknown): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `"${Math.abs(hash).toString(36)}"`;
  }

  set(key: string, data: unknown): string {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const etag = this.generateETag(data);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      etag,
    });

    return etag;
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  checkETag(key: string, etag: string): boolean {
    const entry = this.cache.get(key);
    return entry?.etag === etag;
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  getSize(): number {
    return this.cache.size;
  }

  setMaxSize(size: number): void {
    this.maxSize = size;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  setTTL(ms: number): void {
    this.ttl = ms;
  }

  getTTL(): number {
    return this.ttl;
  }
}

export const responseCache = new ResponseCache();
