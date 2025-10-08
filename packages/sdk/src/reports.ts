import { matomoGet, MatomoHttpClient } from './httpClient.js';
import {
  campaignsSchema,
  deviceTypesSchema,
  ecommerceSummarySchema,
  entryPagesSchema,
  funnelResponseSchema,
  eventCategoriesSchema,
  eventsSchema,
  mostPopularUrlsSchema,
  topReferrersSchema,
  trafficChannelsSchema,
  goalConversionsSchema,
} from './schemas.js';
import type {
  Campaign,
  DeviceTypeSummary,
  EcommerceSummary,
  EntryPage,
  EventCategory,
  EventSummary,
  RawFunnelSummary,
  RawFunnelStep,
  MostPopularUrl,
  TopReferrer,
  TrafficChannel,
  RawGoalConversion,
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

export interface EcommerceRevenueTotalsInput extends EcommerceOverviewInput {
  includeSeries?: boolean;
}

export interface EcommerceRevenueSeriesPoint extends EcommerceSummary {
  label: string;
}

export interface EcommerceRevenueTotals {
  totals: EcommerceSummary;
  series?: EcommerceRevenueSeriesPoint[];
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

export interface TrafficChannelsInput {
  siteId: number;
  period: string;
  date: string;
  segment?: string;
  limit?: number;
  channelType?: string;
}

export interface GoalConversionsInput {
  siteId: number;
  period: string;
  date: string;
  segment?: string;
  limit?: number;
  goalId?: string | number;
  goalType?: string;
}

export interface GoalConversion {
  id: string;
  label: string;
  type: string;
  nb_conversions?: number;
  nb_visits_converted?: number;
  revenue?: number;
}

export interface FunnelSummaryInput {
  siteId: number;
  funnelId: string;
  period: string;
  date: string;
  segment?: string;
}

export interface FunnelStepSummary {
  id: string;
  label: string;
  visits?: number;
  conversions?: number;
  totalConversions?: number;
  conversionRate?: number;
  abandonmentRate?: number;
  overallConversionRate?: number;
  avgTimeToConvert?: number;
  medianTimeToConvert?: number;
}

export interface FunnelSummary {
  id: string;
  label: string;
  period: string;
  date: string;
  segment?: string;
  overallConversionRate?: number;
  abandonmentRate?: number;
  totalConversions?: number;
  totalVisits?: number;
  steps: FunnelStepSummary[];
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

  async getEcommerceRevenueTotals(input: EcommerceRevenueTotalsInput): Promise<EcommerceRevenueTotals> {
    const feature = 'ecommerceRevenueTotals';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<EcommerceRevenueTotals>(feature, cacheKey);
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

    const entries = collectEcommerceSummaries(data);
    const parsedEntries = entries.map(entry => ({
      label: entry.label,
      summary: ecommerceSummarySchema.parse(entry.value ?? {}),
    }));

    const summaries = parsedEntries.map(entry => entry.summary);
    const totals = summaries.length > 0 ? aggregateEcommerceSummaries(summaries) : ecommerceSummarySchema.parse({ revenue: 0, nb_conversions: 0 });

    const includeSeries = input.includeSeries ?? false;
    const seriesCandidates = parsedEntries.filter(entry => entry.label !== '');
    const series = includeSeries || seriesCandidates.length > 1
      ? seriesCandidates.map(entry => ({ label: entry.label, ...entry.summary }))
      : undefined;

    const result: EcommerceRevenueTotals = { totals, series };
    this.setCache(feature, cacheKey, result);
    return result;
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

  async getTrafficChannels(input: TrafficChannelsInput): Promise<TrafficChannel[]> {
    const feature = 'trafficChannels';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<TrafficChannel[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<TrafficChannel[]>(this.http, {
      method: 'Referrers.getReferrerType',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
      },
    });

    let parsed = trafficChannelsSchema.parse(data);

    if (input.channelType) {
      const target = resolveChannelAlias(input.channelType);
      parsed = parsed.filter(channel => resolveChannelAlias(channel.label) === target);
    }

    this.setCache(feature, cacheKey, parsed);
    return parsed;
  }

  async getGoalConversions(input: GoalConversionsInput): Promise<GoalConversion[]> {
    const feature = 'goalConversions';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<GoalConversion[]>(feature, cacheKey);
    if (cached) return cached;

    const data = await matomoGet<GoalConversion[]>(this.http, {
      method: 'Goals.get',
      params: {
        idSite: input.siteId,
        period: input.period,
        date: input.date,
        segment: input.segment,
        filter_limit: input.limit ?? 10,
        idGoal: input.goalId,
      },
    });

    const parsed = goalConversionsSchema.parse(data ?? []);
    const normalized = parsed.map(entry => normalizeGoalConversion(entry));

    const filtered = input.goalType
      ? normalized.filter(goal => normalizeGoalType(goal.type, goal.id) === normalizeGoalType(input.goalType))
      : normalized;

    this.setCache(feature, cacheKey, filtered);
    return filtered;
  }

  async getFunnelSummary(input: FunnelSummaryInput): Promise<FunnelSummary> {
    const feature = 'funnelSummary';
    const cacheKey = this.makeCacheKey(feature, input);
    const cached = this.getFromCache<FunnelSummary>(feature, cacheKey);
    if (cached) return cached;

    const response = await matomoGet<unknown>(this.http, {
      method: 'Funnels.getFunnel',
      params: {
        idSite: input.siteId,
        idFunnel: input.funnelId,
        period: input.period,
        date: input.date,
        segment: input.segment,
      },
    });

    const parsed = funnelResponseSchema.parse(response ?? {});
    const summaryRecord = extractFunnelSummary(parsed);
    const normalized = normalizeFunnelSummary(summaryRecord, input);

    this.setCache(feature, cacheKey, normalized);
    return normalized;
  }
}

function extractEcommerceSummary(data: unknown): Record<string, unknown> | undefined {
  const summaries = collectEcommerceSummaries(data);
  return summaries[0]?.value;
}

interface EcommerceSummaryCandidate {
  label: string;
  value: Record<string, unknown>;
}

function collectEcommerceSummaries(data: unknown, label = ''): EcommerceSummaryCandidate[] {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.flatMap((entry, index) => collectEcommerceSummaries(entry, labelForChild(label, String(index))));
  }

  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (isEcommerceSummaryCandidate(record)) {
      return [{ label, value: record }];
    }

    return Object.entries(record).flatMap(([key, value]) => collectEcommerceSummaries(value, labelForChild(label, key)));
  }

  return [];
}

function labelForChild(parent: string, child: string): string {
  const normalized = child.replace(/^idgoal[=:]/i, '').trim();
  return parent ? `${parent}.${normalized}` : normalized;
}

function isEcommerceSummaryCandidate(record: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, 'revenue') ||
    Object.prototype.hasOwnProperty.call(record, 'nb_conversions') ||
    Object.prototype.hasOwnProperty.call(record, 'avg_order_revenue')
  );
}

