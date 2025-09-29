import { matomoGet, MatomoHttpClient } from './httpClient.js';
import {
  campaignsSchema,
  deviceTypesSchema,
  ecommerceSummarySchema,
  entryPagesSchema,
  eventCategoriesSchema,
  eventsSchema,
  mostPopularUrlsSchema,
  topReferrersSchema,
} from './schemas.js';
import type {
  Campaign,
  DeviceTypeSummary,
  EcommerceSummary,
  EntryPage,
  EventCategory,
  EventSummary,
  MostPopularUrl,
  TopReferrer,
} from './schemas.js';

export interface MostPopularUrlsInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface TopReferrersInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface EventsInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
  category?: string;
  action?: string;
  name?: string;
}

export interface EntryPagesInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface CampaignsInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface EcommerceOverviewInput {
  siteId: number;
  period: string;
  date: string;
  segment?: string;
}

export interface EventCategoriesInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface DeviceTypesInput {
  siteId: number;
  period: string;
  date: string;
  limit?: number;
  segment?: string;
}

export interface CacheEvent {
  type: 'hit' | 'miss' | 'set' | 'stale-eviction';
  feature: string;
  key: string;
  expiresAt?: number;
  ttlMs?: number;
}

export interface CacheStatsCounters {
  hits: number;
  misses: number;
  sets: number;
  staleEvictions: number;
}

export interface CacheStatsSnapshot {
  total: CacheStatsCounters & { entries: number };
  features: Array<CacheStatsCounters & { feature: string; entries: number }>;
}

export interface ReportsServiceOptions {
  cacheTtlMs?: number;
  onCacheEvent?: (event: CacheEvent) => void;
}

export class ReportsService {
  private readonly cache = new Map<string, { feature: string; expiresAt: number; value: unknown }>();
  private readonly cacheTtlMs: number;
  private readonly featureStats = new Map<string, CacheStatsCounters>();
  private readonly onCacheEvent?: (event: CacheEvent) => void;

  constructor(private readonly http: MatomoHttpClient, options: ReportsServiceOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.onCacheEvent = options.onCacheEvent;
  }

  getCacheStats(): CacheStatsSnapshot {
    const totals: CacheStatsCounters & { entries: number } = {
      hits: 0,
      misses: 0,
      sets: 0,
      staleEvictions: 0,
      entries: this.cache.size,
    };

    const featureEntries = new Map<string, number>();
    for (const entry of this.cache.values()) {
      featureEntries.set(entry.feature, (featureEntries.get(entry.feature) ?? 0) + 1);
    }

    const features: Array<CacheStatsCounters & { feature: string; entries: number }> = [];
    for (const [feature, counters] of this.featureStats.entries()) {
      const featureSnapshot: CacheStatsCounters & { feature: string; entries: number } = {
        feature,
        hits: counters.hits,
        misses: counters.misses,
        sets: counters.sets,
        staleEvictions: counters.staleEvictions,
        entries: featureEntries.get(feature) ?? 0,
      };
      totals.hits += counters.hits;
      totals.misses += counters.misses;
      totals.sets += counters.sets;
      totals.staleEvictions += counters.staleEvictions;
      features.push(featureSnapshot);
    }

    return { total: totals, features };
  }

  private makeCacheKey(feature: string, input: unknown): string {
    return JSON.stringify({ feature, input });
  }

  private record(feature: string, field: keyof CacheStatsCounters) {
    const stats = this.featureStats.get(feature) ?? { hits: 0, misses: 0, sets: 0, staleEvictions: 0 };
    stats[field] += 1;
    this.featureStats.set(feature, stats);
  }

  private emit(event: CacheEvent) {
    if (this.onCacheEvent) {
      this.onCacheEvent(event);
    }
  }

