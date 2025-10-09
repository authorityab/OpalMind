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

    const data = await matomoGet<unknown>(this.http, {
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

    const normalizedResponse = normalizeGoalConversionResponse(data, input);
    const parsed = goalConversionsSchema.parse(normalizedResponse);
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

    const baseParams = {
      idSite: input.siteId,
      idFunnel: input.funnelId,
      period: input.period,
      date: input.date,
      segment: input.segment,
    };

    const [configResult, metricsResult, flowResult] = await Promise.allSettled([
      matomoGet<unknown>(this.http, {
        method: 'Funnels.getFunnel',
        params: baseParams,
      }),
      matomoGet<unknown>(this.http, {
        method: 'Funnels.getFunnelMetrics',
        params: baseParams,
      }),
      matomoGet<unknown>(this.http, {
        method: 'Funnels.getFunnelFlowTable',
        params: { ...baseParams, flat: 1 },
      }),
    ]);

    const config = configResult.status === 'fulfilled' ? coerceFunnelConfig(configResult.value, input) : {};
    const metrics = metricsResult.status === 'fulfilled' ? normalizeFunnelMetrics(metricsResult.value) : {};
    const flowSteps = flowResult.status === 'fulfilled' ? normalizeFunnelSteps(flowResult.value) : [];

    const steps = mergeFunnelSteps(config.steps ?? [], flowSteps);
    const funnelId = config.id ?? normalizeIdentifier(undefined, input.funnelId);
    const summary: FunnelSummary = {
      id: funnelId,
      label: config.label ?? `Funnel ${funnelId}`,
      period: input.period,
      date: input.date,
      segment: input.segment,
      overallConversionRate: firstDefined(metrics.overallConversionRate, config.overallConversionRate),
      abandonmentRate: firstDefined(metrics.abandonmentRate, config.abandonmentRate),
      totalConversions: firstDefined(metrics.totalConversions, config.totalConversions),
      totalVisits: firstDefined(metrics.totalVisits, config.totalVisits),
      steps: steps.length > 0 ? steps : config.steps ?? [],
    };

    if (summary.totalConversions === undefined) {
      const total = sumDefined(summary.steps.map(step => firstDefined(step.totalConversions, step.conversions)));
      if (total !== undefined) {
        summary.totalConversions = total;
      }
    }

    if (summary.totalVisits === undefined) {
      const visits = sumDefined(summary.steps.map(step => step.visits));
      if (visits !== undefined) {
        summary.totalVisits = visits;
      }
    }

    if (summary.overallConversionRate === undefined && summary.totalConversions !== undefined && summary.totalVisits !== undefined && summary.totalVisits > 0) {
      summary.overallConversionRate = (summary.totalConversions / summary.totalVisits) * 100;
    }

    const result = summary;
    this.setCache(feature, cacheKey, result);
    return result;
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

type PartialFunnelSummary = Partial<Omit<FunnelSummary, 'steps'>> & { steps?: FunnelStepSummary[] };

function coerceFunnelConfig(raw: unknown, context: FunnelSummaryInput, seen = new Set<unknown>()): PartialFunnelSummary {
  if (!raw || typeof raw !== 'object') {
    const conversions = parseNumeric(raw);
    if (conversions !== undefined) {
      return { totalConversions: conversions };
    }
    return {};
  }

  if (seen.has(raw)) {
    return {};
  }
  seen.add(raw);

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const result = coerceFunnelConfig(item, context, seen);
      if (hasFunnelData(result)) {
        return result;
      }
    }
    return {};
  }

  const record = raw as Record<string, unknown>;
  const lc = lowerCaseKeys(record);

  const idCandidate = getStringFromMap(lc, ['idfunnel', 'id_funnel', 'id', 'funnelid']);
  const id = normalizeIdentifier(idCandidate, context.funnelId);
  const label = getStringFromMap(lc, ['label', 'name', 'funnelname', 'funnel_name', 'title']);

  const totalConversions = getNumericFromMap(lc, [
    'nb_conversions_total',
    'nb_conversions',
    'conversions',
    'nbconverted',
    'nb_targets',
  ]);
  const totalVisits = getNumericFromMap(lc, ['nb_visits_total', 'nb_visits', 'visits', 'nb_entries', 'nb_entrances', 'entries']);
  const overallConversionRate = getPercentageFromMap(lc, [
    'overall_conversion_rate',
    'conversion_rate',
    'total_conversion_rate',
  ]);
  const abandonmentRate = getPercentageFromMap(lc, ['overall_abandonment_rate', 'abandonment_rate', 'dropoff_rate']);

  let steps: FunnelStepSummary[] = [];
  if (lc.has('steps')) {
    steps = normalizeFunnelSteps(lc.get('steps'));
  }

  if (steps.length === 0) {
    steps = normalizeFunnelSteps(record);
  }

  const summary: PartialFunnelSummary = {
    id,
    label,
    totalConversions,
    totalVisits,
    overallConversionRate,
    abandonmentRate,
    steps,
  };

  if (hasFunnelData(summary)) {
    return summary;
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'object') {
      const nested = coerceFunnelConfig(value, context, seen);
      if (hasFunnelData(nested)) {
        return nested;
      }
    }
  }

  return {};
}

