# Redis Integration Example

This document shows how to integrate Redis persistence into the OpalMind API server.

## Setup

### 1. Install Dependencies

The Redis client is already included in the SDK package. No additional dependencies are required at the API level.

### 2. Environment Configuration

Add Redis configuration to your `.env` file or environment:

```bash
# Redis Connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=             # Optional
REDIS_DB=0                  # Optional, default: 0
REDIS_TLS=false             # Optional, default: false

# Persistence Configuration  
REDIS_IDEMPOTENCY_TTL=86400           # 24 hours in seconds
REDIS_IDEMPOTENCY_PREFIX=opalmind:idempotency:
REDIS_CACHE_PREFIX=opalmind:cache:
```

### 3. Server Integration

Add Redis initialization to your server.ts:

```typescript
import 'dotenv/config';
import Redis from 'ioredis';
import {
  createMatomoClient,
  RedisIdempotencyStore,
  RedisCacheStore,
  type MatomoClientConfig
} from '@opalmind/sdk';

// Initialize Redis client (optional - only if Redis is configured)
let redis: Redis | undefined;
let idempotencyStore: RedisIdempotencyStore | undefined;
let cacheStore: RedisCacheStore | undefined;

if (process.env.REDIS_HOST) {
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0'),
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      enableOfflineQueue: false, // Fail fast if Redis is down
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        // Exponential backoff up to 2 seconds
        return Math.min(times * 50, 2000);
      },
    });

    // Test connection
    await redis.ping();
    
    apiLogger.info('Redis connection established', {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      db: process.env.REDIS_DB || '0',
    });

    // Create Redis-backed stores
    idempotencyStore = new RedisIdempotencyStore({
      redis,
      keyPrefix: process.env.REDIS_IDEMPOTENCY_PREFIX || 'opalmind:idempotency:',
      ttlSeconds: parseInt(process.env.REDIS_IDEMPOTENCY_TTL || '86400'),
    });

    cacheStore = new RedisCacheStore({
      redis,
      keyPrefix: process.env.REDIS_CACHE_PREFIX || 'opalmind:cache:',
    });
  } catch (error) {
    apiLogger.warn('Redis connection failed, falling back to in-memory storage', { error });
    redis = undefined;
    idempotencyStore = undefined;
    cacheStore = undefined;
  }
}

// Create Matomo client with optional Redis persistence
const matomoConfig: MatomoClientConfig = {
  baseUrl: requiredEnv('MATOMO_BASE_URL'),
  tokenAuth: requiredEnv('MATOMO_TOKEN'),
  defaultSiteId: parseOptionalNumber(process.env.MATOMO_DEFAULT_SITE_ID),
  // ... other existing config
};

// Add Redis stores if available
if (idempotencyStore) {
  matomoConfig.tracking = {
    ...matomoConfig.tracking,
    idempotencyStore,
  };
}

if (cacheStore) {
  matomoConfig.cache = {
    ...matomoConfig.cache,
    store: cacheStore,
  };
}

const matomoClient = createMatomoClient(matomoConfig);

// Graceful shutdown
process.on('SIGTERM', async () => {
  apiLogger.info('SIGTERM received, closing Redis connection');
  if (redis) {
    await redis.quit();
  }
  process.exit(0);
});
```

### 4. Verification

After starting the server with Redis configured:

1. Check logs for "Redis connection established" message
2. Verify cache persistence:
   ```bash
   # Make some API calls
   curl -H "Authorization: Bearer $OPAL_BEARER_TOKEN" \
     "http://localhost:3000/tools/get-key-numbers" \
     -d '{"period":"day","date":"today"}'
   
   # Check Redis keys
   redis-cli KEYS "opalmind:cache:*"
   ```

3. Verify idempotency persistence:
   ```bash
   # Track a pageview
   curl -H "Authorization: Bearer $OPAL_BEARER_TOKEN" \
     "http://localhost:3000/track/pageview" \
     -d '{"url":"https://example.com","siteId":1}'
   
   # Check idempotency records
   redis-cli KEYS "opalmind:idempotency:*"
   ```

4. Test restart resilience:
   ```bash
   # Restart the service
   docker compose restart opalmind-api
   
   # Verify cached data persists
   curl -H "Authorization: Bearer $OPAL_BEARER_TOKEN" \
     "http://localhost:3000/tools/get-cache-stats"
   ```

## Graceful Degradation

If Redis becomes unavailable after startup, the SDK will:

1. Log connection errors
2. Fall back to in-memory storage for new entries
3. Mark service health as `degraded`
4. Continue serving requests

Monitor the `/tools/get-health-status` endpoint to detect Redis failures:

```json
{
  "status": "degraded",
  "checks": [
    {
      "name": "redis-connection",
      "status": "fail",
      "output": "Connection refused"
    }
  ]
}
```

## Docker Compose Setup

Here's a complete docker-compose.yml with Redis:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  opalmind-api:
    image: ghcr.io/authorityab/opalmind-api:latest
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MATOMO_BASE_URL=${MATOMO_BASE_URL}
      - MATOMO_TOKEN=${MATOMO_TOKEN}
      - OPAL_BEARER_TOKEN=${OPAL_BEARER_TOKEN}
      - MATOMO_DEFAULT_SITE_ID=${MATOMO_DEFAULT_SITE_ID:-1}
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

volumes:
  redis-data:
```

### redis.conf

```redis
# Persistence
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Memory management
maxmemory 512mb
maxmemory-policy allkeys-lru

# Security
requirepass your-secure-password

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300
```

## Troubleshooting

### Connection Errors

If you see Redis connection errors in logs:

1. Verify Redis is running: `docker compose ps redis`
2. Check network connectivity: `docker compose exec opalmind-api ping redis`
3. Verify credentials match between Redis config and API environment
4. Check Redis logs: `docker compose logs redis`

### Memory Issues

If Redis is using too much memory:

1. Check current usage: `redis-cli INFO memory`
2. Review key count: `redis-cli DBSIZE`
3. Reduce cache TTL in API environment
4. Increase maxmemory limit in redis.conf
5. Verify maxmemory-policy is set to allkeys-lru

### Performance Problems

If API responses are slow:

1. Check Redis latency: `redis-cli --latency`
2. Monitor slow queries: `redis-cli SLOWLOG GET 10`
3. Review Redis connection pool settings
4. Consider enabling Redis pipelining for bulk operations

## Production Checklist

Before deploying Redis to production:

- [ ] Set strong Redis password
- [ ] Enable TLS for Redis connections
- [ ] Configure Redis persistence (AOF + snapshots)
- [ ] Set appropriate maxmemory limits
- [ ] Enable Redis monitoring and alerting
- [ ] Test failover and recovery procedures
- [ ] Document backup and restore process
- [ ] Configure Redis in a separate network from public access
- [ ] Set up Redis Sentinel or Cluster for high availability (if needed)
- [ ] Review and tune Redis configuration for your workload