const numericEcommerceFields: Array<keyof EcommerceSummary> = [
  'nb_conversions',
  'nb_visits',
  'nb_visits_converted',
  'revenue',
  'revenue_per_visit',
  'revenue_per_conversion',
  'avg_order_revenue',
  'items',
  'revenue_subtotal',
  'revenue_tax',
  'revenue_shipping',
  'revenue_discount',
];

function aggregateEcommerceSummaries(summaries: EcommerceSummary[]): EcommerceSummary {
  const totals: Record<string, number> = {};

  for (const summary of summaries) {
    for (const field of numericEcommerceFields) {
      const value = summary[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        totals[field] = (totals[field] ?? 0) + value;
      }
    }
  }

  if (totals.nb_conversions && totals.nb_conversions > 0 && typeof totals.revenue === 'number') {
    totals.avg_order_revenue = totals.revenue / totals.nb_conversions;
    totals.revenue_per_conversion = totals.revenue / totals.nb_conversions;
  }

  return ecommerceSummarySchema.parse(totals);
}

function resolveChannelAlias(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

  switch (normalized) {
  case 'direct':
    case 'direct_entry':
      return 'direct_entry';
    case 'search':
    case 'organic_search':
    case 'paid_search':
    case 'search_engines':
      return 'search_engines';
    case 'referral':
    case 'referrers':
    case 'websites':
      return 'websites';
    case 'campaign':
    case 'campaigns':
      return 'campaigns';
    case 'social':
    case 'social_networks':
      return 'social_networks';
    default:
      return normalized;
  }
}

