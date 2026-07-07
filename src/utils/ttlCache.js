class TtlCache {
  constructor({ maxSize = 500, ttlMs = 60_000 } = {}) {
    this.maxSize = Math.max(Number(maxSize) || 500, 1);
    this.ttlMs = Math.max(Number(ttlMs) || 60_000, 1_000);
    this.items = new Map();
  }

  get(key) {
    const entry = this.items.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.items.delete(key);
      return null;
    }

    this.items.delete(key);
    this.items.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (!key) {
      return value;
    }

    if (this.items.size >= this.maxSize) {
      const oldestKey = this.items.keys().next().value;
      if (oldestKey) {
        this.items.delete(oldestKey);
      }
    }

    this.items.set(key, {
      value,
      expiresAt: Date.now() + Math.max(Number(ttlMs) || this.ttlMs, 1_000)
    });
    return value;
  }

  clear() {
    this.items.clear();
  }
}

module.exports = TtlCache;
