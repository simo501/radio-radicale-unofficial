import { config } from '../config/index.js';

export class TTLCache {
  constructor(ttlMs = config.cacheTtlMs, maxItems = config.cacheMaxItems) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.items = new Map();
  }
  get size() { return this.items.size; }
  get(key) {
    const item = this.items.get(key);
    if (!item) return undefined;
    this.items.delete(key);
    if (item.expires <= Date.now()) return undefined;
    this.items.set(key, item);
    return item.value;
  }
  set(key, value) {
    this.items.delete(key);
    this.items.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.items.size > this.maxItems) this.items.delete(this.items.keys().next().value);
  }
}

export const apiCache = new TTLCache();