function normalizeFunnelMetrics(raw: unknown): PartialFunnelSummary {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const result = normalizeFunnelMetrics(item);
      if (hasFunnelData(result)) {
        return result;
      }
    }
    return {};
  }

  if (!raw || typeof raw !== 'object') {
    const conversions = parseNumeric(raw);
    if (conversions !== undefined) {
      return { totalConversions: conversions };
    }
    return {};
  }

  const record = raw as Record<string, unknown>;
  const lc = lowerCaseKeys(record);

  return {
    totalConversions: getNumericFromMap(lc, [
      'nb_conversions',
      'nb_converted',
      'conversions',
      'goalconversions',
      'nb_conversions_total',
    ]),
    totalVisits: getNumericFromMap(lc, ['nb_visits', 'nb_entries', 'entries', 'visits', 'nb_entrances', 'nb_visits_total']),
    overallConversionRate: getPercentageFromMap(lc, ['conversion_rate', 'overall_conversion_rate', 'total_conversion_rate']),
    abandonmentRate: getPercentageFromMap(lc, ['abandonment_rate', 'overall_abandonment_rate', 'dropoff_rate']),
    steps: normalizeFunnelSteps(record),
  };
}

function normalizeFunnelSteps(raw: unknown): FunnelStepSummary[] {
  const records = extractStepRecords(raw);
  return normalizeFunnelStepRecords(records);
}

function mergeFunnelSteps(baseSteps: FunnelStepSummary[], flowSteps: FunnelStepSummary[]): FunnelStepSummary[] {
  if (baseSteps.length === 0) return flowSteps;
  if (flowSteps.length === 0) return baseSteps;

  const map = new Map<string, FunnelStepSummary>();
  const order: string[] = [];

  const keyFor = (step: FunnelStepSummary) => `${step.id.toLowerCase()}|${(step.label ?? '').toLowerCase()}`;

  const applyStep = (step: FunnelStepSummary) => {
    const key = keyFor(step);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...step });
      order.push(key);
      return;
    }
    map.set(key, mergeStepData(existing, step));
  };

  baseSteps.forEach(applyStep);
  flowSteps.forEach(applyStep);

  return order
    .map(key => map.get(key)!)
    .sort((a, b) => {
      const aNum = Number.parseFloat(a.id);
      const bNum = Number.parseFloat(b.id);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }
      return a.label.localeCompare(b.label);
    });
}

function normalizeGoalConversionResponse(data: unknown, context: GoalConversionsInput): unknown[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;

    if (isGoalConversionRecord(record)) {
      const ensured = ensureGoalRecord(record, context);
      return ensured ? [ensured] : [];
    }

    const normalizedValues = Object.values(record)
      .map(value => ensureGoalRecord(value, context))
      .filter((value): value is Record<string, unknown> => value !== undefined);

    if (normalizedValues.length > 0) {
      return normalizedValues;
    }

    const ensured = ensureGoalRecord(record, context);
    return ensured ? [ensured] : [];
  }

  const ensured = ensureGoalRecord(data, context);
  if (ensured) {
    return [ensured];
  }

  return [];
}

function ensureGoalRecord(value: unknown, context: GoalConversionsInput): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') {
    const record = { ...(value as Record<string, unknown>) };
    if (record.idgoal === undefined && context.goalId !== undefined) {
      record.idgoal = context.goalId;
    }
    return record;
  }

  const conversions = parseNumeric(value);
  if (conversions === undefined) {
    return undefined;
  }

  const idgoal =
    context.goalId !== undefined
      ? typeof context.goalId === 'number'
        ? context.goalId
        : context.goalId
      : 'unknown';

  return {
    idgoal,
    nb_conversions: conversions,
  };
}

function isGoalConversionRecord(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.some(key => key === 'goal' || key === 'name' || key === 'idgoal' || key === 'nb_conversions');
}

function hasFunnelData(summary: PartialFunnelSummary): boolean {
  return (
    summary.id !== undefined ||
    summary.label !== undefined ||
    summary.totalConversions !== undefined ||
    summary.totalVisits !== undefined ||
    summary.overallConversionRate !== undefined ||
    summary.abandonmentRate !== undefined ||
    (summary.steps !== undefined && summary.steps.length > 0)
  );
}

function lowerCaseKeys(record: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    map.set(key.toLowerCase(), value);
  }
  return map;
}

function getNumericFromMap(map: Map<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (value === undefined) {
      continue;
    }
    const numeric = parseNumeric(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }
  return undefined;
}

function getPercentageFromMap(map: Map<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (value === undefined) {
      continue;
    }
    const percentage = parsePercentage(value);
    if (percentage !== undefined) {
      return percentage;
    }
  }
  return undefined;
}

