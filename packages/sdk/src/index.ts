import { MatomoHttpClient, matomoGet } from './httpClient.js';
import { ReportsService } from './reports.js';
import { keyNumbersSchema, keyNumbersSeriesSchema } from './schemas.js';
import type {
  Campaign,
  EntryPage,
  EventSummary,
  KeyNumbers,
  MostPopularUrl,
  TopReferrer,
} from './schemas.js';
import {
  TrackingService,
  type TrackEventInput,
  type TrackGoalInput,
  type TrackPageviewInput,
  type TrackPageviewResult,
  type TrackResult,
} from './tracking.js';

export interface MatomoClientConfig {
  baseUrl: string;
  tokenAuth: string;
  defaultSiteId?: number;
  tracking?: {
    baseUrl?: string;
    maxRetries?: number;
    retryDelayMs?: number;
  };
  cacheTtlMs?: number;
}

export interface GetKeyNumbersInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
}

export interface GetEventsInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
  category?: string;
  action?: string;
  name?: string;
}

export interface GetEntryPagesInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
}

export interface GetCampaignsInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
}

export type GetKeyNumbersSeriesInput = GetKeyNumbersInput;

export interface KeyNumbersSeriesPoint extends KeyNumbers {
  date: string;
}

function assertSiteId(siteId: number | undefined): asserts siteId is number {
  if (typeof siteId !== 'number' || Number.isNaN(siteId)) {
    throw new Error('siteId is required');
  }
}

export class MatomoClient {
  private readonly http: MatomoHttpClient;
  private readonly reports: ReportsService;
  private readonly tracking: TrackingService;
  private readonly defaultSiteId?: number;

  constructor(config: MatomoClientConfig) {
    this.http = new MatomoHttpClient(config.baseUrl, config.tokenAuth);
    this.reports = new ReportsService(this.http, { cacheTtlMs: config.cacheTtlMs });
    this.tracking = new TrackingService({
      baseUrl: config.tracking?.baseUrl ?? config.baseUrl,
      tokenAuth: config.tokenAuth,
      maxRetries: config.tracking?.maxRetries,
      retryDelayMs: config.tracking?.retryDelayMs,
    });
    this.defaultSiteId = config.defaultSiteId;
  }

  private resolveSiteId(override?: number) {
    const value = override ?? this.defaultSiteId;
    assertSiteId(value);
    return value;
  }

  async getKeyNumbers(input: GetKeyNumbersInput = {}): Promise<KeyNumbers> {
    const siteId = this.resolveSiteId(input.siteId);

    const data = await matomoGet<KeyNumbers>(this.http, {
      method: 'VisitsSummary.get',
      params: {
        idSite: siteId,
        period: input.period ?? 'day',
        date: input.date ?? 'today',
        segment: input.segment,
      },
    });

    let pageviewSummary: Partial<Pick<KeyNumbers, 'nb_pageviews' | 'nb_uniq_pageviews'>> = {};

    try {
      const actionsSummary = await matomoGet<Record<string, unknown>>(this.http, {
        method: 'Actions.get',
        params: {
          idSite: siteId,
          period: input.period ?? 'day',
          date: input.date ?? 'today',
          segment: input.segment,
        },
      });

      const nb_pageviews = actionsSummary?.['nb_pageviews'];
      const nb_uniq_pageviews = actionsSummary?.['nb_uniq_pageviews'];

      pageviewSummary = {
        nb_pageviews: typeof nb_pageviews === 'number' ? nb_pageviews : undefined,
        nb_uniq_pageviews:
          typeof nb_uniq_pageviews === 'number' ? nb_uniq_pageviews : undefined,
      };
    } catch (error) {
      // swallow errors; nb_actions will still be returned
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Failed to fetch pageview summary from Actions.get', error);
      }
    }

    return keyNumbersSchema.parse({ ...data, ...pageviewSummary });
  }

  async getKeyNumbersSeries(input: GetKeyNumbersSeriesInput = {}): Promise<KeyNumbersSeriesPoint[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const period = input.period ?? 'day';
    const date = input.date ?? 'last7';

    const response = await matomoGet<Record<string, KeyNumbers>>(this.http, {
      method: 'VisitsSummary.get',
      params: {
        idSite: siteId,
        period,
        date,
        segment: input.segment,
      },
    });

    const parsed = keyNumbersSeriesSchema.parse(response ?? {});

    return Object.entries(parsed)
      .map(([label, value]) => ({ date: label, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getMostPopularUrls(
    input: Omit<Parameters<ReportsService['getMostPopularUrls']>[0], 'siteId'> & { siteId?: number }
  ): Promise<MostPopularUrl[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getMostPopularUrls({ ...input, siteId });
  }

  async getTopReferrers(
    input: Omit<Parameters<ReportsService['getTopReferrers']>[0], 'siteId'> & { siteId?: number }
  ): Promise<TopReferrer[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getTopReferrers({ ...input, siteId });
  }

  async getEvents(input: GetEventsInput = {}): Promise<EventSummary[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getEvents({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
      category: input.category,
      action: input.action,
      name: input.name,
    });
  }

  async getEntryPages(input: GetEntryPagesInput = {}): Promise<EntryPage[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getEntryPages({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
    });
  }

  async getCampaigns(input: GetCampaignsInput = {}): Promise<Campaign[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getCampaigns({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
    });
  }

  async trackPageview(
    input: Omit<TrackPageviewInput, 'siteId'> & { siteId?: number }
  ): Promise<TrackPageviewResult> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.tracking.trackPageview({ ...input, siteId });
  }

  async trackEvent(
    input: Omit<TrackEventInput, 'siteId'> & { siteId?: number }
  ): Promise<TrackResult> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.tracking.trackEvent({ ...input, siteId });
  }

  async trackGoal(
    input: Omit<TrackGoalInput, 'siteId'> & { siteId?: number }
  ): Promise<TrackResult> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.tracking.trackGoal({ ...input, siteId });
  }
}

export function createMatomoClient(config: MatomoClientConfig) {
  return new MatomoClient(config);
}

export type {
  KeyNumbers,
  KeyNumbersSeriesPoint,
  MostPopularUrl,
  EventSummary,
  EntryPage,
  Campaign,
  TopReferrer,
  TrackEventInput,
  TrackGoalInput,
  TrackPageviewInput,
  TrackPageviewResult,
  TrackResult,
};

export { TrackingService } from './tracking.js';
