import { describe, it, expect, beforeEach } from 'vitest';
import { RedisIdempotencyStore, RedisCacheStore } from '../src/redis-stores.js';

// Mock Redis client
class MockRedis {
  private storage = new Map<string, string>();
  private ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const ttl = this.ttls.get(key);
    if (ttl !== undefined && ttl < Date.now()) {
      this.storage.delete(key);
      this.ttls.delete(key);
      return null;
    }
    return this.storage.get(key) ?? null;
  }

  async setex(key: string, ttl: number, value: string): Promise<'OK'> {
    this.storage.set(key, value);
    this.ttls.set(key, Date.now() + ttl * 1000);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.storage.has(key);
    this.storage.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    // Simple pattern matching for testing - replace all wildcards
    const prefix = pattern.split('*')[0] || '';
    return Array.from(this.storage.keys()).filter(key => key.startsWith(prefix));
  }

  clear() {
    this.storage.clear();
    this.ttls.clear();
  }
}

describe('RedisIdempotencyStore', () => {
  let redis: MockRedis;
  let store: RedisIdempotencyStore;

  beforeEach(() => {
    redis = new MockRedis();
    store = new RedisIdempotencyStore({
      redis: redis as any,
      keyPrefix: 'test:idempotency:',
      ttlSeconds: 3600,
    });
  });

  it('stores and retrieves idempotency records', async () => {
    const record = {
      key: 'test-key-1',
      value: { status: 200, body: 'success' },
      attempts: 1,
      completedAt: Date.now(),
    };

    await store.set(record);
    const retrieved = await store.get('test-key-1');

    expect(retrieved).toEqual(record);
  });

  it('returns undefined for non-existent keys', async () => {
    const retrieved = await store.get('non-existent');
    expect(retrieved).toBeUndefined();
  });

  it('uses configured key prefix', async () => {
    const record = {
      key: 'my-key',
      value: { data: 'test' },
      attempts: 1,
      completedAt: Date.now(),
    };

    await store.set(record);
    
    // Check that the key in Redis has the prefix
    const keys = await redis.keys('test:idempotency:*');
    expect(keys).toContain('test:idempotency:my-key');
  });

  it('handles malformed JSON gracefully', async () => {
    // Manually insert invalid JSON
    await redis.setex('test:idempotency:bad-key', 3600, 'not valid json{]');
    
    const retrieved = await store.get('bad-key');
    expect(retrieved).toBeUndefined();
  });
});

describe('RedisCacheStore', () => {
  let redis: MockRedis;
  let store: RedisCacheStore;

  beforeEach(() => {
    redis = new MockRedis();
    store = new RedisCacheStore({
      redis: redis as any,
      keyPrefix: 'test:cache:',
    });
  });

  it('stores and retrieves cache entries', async () => {
    const entry = {
      feature: 'test-feature',
      value: { data: 'test data', count: 42 },
      expiresAt: Date.now() + 60000, // 60 seconds from now
    };

    await store.set('cache-key-1', entry);
    const retrieved = await store.get('cache-key-1');

    expect(retrieved).toEqual(entry);
  });

  it('returns undefined for non-existent keys', async () => {
    const retrieved = await store.get('non-existent');
    expect(retrieved).toBeUndefined();
  });

  it('returns undefined for expired entries', async () => {
    const entry = {
      feature: 'test-feature',
      value: { data: 'old data' },
      expiresAt: Date.now() - 1000, // Expired 1 second ago
    };

    await store.set('expired-key', entry);
    
    // Entry should have been rejected (TTL <= 0)
    const retrieved = await store.get('expired-key');
    expect(retrieved).toBeUndefined();
  });

  it('calculates TTL correctly', async () => {
    const now = Date.now();
    const entry = {
      feature: 'test-feature',
      value: { data: 'test' },
      expiresAt: now + 5000, // 5 seconds from now
    };

    await store.set('ttl-test', entry);
    const retrieved = await store.get('ttl-test');
    
    expect(retrieved).toBeDefined();
    expect(retrieved?.expiresAt).toBe(entry.expiresAt);
  });

  it('deletes entries', async () => {
    const entry = {
      feature: 'test-feature',
      value: { data: 'test' },
      expiresAt: Date.now() + 60000,
    };

    await store.set('delete-test', entry);
    expect(await store.get('delete-test')).toBeDefined();

    await store.delete('delete-test');
    expect(await store.get('delete-test')).toBeUndefined();
  });

  it('lists keys with pattern', async () => {
    const entry1 = {
      feature: 'feature-1',
      value: { data: 'test1' },
      expiresAt: Date.now() + 60000,
    };
    const entry2 = {
      feature: 'feature-2',
      value: { data: 'test2' },
      expiresAt: Date.now() + 60000,
    };

    await store.set('key1', entry1);
    await store.set('key2', entry2);

    const keys = await store.keys();
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
    expect(keys).toHaveLength(2);
  });

  it('uses configured key prefix', async () => {
    const entry = {
      feature: 'test-feature',
      value: { data: 'test' },
      expiresAt: Date.now() + 60000,
    };

    await store.set('my-cache-key', entry);
    
    // Check that the key in Redis has the prefix
    const keys = await redis.keys('test:cache:*');
    expect(keys).toContain('test:cache:my-cache-key');
  });

  it('strips prefix from returned keys', async () => {
    const entry = {
      feature: 'test-feature',
      value: { data: 'test' },
      expiresAt: Date.now() + 60000,
    };

    await store.set('my-key', entry);
    
    const keys = await store.keys();
    expect(keys).toContain('my-key');
    expect(keys).not.toContain('test:cache:my-key');
  });

  it('handles malformed JSON gracefully', async () => {
    // Manually insert invalid JSON
    await redis.setex('test:cache:bad-key', 3600, 'not valid json{]');
    
    const retrieved = await store.get('bad-key');
    expect(retrieved).toBeUndefined();
  });
});