  private getFromCache<T>(feature: string, key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.record(feature, 'misses');
      this.emit({ type: 'miss', feature, key });
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.record(feature, 'staleEvictions');
      this.emit({ type: 'stale-eviction', feature, key });
      this.record(feature, 'misses');
      this.emit({ type: 'miss', feature, key });
      return undefined;
    }

    this.record(feature, 'hits');
    this.emit({ type: 'hit', feature, key, expiresAt: entry.expiresAt, ttlMs: entry.expiresAt - Date.now() });
    return entry.value as T;
  }

  private setCache<T>(feature: string, key: string, value: T) {
    const expiresAt = Date.now() + this.cacheTtlMs;
    this.cache.set(key, { feature, value, expiresAt });
    this.record(feature, 'sets');
    this.emit({ type: 'set', feature, key, expiresAt, ttlMs: this.cacheTtlMs });
  }

  async getMostPopularUrls(input: MostPopularUrlsInput): Promise<MostPopularUrl[]> {
    const feature = 'popularUrls';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<MostPopularUrl[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<MostPopularUrl[]>(this.http, {
      method: 'Actions.getPageUrls',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
        flat: 1,
      },
    });

    const parsed = mostPopularUrlsSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getTopReferrers(input: TopReferrersInput): Promise<TopReferrer[]> {
    const feature = 'topReferrers';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<TopReferrer[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<TopReferrer[]>(this.http, {
      method: 'Referrers.getReferrerType',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
      },
    });

    const parsed = topReferrersSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getEvents(input: EventsInput): Promise<EventSummary[]> {
    const feature = 'events';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<EventSummary[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<EventSummary[]>(this.http, {
      method: 'Events.getAction',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
        flat: 1,
        eventCategory: input.category,
        eventAction: input.action,
        eventName: input.name,
      },
    });

    const parsed = eventsSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getEntryPages(input: EntryPagesInput): Promise<EntryPage[]> {
    const feature = 'entryPages';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<EntryPage[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<EntryPage[]>(this.http, {
      method: 'Actions.getEntryPageUrls',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
        flat: 1,
      },
    });

    const parsed = entryPagesSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getCampaigns(input: CampaignsInput): Promise<Campaign[]> {
    const feature = 'campaigns';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<Campaign[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<Campaign[]>(this.http, {
      method: 'Referrers.getCampaigns',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
      },
    });

    const parsed = campaignsSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getEcommerceOverview(input: EcommerceOverviewInput): Promise<EcommerceSummary> {
    const feature = 'ecommerceOverview';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<EcommerceSummary>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<unknown>(this.http, {
      method: 'Goals.get',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        idGoal: 'ecommerceOrder',
      },
    });

    const summary = extractEcommerceSummary(data);
    const parsed = ecommerceSummarySchema.parse(summary ?? {});
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getEventCategories(input: EventCategoriesInput): Promise<EventCategory[]> {
    const feature = 'eventCategories';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<EventCategory[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<EventCategory[]>(this.http, {
      method: 'Events.getCategory',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
        flat: 1,
      },
    });

    const parsed = eventCategoriesSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getDeviceTypes(input: DeviceTypesInput): Promise<DeviceTypeSummary[]> {
    const feature = 'deviceTypes';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<DeviceTypeSummary[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<DeviceTypeSummary[]>(this.http, {
      method: 'DevicesDetection.getType',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
      },
    });

    const parsed = deviceTypesSchema.parse(data);
    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }
}

function extractEcommerceSummary(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  if (!Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if ('revenue' in record || 'nb_conversions' in record || 'avg_order_revenue' in record) {
      return record;
    }

    for (const key of Object.keys(record)) {
      if (key.toLowerCase().includes('ecommerceorder')) {
        const nested = extractEcommerceSummary(record[key]);
        if (nested) {
          return nested;
        }
      }
    }

    for (const value of Object.values(record)) {
      const nested = extractEcommerceSummary(value);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(data)) {
    for (const value of data) {
      const nested = extractEcommerceSummary(value);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}
