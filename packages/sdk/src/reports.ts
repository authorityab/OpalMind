import { matomoGet, MatomoHttpClient } from './httpClient.js';
import { campaignsSchema, entryPagesSchema, eventsSchema, mostPopularUrlsSchema, topReferrersSchema } from './schemas.js';
import type { Campaign, EntryPage, EventSummary, MostPopularUrl, TopReferrer } from './schemas.js';

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

export class ReportsService {
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly cacheTtlMs: number;

  constructor(private readonly http: MatomoHttpClient, options: { cacheTtlMs?: number } = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  private setCache<T>(key: string, value: T) {
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
  }

  async getMostPopularUrls(input: MostPopularUrlsInput): Promise<MostPopularUrl[]> {
    const cacheKey = JSON.stringify({ feature: 'popularUrls', input });
    const cached = this.getFromCache<MostPopularUrl[]>(cacheKey);
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
    this.setCache(cacheKey, parsed);
    return parsed;
  }

  async getTopReferrers(input: TopReferrersInput): Promise<TopReferrer[]> {
    const cacheKey = JSON.stringify({ feature: 'topReferrers', input });
    const cached = this.getFromCache<TopReferrer[]>(cacheKey);
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
    this.setCache(cacheKey, parsed);
    return parsed;
  }

  async getEvents(input: EventsInput): Promise<EventSummary[]> {
    const cacheKey = JSON.stringify({ feature: 'events', input });
    const cached = this.getFromCache<EventSummary[]>(cacheKey);
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
    this.setCache(cacheKey, parsed);
    return parsed;
  }

  async getEntryPages(input: EntryPagesInput): Promise<EntryPage[]> {
    const cacheKey = JSON.stringify({ feature: 'entryPages', input });
    const cached = this.getFromCache<EntryPage[]>(cacheKey);
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
    this.setCache(cacheKey, parsed);
    return parsed;
  }

  async getCampaigns(input: CampaignsInput): Promise<Campaign[]> {
    const cacheKey = JSON.stringify({ feature: 'campaigns', input });
    const cached = this.getFromCache<Campaign[]>(cacheKey);
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
    this.setCache(cacheKey, parsed);
    return parsed;
  }
}
