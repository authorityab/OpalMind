import type { Redis } from 'ioredis';

import type { IdempotencyRecord, IdempotencyStore } from './tracking.js';
import type { CacheEntry, CacheStore } from './reports.js';

export interface RedisIdempotencyStoreOptions {
  redis: Redis;
  keyPrefix?: string;
  ttlSeconds?: number;
}

/**
 * Redis-backed idempotency store for tracking requests.
 * Persists idempotency records so restarts do not lose in-flight tracking data.
 */
export class RedisIdempotencyStore<T = unknown> implements IdempotencyStore<T> {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(options: RedisIdempotencyStoreOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'opalmind:idempotency:';
    this.ttlSeconds = options.ttlSeconds ?? 86400; // 24 hours default
  }

  async get(key: string): Promise<IdempotencyRecord<T> | undefined> {
    const redisKey = this.keyPrefix + key;
    const data = await this.redis.get(redisKey);
    
    if (!data) {
      return undefined;
    }

    try {
      return JSON.parse(data) as IdempotencyRecord<T>;
    } catch {
      // Invalid JSON, ignore
      return undefined;
    }
  }

  async set(record: IdempotencyRecord<T>): Promise<void> {
    const redisKey = this.keyPrefix + record.key;
    const data = JSON.stringify(record);
    await this.redis.setex(redisKey, this.ttlSeconds, data);
  }
}

export interface RedisCacheStoreOptions {
  redis: Redis;
  keyPrefix?: string;
}

/**
 * Redis-backed cache store for reports.
 * Persists cache entries so restarts do not lose cached report data.
 */
export class RedisCacheStore<T = unknown> implements CacheStore<T> {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(options: RedisCacheStoreOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'opalmind:cache:';
  }

  async get(key: string): Promise<CacheEntry<T> | undefined> {
    const redisKey = this.keyPrefix + key;
    const data = await this.redis.get(redisKey);
    
    if (!data) {
      return undefined;
    }

    try {
      const entry = JSON.parse(data) as CacheEntry<T>;
      
      // Check if expired
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        // Clean up expired entry
        await this.delete(key);
        return undefined;
      }
      
      return entry;
    } catch {
      // Invalid JSON, ignore
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry<T>): Promise<void> {
    const redisKey = this.keyPrefix + key;
    const data = JSON.stringify(entry);
    
    // Calculate TTL in seconds
    const ttlMs = entry.expiresAt - Date.now();
    if (ttlMs <= 0) {
      // Already expired, don't store
      return;
    }
    
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await this.redis.setex(redisKey, ttlSeconds, data);
  }

  async delete(key: string): Promise<void> {
    const redisKey = this.keyPrefix + key;
    await this.redis.del(redisKey);
  }

  async keys(pattern?: string): Promise<string[]> {
    const searchPattern = this.keyPrefix + (pattern ?? '*');
    const keys = await this.redis.keys(searchPattern);
    
    // Strip prefix from returned keys
    return keys.map(key => key.slice(this.keyPrefix.length));
  }
}
