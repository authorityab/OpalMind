import { MatomoHttpClient, matomoGet } from './httpClient.js';
import {
  ReportsService,
  type CacheStatsSnapshot,
  type ReportsServiceOptions,
  type CacheEvent,
  type EcommerceRevenueTotals,
  type EcommerceRevenueSeriesPoint,
  type EcommerceRevenueTotalsInput,
  type GoalConversion,
  type GoalConversionsInput,
} from './reports.js';
import { keyNumbersSchema, keyNumbersSeriesSchema } from './schemas.js';
import type {
  Campaign,
  DeviceTypeSummary,
  EcommerceSummary,
  EntryPage,
  EventCategory,
  EventSummary,
  KeyNumbers,
  MostPopularUrl,
  TopReferrer,
  TrafficChannel,
} from './schemas.js';
import {
  TrackingService,
  type TrackEventInput,
  type TrackGoalInput,
  type TrackPageviewInput,
  type TrackPageviewResult,
  type TrackResult,
} from './tracking.js';

export interface CacheConfig {
  ttlMs?: number;
  onEvent?: (event: CacheEvent) => void;
}

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
  cache?: CacheConfig;
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

export interface GetEcommerceOverviewInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
}

export interface GetEcommerceRevenueTotalsInput extends GetEcommerceOverviewInput {
  includeSeries?: boolean;
}

export interface GetEventCategoriesInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
}

export interface GetDeviceTypesInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
}

export interface GetTrafficChannelsInput {
  siteId?: number;
  period?: string;
  date?: string;
  segment?: string;
  limit?: number;
  channelType?: string;
}

export type GetGoalConversionsInput = Partial<Omit<GoalConversionsInput, 'siteId'>> & { siteId?: number };

export type GetKeyNumbersSeriesInput = GetKeyNumbersInput;

export interface KeyNumbersSeriesPoint extends KeyNumbers {
  date: string;
}

type DiagnosticCheckId = 'base-url' | 'token-auth' | 'site-access';

export type DiagnosticStatus = 'ok' | 'error' | 'skipped';

export interface MatomoDiagnosticError {
  type: 'matomo' | 'network' | 'unknown';
  message: string;
  code?: string | number;
}

export interface MatomoDiagnosticCheck {
  id: DiagnosticCheckId;
  label: string;
  status: DiagnosticStatus;
  details?: Record<string, unknown>;
  error?: MatomoDiagnosticError;
  skippedReason?: string;
}

export interface RunDiagnosticsInput {
  siteId?: number;
}

export interface RunDiagnosticsResult {
  checks: MatomoDiagnosticCheck[];
}

const keyNumberNumericFields: Array<keyof KeyNumbers> = [
  'nb_visits',
  'nb_uniq_visitors',
  'nb_actions',
  'nb_users',
  'nb_visits_converted',
  'sum_visit_length',
  'max_actions',
  'nb_pageviews',
  'nb_uniq_pageviews',
];

function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.toLowerCase() === 'nan') return undefined;
    const normalized = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(normalized) ? normalized : undefined;
  }
  return undefined;
}

function sumSeriesValues(series: unknown): number | undefined {
  if (!series || (typeof series !== 'object' && !Array.isArray(series))) {
    return undefined;
  }

  const values = Array.isArray(series)
    ? series
    : Object.values(series as Record<string, unknown>);

  let total = 0;
  let seen = false;

  for (const value of values) {
    if (value && typeof value === 'object') {
      const nested = sumSeriesValues(value);
      if (nested !== undefined) {
        total += nested;
        seen = true;
        continue;
      }
    }

    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) {
      total += numeric;
      seen = true;
    }
  }

  return seen ? total : undefined;
}

function sanitizeKeyNumbers(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...raw };

  for (const field of keyNumberNumericFields) {
    const current = sanitized[field as string];
    const coerced = toFiniteNumber(current);

    if (coerced !== undefined) {
      sanitized[field as string] = coerced;
      continue;
    }

    if (field === 'nb_visits') {
      const fromSeries =
        sumSeriesValues(raw?.['nb_visits_series']) ?? sumSeriesValues(raw?.['nb_visits']);
      sanitized[field as string] = fromSeries ?? 0;
    } else {
      delete sanitized[field as string];
    }
  }

  return sanitized;
}