function getStringFromMap(map: Map<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}

function extractStepRecords(raw: unknown, seen = new Set<unknown>()): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  if (seen.has(raw)) {
    return [];
  }
  seen.add(raw);

  if (Array.isArray(raw)) {
    const results: Record<string, unknown>[] = [];
    for (const item of raw) {
      results.push(...extractStepRecords(item, seen));
    }
    return results;
  }

  const record = raw as Record<string, unknown>;
  const lc = lowerCaseKeys(record);
  const results: Record<string, unknown>[] = [];

  if (isStepRecord(lc) && !lc.has('steps')) {
    results.push(record);
  } else if (record.columns && typeof record.columns === 'object' && !Array.isArray(record.columns)) {
    const merged = { label: record.label, ...(record.columns as Record<string, unknown>) };
    results.push(merged);
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'object') {
      results.push(...extractStepRecords(value, seen));
    }
  }

  return results;
}

function isStepRecord(map: Map<string, unknown>): boolean {
  const keys = Array.from(map.keys());
  const labelKeys = ['label', 'name', 'step', 'step_position', 'step_name', 'title'];
  const metricIndicators = [
    'nb_conversions',
    'nb_converted',
    'nb_visits',
    'nb_visits_total',
    'nb_entries',
    'nb_entrances',
    'conversion_rate',
    'step_conversion_rate',
    'abandonment_rate',
    'step_abandonment_rate',
  ];
  const hasLabel = keys.some(key => labelKeys.includes(key));
  const hasMetrics = keys.some(key => metricIndicators.includes(key) || key.startsWith('nb_') || key.includes('conversion'));
  return hasLabel && hasMetrics;
}

function normalizeFunnelStepRecords(records: Record<string, unknown>[]): FunnelStepSummary[] {
  const map = new Map<string, FunnelStepSummary>();
  const order: string[] = [];

  records.forEach((record, index) => {
    const lc = lowerCaseKeys(record);
    const idCandidate = getStringFromMap(lc, ['idstep', 'step_position', 'position', 'step', 'id']);
    const labelCandidate = getStringFromMap(lc, ['label', 'name', 'step_name', 'title']);

    const id = normalizeIdentifier(idCandidate, String(index + 1));
    const label = labelCandidate ?? `Step ${index + 1}`;
    const key = `${id.toLowerCase()}|${label.toLowerCase()}`;

    const step: FunnelStepSummary = {
      id,
      label,
      visits: getNumericFromMap(lc, ['nb_visits_total', 'nb_visits', 'nb_entries', 'nb_entrances', 'visits', 'entries']),
      conversions: getNumericFromMap(lc, ['nb_conversions', 'nb_converted', 'conversions', 'nb_targets', 'nb_visits_converted']),
      totalConversions: getNumericFromMap(lc, ['nb_conversions_total', 'total_conversions']),
      conversionRate: getPercentageFromMap(lc, ['conversion_rate', 'step_conversion_rate']),
      abandonmentRate: getPercentageFromMap(lc, ['abandonment_rate', 'step_abandonment_rate', 'dropoff_rate']),
      overallConversionRate: getPercentageFromMap(lc, ['overall_conversion_rate', 'step_overall_conversion_rate']),
      avgTimeToConvert: getNumericFromMap(lc, ['avg_time_to_convert', 'avg_time']),
      medianTimeToConvert: getNumericFromMap(lc, ['median_time_to_convert', 'median_time']),
    };

    const existing = map.get(key);
    if (!existing) {
      map.set(key, step);
      order.push(key);
      return;
    }

    map.set(key, mergeStepData(existing, step));
  });

  const steps = order.map(key => map.get(key)!);

  return steps.sort((a, b) => {
    const aNum = Number.parseFloat(a.id);
    const bNum = Number.parseFloat(b.id);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
      return aNum - bNum;
    }
    return a.label.localeCompare(b.label);
  });
}

function mergeStepData(base: FunnelStepSummary, extra: FunnelStepSummary): FunnelStepSummary {
  const merged: FunnelStepSummary = { ...base };

  if (extra.visits !== undefined) merged.visits = extra.visits;
  if (extra.conversions !== undefined) merged.conversions = extra.conversions;
  if (extra.totalConversions !== undefined) merged.totalConversions = extra.totalConversions;
  if (extra.conversionRate !== undefined) merged.conversionRate = extra.conversionRate;
  if (extra.abandonmentRate !== undefined) merged.abandonmentRate = extra.abandonmentRate;
  if (extra.overallConversionRate !== undefined) merged.overallConversionRate = extra.overallConversionRate;
  if (extra.avgTimeToConvert !== undefined) merged.avgTimeToConvert = extra.avgTimeToConvert;
  if (extra.medianTimeToConvert !== undefined) merged.medianTimeToConvert = extra.medianTimeToConvert;

  return merged;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : undefined;
}