function normalizeGoalConversion(entry: RawGoalConversion): GoalConversion {
  const id = normalizeGoalId(entry.idgoal);
  const type = normalizeGoalType(entry.type, id);

  return {
    id,
    label: entry.goal ?? entry.name ?? formatGoalLabel(id),
    type,
    nb_conversions: entry.nb_conversions,
    nb_visits_converted: entry.nb_visits_converted,
    revenue: entry.revenue,
  } as GoalConversion;
}

function normalizeGoalId(id?: string | number): string {
  if (typeof id === 'number') return String(id);
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  return 'unknown';
}

function normalizeGoalType(type?: string, id?: string): string {
  const normalizedType = type?.trim().toLowerCase();
  const normalizedId = id?.trim().toLowerCase();

  if (normalizedId === 'ecommerceorder') {
    return 'ecommerce';
  }
  if (normalizedId === 'abandonedcart') {
    return 'ecommerce_cart';
  }
  if (normalizedType === 'manually') {
    return 'manual';
  }
  if (normalizedType) {
    return normalizedType;
  }
  return 'manual';
}

function formatGoalLabel(id: string): string {
  if (id === 'ecommerceOrder') {
    return 'Ecommerce Order';
  }
  if (id === 'abandonedCart') {
    return 'Abandoned Cart';
  }
  return id;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const normalized = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  return undefined;
}

function parsePercentage(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const withoutPercent = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
    return parseNumeric(withoutPercent);
  }

  return parseNumeric(value);
}

function normalizeIdentifier(value: unknown, fallback: string): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

function normalizeFunnelSummary(raw: RawFunnelSummary | undefined, context: FunnelSummaryInput): FunnelSummary {
  const id = normalizeIdentifier(raw?.idfunnel, context.funnelId);
  const labelCandidate = raw?.label ?? raw?.name;
  const label = typeof labelCandidate === 'string' && labelCandidate.trim().length > 0 ? labelCandidate.trim() : `Funnel ${id}`;

  const steps = normalizeFunnelSteps(raw?.steps);

  return {
    id,
    label,
    period: context.period,
    date: context.date,
    segment: context.segment,
    overallConversionRate: parsePercentage(raw?.overall_conversion_rate),
    abandonmentRate: parsePercentage(raw?.overall_abandonment_rate),
    totalConversions: parseNumeric(raw?.nb_conversions_total),
    totalVisits: parseNumeric(raw?.nb_visits_total),
    steps,
  };
}

function normalizeFunnelSteps(rawSteps: RawFunnelSummary['steps']): FunnelStepSummary[] {
  if (!rawSteps) {
    return [];
  }

  const records: RawFunnelStep[] = Array.isArray(rawSteps)
    ? rawSteps
    : Object.entries(rawSteps)
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([, value]) => value);

  return records
    .map((candidate, index) => normalizeFunnelStep(candidate, index))
    .filter((step): step is FunnelStepSummary => step !== undefined);
}

function normalizeFunnelStep(raw: RawFunnelStep | undefined, index: number): FunnelStepSummary | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const id = normalizeIdentifier(raw.idstep, String(index + 1));
  const labelCandidate = raw.label ?? raw.name;
  const label =
    typeof labelCandidate === 'string' && labelCandidate.trim().length > 0 ? labelCandidate.trim() : `Step ${index + 1}`;

  return {
    id,
    label,
    visits: parseNumeric(raw.nb_visits_total ?? raw.nb_users),
    conversions: parseNumeric(raw.nb_conversions),
    totalConversions: parseNumeric(raw.nb_conversions_total ?? raw.nb_targets),
    conversionRate: parsePercentage(raw.step_conversion_rate),
    abandonmentRate: parsePercentage(raw.step_abandonment_rate),
    overallConversionRate: parsePercentage(raw.overall_conversion_rate),
    avgTimeToConvert: parseNumeric(raw.avg_time_to_convert),
    medianTimeToConvert: parseNumeric(raw.median_time_to_convert),
  };
}

type ParsedFunnelResponse = ReturnType<typeof funnelResponseSchema.parse>;

function extractFunnelSummary(response: ParsedFunnelResponse): RawFunnelSummary | undefined {
  if (Array.isArray(response)) {
    return response[0];
  }

  if (response && typeof response === 'object' && 'steps' in response) {
    return response as RawFunnelSummary;
  }

  if (response && typeof response === 'object') {
    const values = Object.values(response as Record<string, RawFunnelSummary>);
    return values.length > 0 ? values[0] : undefined;
  }

  return undefined;
}