interface MatomoErrorPayload {
  result?: unknown;
  message?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

class DiagnosticMatomoError extends Error {
  readonly code?: string | number;

  constructor(message: string, code?: string | number) {
    super(message);
    this.name = 'DiagnosticMatomoError';
    this.code = code;
  }
}

function extractMatomoError(payload: unknown): { message: string; code?: string | number } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const cast = payload as MatomoErrorPayload;
  const result = typeof cast.result === 'string' ? cast.result.toLowerCase() : undefined;

  if (result === 'error') {
    const message = typeof cast.message === 'string' ? cast.message : 'Matomo reported an error.';
    const codeValue = cast.code;
    const code = typeof codeValue === 'string' || typeof codeValue === 'number' ? codeValue : undefined;
    return { message, code };
  }

  if ('error' in cast && typeof cast.error === 'string') {
    return { message: cast.error };
  }

  return undefined;
}

function toDiagnosticError(error: unknown): MatomoDiagnosticError {
  if (error instanceof DiagnosticMatomoError) {
    return {
      type: 'matomo',
      message: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    const message = error.message || 'Unknown error';
    const type = message.toLowerCase().includes('fetch failed') ? 'network' : 'unknown';
    return { type, message };
  }

  return { type: 'unknown', message: String(error) };
}

type DiagnosticHandler = () => Promise<Record<string, unknown> | void>;

async function performDiagnosticCheck(
  id: DiagnosticCheckId,
  label: string,
  handler: DiagnosticHandler
): Promise<MatomoDiagnosticCheck> {
  try {
    const details = await handler();
    return {
      id,
      label,
      status: 'ok',
      ...(details ? { details } : {}),
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      error: toDiagnosticError(error),
    };
  }
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
    const reportsOptions: ReportsServiceOptions = {
      cacheTtlMs: config.cache?.ttlMs ?? config.cacheTtlMs,
      onCacheEvent: config.cache?.onEvent,
    };
    this.reports = new ReportsService(this.http, reportsOptions);
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

      const nb_pageviews = toFiniteNumber(actionsSummary?.['nb_pageviews']);
      const nb_uniq_pageviews = toFiniteNumber(actionsSummary?.['nb_uniq_pageviews']);

      pageviewSummary = {
        nb_pageviews: nb_pageviews ?? undefined,
        nb_uniq_pageviews: nb_uniq_pageviews ?? undefined,
      };
    } catch (error) {
      // swallow errors; nb_actions will still be returned
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Failed to fetch pageview summary from Actions.get', error);
      }
    }

    const payload = sanitizeKeyNumbers({ ...data, ...pageviewSummary });
    const parsed = keyNumbersSchema.parse(payload);

    const normalized: KeyNumbers = { ...parsed };

    for (const field of keyNumberNumericFields) {
      const value = normalized[field];

      if (typeof value !== 'number') {
        continue;
      }

      if (Number.isFinite(value)) {
        continue;
      }

      if (field === 'nb_visits') {
        normalized.nb_visits = 0;
        continue;
      }

      normalized[field] = undefined;
    }

    return normalized;
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

  async getEcommerceOverview(input: GetEcommerceOverviewInput = {}): Promise<EcommerceSummary> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getEcommerceOverview({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
    });
  }

  async getEcommerceRevenueTotals(
    input: GetEcommerceRevenueTotalsInput = {}
  ): Promise<EcommerceRevenueTotals> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getEcommerceRevenueTotals({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      includeSeries: input.includeSeries,
    });
  }

  async getEventCategories(input: GetEventCategoriesInput = {}): Promise<EventCategory[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getEventCategories({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
    });
  }

  async getDeviceTypes(input: GetDeviceTypesInput = {}): Promise<DeviceTypeSummary[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getDeviceTypes({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
    });
  }

  async getTrafficChannels(input: GetTrafficChannelsInput = {}): Promise<TrafficChannel[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getTrafficChannels({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
      channelType: input.channelType,
    });
  }

  async getGoalConversions(input: GetGoalConversionsInput = {}): Promise<GoalConversion[]> {
    const siteId = this.resolveSiteId(input.siteId);
    return this.reports.getGoalConversions({
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
      segment: input.segment,
      limit: input.limit,
      goalId: input.goalId,
      goalType: input.goalType,
    });
  }

  getCacheStats(): CacheStatsSnapshot {
    return this.reports.getCacheStats();
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

  async runDiagnostics(input: RunDiagnosticsInput = {}): Promise<RunDiagnosticsResult> {
    const checks: MatomoDiagnosticCheck[] = [];

    const baseCheck = await performDiagnosticCheck('base-url', 'Matomo base URL reachability', async () => {
      const payload = await matomoGet<unknown>(this.http, {
        method: 'API.getVersion',
      });

      const errorInfo = extractMatomoError(payload);
      if (errorInfo) {
        throw new DiagnosticMatomoError(errorInfo.message, errorInfo.code);
      }

      if (typeof payload === 'string') {
        return { version: payload };
      }

      if (payload && typeof payload === 'object') {
        const version = (payload as Record<string, unknown>)['version'];
        if (typeof version === 'string') {
          return { version };
        }
      }

      return undefined;
    });

    checks.push(baseCheck);

    if (baseCheck.status !== 'ok') {
      checks.push({
        id: 'token-auth',
        label: 'Token authentication',
        status: 'skipped',
        skippedReason: 'Matomo base URL could not be reached.',
      });
      checks.push({
        id: 'site-access',
        label: 'Site access permissions',
        status: 'skipped',
        skippedReason: 'Matomo base URL could not be reached.',
      });

      return { checks };
    }

    const tokenCheck = await performDiagnosticCheck('token-auth', 'Token authentication', async () => {
      const payload = await matomoGet<unknown>(this.http, {
        method: 'API.getLoggedInUser',
      });

      const errorInfo = extractMatomoError(payload);
      if (errorInfo) {
        throw new DiagnosticMatomoError(errorInfo.message, errorInfo.code);
      }

      if (payload && typeof payload === 'object') {
        const login = (payload as Record<string, unknown>)['login'];
        if (typeof login === 'string') {
          return { login };
        }
      }

      return undefined;
    });

    checks.push(tokenCheck);

    if (tokenCheck.status !== 'ok') {
      checks.push({
        id: 'site-access',
        label: 'Site access permissions',
        status: 'skipped',
        skippedReason: 'Authentication failed, unable to verify site permissions.',
      });

      return { checks };
    }

    let resolvedSiteId: number | undefined;
    let siteIdError: MatomoDiagnosticError | undefined;

    try {
      resolvedSiteId = this.resolveSiteId(input.siteId);
    } catch (error) {
      siteIdError = toDiagnosticError(error);
    }

    if (siteIdError) {
      checks.push({
        id: 'site-access',
        label: 'Site access permissions',
        status: 'error',
        error: siteIdError,
      });

      return { checks };
    }

    const siteIdForCheck = resolvedSiteId as number;

    const siteCheck = await performDiagnosticCheck('site-access', 'Site access permissions', async () => {
      const payload = await matomoGet<unknown>(this.http, {
        method: 'SitesManager.getSiteFromId',
        params: { idSite: siteIdForCheck },
      });

      const errorInfo = extractMatomoError(payload);
      if (errorInfo) {
        throw new DiagnosticMatomoError(errorInfo.message, errorInfo.code);
      }

      if (payload && typeof payload === 'object') {
        const data = payload as Record<string, unknown>;
        const idsite = typeof data.idsite === 'string' || typeof data.idsite === 'number' ? data.idsite : undefined;
        const name = typeof data.name === 'string' ? data.name : undefined;

        if (idsite !== undefined || name !== undefined) {
          const details: Record<string, unknown> = {};
          if (idsite !== undefined) details.idsite = idsite;
          if (name !== undefined) details.name = name;
          return details;
        }
      }

      return undefined;
    });

    checks.push(siteCheck);

    return { checks };
  }
}

export function createMatomoClient(config: MatomoClientConfig) {
  return new MatomoClient(config);
}

export type {
  KeyNumbers,
  MostPopularUrl,
  EventSummary,
  EntryPage,
  Campaign,
  DeviceTypeSummary,
  EcommerceSummary,
  TopReferrer,
  EventCategory,
  TrackEventInput,
  TrackGoalInput,
  TrackPageviewInput,
  TrackPageviewResult,
  TrackResult,
  CacheStatsSnapshot,
  CacheEvent,
  EcommerceRevenueTotals,
  EcommerceRevenueSeriesPoint,
  EcommerceRevenueTotalsInput,
  TrafficChannel,
  GoalConversion,
};

export { TrackingService } from './tracking.js';
