import { logger as baseLogger } from '@opalmind/logger';

import {
  MatomoHttpClient,
  matomoGet,
  type MatomoRateLimitEvent,
  type MatomoRateLimitOptions,
  type MatomoRetryOptions,
  type MatomoHttpClientOptions,
} from './httpClient.js';
import {
  ReportsService,
  type CacheStatsSnapshot,
  type ReportsServiceOptions,
  type CacheEvent,
  type RawEcommerceRevenueSeriesPoint,
  type EcommerceRevenueTotalsInput,
  type GoalConversionsInput,
  type FunnelSummary,
  type FunnelStepSummary,
  type RawEcommerceSummary,
} from './reports.js';
import { keyNumbersSchema, keyNumbersSeriesSchema } from './schemas.js';
import type {
  DeviceTypeSummary,
  EntryPage,
  EventCategory,
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
  type TrackingIdempotencyRecord,
  type TrackingIdempotencyStore,
  type TrackingQueueStats,
  type TrackingBackoffOptions,
  type TrackingOptions,
} from './tracking.js';
import {
  MatomoApiError,
  MatomoClientError,
  MatomoNetworkError,
  MatomoPermissionError,
  type MatomoErrorDetails,
} from './errors.js';

const sdkLogger = baseLogger.child({ package: '@opalmind/sdk' });

export interface CacheConfig {
  ttlMs?: number;
  onEvent?: (event: CacheEvent) => void;
}

export interface MatomoClientConfig {
  baseUrl: string;
  tokenAuth: string;
  defaultSiteId?: number;
  http?: {
    timeoutMs?: number;
    retry?: MatomoRetryOptions;
  };
  tracking?: {
    baseUrl?: string;
    maxRetries?: number;
    retryDelayMs?: number;
    idempotencyStore?: TrackingIdempotencyStore;
    backoff?: TrackingBackoffOptions;
    healthThresholds?: Partial<TrackingQueueThresholds>;
  };
  cacheTtlMs?: number;
  cache?: CacheConfig;
  rateLimit?: MatomoRateLimitOptions;
  cacheHealth?: Partial<CacheHealthThresholds>;
}

export interface TrackingQueueThresholds {
  pendingWarn: number;
  pendingFail: number;
  ageWarnMs: number;
  ageFailMs: number;
}

export interface CacheHealthThresholds {
  warnHitRate: number;
  failHitRate: number;
  sampleSize: number;
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

export interface GetFunnelSummaryInput {
  siteId?: number;
  funnelId: string;
  period?: string;
  date?: string;
  segment?: string;
}

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
  guidance?: string;
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

export interface HealthCheckStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  componentType: 'service' | 'database' | 'cache' | 'queue';
  observedValue?: string | number;
  observedUnit?: string;
  time?: string;
  output?: string;
  details?: Record<string, unknown>;
}

export interface GetHealthStatusInput {
  includeDetails?: boolean;
  siteId?: number;
}

type UnknownRecord = Record<string, unknown>;

export interface MonetaryValue {
  value: number;
  currency: string | null;
}

export interface Campaign extends UnknownRecord {
  label: string;
  nb_visits?: number;
  nb_actions?: number;
  nb_visits_converted?: number;
  revenue?: MonetaryValue;
}

export interface TrafficChannel extends UnknownRecord {
  label: string;
  nb_visits?: number;
  nb_actions?: number;
  nb_visits_converted?: number;
  sum_visit_length?: number;
  nb_hits?: number;
  bounce_rate?: string;
  revenue?: MonetaryValue;
  goals?: UnknownRecord;
}

export interface GoalConversion extends UnknownRecord {
  id: string;
  label: string;
  type: string;
  nb_conversions?: number;
  nb_visits_converted?: number;
  revenue?: MonetaryValue;
}

export interface EcommerceSummary extends UnknownRecord {
  nb_conversions?: number;
  nb_visits?: number;
  nb_visits_converted?: number;
  conversion_rate?: string;
  revenue?: MonetaryValue;
  revenue_per_visit?: MonetaryValue;
  revenue_per_conversion?: MonetaryValue;
  avg_order_revenue?: MonetaryValue;
  items?: number;
  revenue_subtotal?: MonetaryValue;
  revenue_tax?: MonetaryValue;
  revenue_shipping?: MonetaryValue;
  revenue_discount?: MonetaryValue;
}

export interface EcommerceRevenueSeriesPoint extends EcommerceSummary {
  label: string;
}

export interface EcommerceRevenueTotals {
  totals: EcommerceSummary;
  series?: EcommerceRevenueSeriesPoint[];
}

const monetaryFieldTokens = new Set([
  'revenue',
  'revenuepervisit',
  'revenueperconversion',
  'avgorderrevenue',
  'revenuesubtotal',
  'revenuetax',
  'revenueshipping',
  'revenuediscount',
]);

function normalizeMonetaryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

function isMonetaryField(key: string): boolean {
  return monetaryFieldTokens.has(normalizeMonetaryKey(key));
}

function toMonetaryNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function createMonetaryValue(value: number, currency: string | undefined): MonetaryValue {
  return {
    value,
    currency: currency ?? null,
  };
}

function transformNestedWithCurrency(value: unknown, currency: string | undefined): unknown {
  if (Array.isArray(value)) {
    return value.map(item => transformNestedWithCurrency(item, currency));
  }

  if (value && typeof value === 'object') {
    return enrichRecordWithCurrency(value as Record<string, unknown>, currency);
  }

  return value;
}

function enrichRecordWithCurrency<T extends Record<string, unknown>>(record: T, currency: string | undefined): T {
  const result: Record<string, unknown> = { ...record };

  for (const [key, current] of Object.entries(record)) {
    if (current === undefined || current === null) {
      continue;
    }

    const numericValue = toMonetaryNumber(current);
    if (numericValue !== undefined && isMonetaryField(key)) {
      result[key] = createMonetaryValue(numericValue, currency);
      continue;
    }

    if (Array.isArray(current) || (typeof current === 'object' && current !== null)) {
      result[key] = transformNestedWithCurrency(current, currency);
    }
  }

  return result as T;
}

function adaptEcommerceSummary(summary: RawEcommerceSummary, currency: string | undefined): EcommerceSummary {
  return enrichRecordWithCurrency(summary as UnknownRecord, currency) as unknown as EcommerceSummary;
}

function adaptEcommerceRevenueSeriesPoint(
  point: RawEcommerceRevenueSeriesPoint,
  currency: string | undefined
): EcommerceRevenueSeriesPoint {
  const { label, ...rest } = point;
  const summary = adaptEcommerceSummary(rest as RawEcommerceSummary, currency);
  return {
    label,
    ...summary,
  };
}

function firstSiteRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!payload) return undefined;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry && typeof entry === 'object') {
        return entry as Record<string, unknown>;
      }
    }
    return undefined;
  }

  if (typeof payload === 'object') {
    return payload as Record<string, unknown>;
  }

  return undefined;
}

function extractSiteCurrency(payload: unknown): string | undefined {
  const record = firstSiteRecord(payload);
  if (!record) return undefined;

  const candidates = [
    record.currency,
    record.currencyCode,
    record.currency_symbol,
    record.currencySymbol,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed.toUpperCase();
      }
    }
  }

  return undefined;
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

function parseDurationSeconds(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined) {
    return numeric;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const colonParts = trimmed.split(':');
  if (colonParts.length >= 2 && colonParts.length <= 3 && colonParts.every(part => /^\d+$/.test(part))) {
    if (colonParts.length === 3) {
      const [hoursStr, minutesStr, secondsStr] = colonParts as [string, string, string];
      const hours = Number.parseInt(hoursStr, 10);
      const minutes = Number.parseInt(minutesStr, 10);
      const seconds = Number.parseInt(secondsStr, 10);
      if ([hours, minutes, seconds].some(value => !Number.isFinite(value))) {
        return undefined;
      }
      return hours * 3600 + minutes * 60 + seconds;
    }

    const [minutesStr, secondsStr] = colonParts as [string, string];
    const minutes = Number.parseInt(minutesStr, 10);
    const seconds = Number.parseInt(secondsStr, 10);
    if ([minutes, seconds].some(value => !Number.isFinite(value))) {
      return undefined;
    }

    return minutes * 60 + seconds;
  }

  const simpleMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)$/i);
  if (simpleMatch) {
    const seconds = Number.parseFloat(simpleMatch[1]!);
    return Number.isFinite(seconds) ? seconds : undefined;
  }

  const verboseMatch =
    trimmed.match(
      /^(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/i
    );
  if (verboseMatch) {
    const hours = verboseMatch[1] ? Number.parseInt(verboseMatch[1], 10) : 0;
    const minutes = verboseMatch[2] ? Number.parseInt(verboseMatch[2], 10) : 0;
    const secondsPart = verboseMatch[3] ? Number.parseFloat(verboseMatch[3]) : 0;
    if ([hours, minutes, secondsPart].every(Number.isFinite)) {
      return hours * 3600 + minutes * 60 + secondsPart;
    }
  }

  return undefined;
}

function unwrapMatomoValue(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return undefined;
    return unwrapMatomoValue(raw[0]);
  }
  return raw;
}

function unwrapToRecord(raw: unknown): Record<string, unknown> {
  const unwrapped = unwrapMatomoValue(raw);
  if (unwrapped && typeof unwrapped === 'object') {
    return { ...(unwrapped as Record<string, unknown>) };
  }
  return {};
}

function normalizeKeyNumbersPayload(raw: unknown): Record<string, unknown> {
  const record = unwrapToRecord(raw);
  if (Object.keys(record).length > 0) {
    return record;
  }

  const nb_visits = toFiniteNumber(unwrapMatomoValue(raw)) ?? 0;
  return { nb_visits };
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

  const computedDuration = (() => {
    const totalDuration = typeof sanitized.sum_visit_length === 'number' ? sanitized.sum_visit_length : undefined;
    const visits = typeof sanitized.nb_visits === 'number' ? sanitized.nb_visits : undefined;

    if (totalDuration !== undefined && visits !== undefined && visits > 0) {
      return totalDuration / visits;
    }

    return parseDurationSeconds(raw['avg_time_on_site']);
  })();

  if (computedDuration !== undefined && Number.isFinite(computedDuration)) {
    sanitized.avg_time_on_site = {
      value: computedDuration,
      unit: 'seconds',
    } satisfies { value: number; unit: 'seconds' };
  } else {
    delete sanitized.avg_time_on_site;
  }

  return sanitized;
}

function toDiagnosticError(error: unknown): MatomoDiagnosticError {
  if (error instanceof MatomoApiError) {
    const diagnostic: MatomoDiagnosticError = {
      type: error instanceof MatomoNetworkError ? 'network' : 'matomo',
      message: error.message,
      guidance: error.guidance,
    };
    if (typeof error.code === 'string' || typeof error.code === 'number') {
      diagnostic.code = error.code;
    }
    return diagnostic;
  }

  if (error instanceof Error) {
    return {
      type: 'unknown',
      message: error.message || 'Unknown error',
    };
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

function isMatomoMethodUnavailable(error: unknown, method: string): error is MatomoClientError {
  if (!(error instanceof MatomoClientError)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  if (!normalized.includes(method.toLowerCase())) {
    return false;
  }

  return normalized.includes('method') && normalized.includes('does not exist');
}

type MatomoVersionMethod = 'API.getMatomoVersion' | 'API.getVersion';

function extractMatomoVersion(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const version = (payload as Record<string, unknown>).version;
    if (typeof version === 'string') {
      return version;
    }
  }

  return undefined;
}

async function fetchMatomoVersionWithFallback(
  http: MatomoHttpClient
): Promise<{ version?: string; method: MatomoVersionMethod }> {
  try {
    const payload = await matomoGet<unknown>(http, {
      method: 'API.getMatomoVersion',
    });
    const version = extractMatomoVersion(payload);
    const result: { version?: string; method: MatomoVersionMethod } = {
      method: 'API.getMatomoVersion',
    };
    if (version !== undefined) {
      result.version = version;
    }
    return result;
  } catch (error) {
    if (!isMatomoMethodUnavailable(error, 'getmatomoversion')) {
      throw error;
    }

    const payload = await matomoGet<unknown>(http, {
      method: 'API.getVersion',
    });

    const version = extractMatomoVersion(payload);
    const result: { version?: string; method: MatomoVersionMethod } = {
      method: 'API.getVersion',
    };
    if (version !== undefined) {
      result.version = version;
    }
    return result;
  }
}

type MatomoUserMethod = 'UsersManager.getUserByTokenAuth' | 'API.getLoggedInUser';

function toMatomoErrorDetails(error: MatomoApiError): MatomoErrorDetails {
  const details: MatomoErrorDetails = { cause: error };
  if (error.status !== undefined) {
    details.status = error.status;
  }
  if (error.code !== undefined) {
    details.code = error.code;
  }
  if (error.body !== undefined) {
    details.body = error.body;
  }
  if (error.endpoint !== undefined) {
    details.endpoint = error.endpoint;
  }
  if (error.payload !== undefined) {
    details.payload = error.payload;
  }
  if (error.rateLimit !== undefined) {
    details.rateLimit = error.rateLimit;
  }
  return details;
}

function createUsersManagerPermissionError(error: MatomoPermissionError): MatomoPermissionError {
  return new MatomoPermissionError(
    'Matomo token lacks permission to call UsersManager.getUserByTokenAuth. Enable the UsersManager plugin and grant the token user at least view access to the required sites.',
    toMatomoErrorDetails(error)
  );
}

function extractMatomoUserLogin(payload: unknown): string | undefined {
  if (!payload) return undefined;

  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry && typeof entry === 'object') {
        const login = (entry as Record<string, unknown>).login;
        if (typeof login === 'string') {
          return login;
        }
      }
    }
    return undefined;
  }

  if (typeof payload === 'object') {
    const login = (payload as Record<string, unknown>).login;
    if (typeof login === 'string') {
      return login;
    }
  }

  return undefined;
}

async function fetchMatomoUserWithFallback(
  http: MatomoHttpClient
): Promise<{ login?: string; method: MatomoUserMethod }> {
  try {
    const payload = await matomoGet<unknown>(http, {
      method: 'UsersManager.getUserByTokenAuth',
    });
    const login = extractMatomoUserLogin(payload);
    const result: { login?: string; method: MatomoUserMethod } = {
      method: 'UsersManager.getUserByTokenAuth',
    };
    if (login !== undefined) {
      result.login = login;
    }
    return result;
  } catch (error) {
    if (error instanceof MatomoPermissionError) {
      throw createUsersManagerPermissionError(error);
    }

    if (!isMatomoMethodUnavailable(error, 'getuserbytokenauth')) {
      throw error;
    }
  }

  try {
    const payload = await matomoGet<unknown>(http, {
      method: 'API.getLoggedInUser',
    });

    const login = extractMatomoUserLogin(payload);
    const result: { login?: string; method: MatomoUserMethod } = {
      method: 'API.getLoggedInUser',
    };
    if (login !== undefined) {
      result.login = login;
    }
    return result;
  } catch (error) {
    if (isMatomoMethodUnavailable(error, 'getloggedinuser')) {
      throw new MatomoClientError(
        'Matomo instance does not expose API.getLoggedInUser. Upgrade Matomo or enable the API plugin, or rely on UsersManager.getUserByTokenAuth with the appropriate permissions.',
        toMatomoErrorDetails(error)
      );
    }

    throw error;
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
  private readonly defaultSiteId: number | undefined;
  private readonly queueThresholds: TrackingQueueThresholds;
  private readonly cacheThresholds: CacheHealthThresholds;
  private readonly siteCurrencyCache = new Map<number, string | null>();

  constructor(config: MatomoClientConfig) {
    const httpOptions: MatomoHttpClientOptions = {
      ...(config.rateLimit ? { rateLimit: config.rateLimit } : {}),
      ...(config.http?.timeoutMs !== undefined ? { timeoutMs: config.http.timeoutMs } : {}),
      ...(config.http?.retry ? { retry: config.http.retry } : {}),
    };
    this.http = new MatomoHttpClient(config.baseUrl, config.tokenAuth, httpOptions);

    const reportsOptions: ReportsServiceOptions = {};
    const cacheTtl = config.cache?.ttlMs ?? config.cacheTtlMs;
    if (cacheTtl !== undefined) {
      reportsOptions.cacheTtlMs = cacheTtl;
    }
    if (config.cache?.onEvent) {
      reportsOptions.onCacheEvent = config.cache.onEvent;
    }
    this.reports = new ReportsService(this.http, reportsOptions);

    const trackingOptions = {
      baseUrl: config.tracking?.baseUrl ?? config.baseUrl,
      tokenAuth: config.tokenAuth,
      ...(config.tracking?.maxRetries !== undefined ? { maxRetries: config.tracking.maxRetries } : {}),
      ...(config.tracking?.retryDelayMs !== undefined ? { retryDelayMs: config.tracking.retryDelayMs } : {}),
      ...(config.tracking?.idempotencyStore
        ? { idempotencyStore: config.tracking.idempotencyStore }
        : {}),
      ...(config.tracking?.backoff ? { backoff: config.tracking.backoff } : {}),
    } satisfies TrackingOptions;

    this.tracking = new TrackingService(trackingOptions);
    this.defaultSiteId = config.defaultSiteId;

    const thresholds = config.tracking?.healthThresholds ?? {};
    const pendingWarn = Math.max(0, thresholds.pendingWarn ?? 10);
    let pendingFail = Math.max(0, thresholds.pendingFail ?? 25);
    if (pendingFail < pendingWarn) {
      pendingFail = pendingWarn;
    }

    const ageWarnMs = Math.max(0, thresholds.ageWarnMs ?? 60_000);
    let ageFailMs = Math.max(0, thresholds.ageFailMs ?? 120_000);
    if (ageFailMs < ageWarnMs) {
      ageFailMs = ageWarnMs;
    }

    this.queueThresholds = {
      pendingWarn,
      pendingFail,
      ageWarnMs,
      ageFailMs,
    };

    const cacheThresholds = config.cacheHealth ?? {};
    const warnHitRate = clampPercentage(cacheThresholds.warnHitRate ?? 20);
    let failHitRate = clampPercentage(cacheThresholds.failHitRate ?? 5);
    if (failHitRate > warnHitRate) {
      failHitRate = warnHitRate;
    }

    const sampleSize = Math.max(1, cacheThresholds.sampleSize ?? 20);

    this.cacheThresholds = {
      warnHitRate,
      failHitRate,
      sampleSize,
    };
  }

  private resolveSiteId(override?: number) {
    const value = override ?? this.defaultSiteId;
    assertSiteId(value);
    return value;
  }

  private async resolveSiteCurrency(siteId: number): Promise<string | undefined> {
    if (this.siteCurrencyCache.has(siteId)) {
      const cached = this.siteCurrencyCache.get(siteId);
      return cached ?? undefined;
    }

    try {
      const payload = await matomoGet<unknown>(this.http, {
        method: 'SitesManager.getSiteFromId',
        params: { idSite: siteId },
      });
      const currency = extractSiteCurrency(payload);
      this.siteCurrencyCache.set(siteId, currency ?? null);
      return currency ?? undefined;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        sdkLogger.debug('Failed to resolve Matomo site currency', {
          siteId,
          error,
        });
      }
      this.siteCurrencyCache.set(siteId, null);
      return undefined;
    }
  }

  async getKeyNumbers(input: GetKeyNumbersInput = {}): Promise<KeyNumbers> {
    const siteId = this.resolveSiteId(input.siteId);

    const raw = await matomoGet<unknown>(this.http, {
      method: 'VisitsSummary.get',
      params: {
        idSite: siteId,
        period: input.period ?? 'day',
        date: input.date ?? 'today',
        segment: input.segment,
      },
    });

    const source = normalizeKeyNumbersPayload(raw);

    let pageviewSummary: Partial<Pick<KeyNumbers, 'nb_pageviews' | 'nb_uniq_pageviews'>> = {};

    try {
      const actionsRaw = await matomoGet<unknown>(this.http, {
        method: 'Actions.get',
        params: {
          idSite: siteId,
          period: input.period ?? 'day',
          date: input.date ?? 'today',
          segment: input.segment,
        },
      });

      const actionsSummary = unwrapToRecord(actionsRaw);

      const nb_pageviews = toFiniteNumber(actionsSummary?.['nb_pageviews']);
      const nb_uniq_pageviews = toFiniteNumber(actionsSummary?.['nb_uniq_pageviews']);

      pageviewSummary = {
        nb_pageviews: nb_pageviews ?? undefined,
        nb_uniq_pageviews: nb_uniq_pageviews ?? undefined,
      };
    } catch (error) {
      // swallow errors; nb_actions will still be returned
      if (process.env.NODE_ENV !== 'production') {
        sdkLogger.warn('Failed to fetch pageview summary from Actions.get', {
          error,
          siteId,
          period: input.period ?? 'day',
          date: input.date ?? 'today',
        });
      }
    }

    const payload = sanitizeKeyNumbers({ ...source, ...pageviewSummary });
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

    const response = await matomoGet<Record<string, unknown>>(this.http, {
      method: 'VisitsSummary.get',
      params: {
        idSite: siteId,
        period,
        date,
        segment: input.segment,
      },
    });

    const normalizedResponse = Object.fromEntries(
      Object.entries(response ?? {}).map(([label, value]) => {
        const record = unwrapToRecord(value);

        if (Object.keys(record).length > 0) {
          return [label, record];
        }

        const visits = toFiniteNumber(unwrapMatomoValue(value)) ?? 0;
        return [label, { nb_visits: visits } as Record<string, unknown>];
      })
    );

    const parsed = keyNumbersSeriesSchema.parse(normalizedResponse);

    return Object.entries(parsed)
      .map(([label, value]) => ({ date: label, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getMostPopularUrls(
    input: Omit<Parameters<ReportsService['getMostPopularUrls']>[0], 'siteId'> & { siteId?: number }
  ): Promise<MostPopularUrl[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getMostPopularUrls']>[0] = {
      siteId,
      period: input.period,
      date: input.date,
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    return this.reports.getMostPopularUrls(request);
  }

  async getTopReferrers(
    input: Omit<Parameters<ReportsService['getTopReferrers']>[0], 'siteId'> & { siteId?: number }
  ): Promise<TopReferrer[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getTopReferrers']>[0] = {
      siteId,
      period: input.period,
      date: input.date,
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    return this.reports.getTopReferrers(request);
  }

  async getEvents(input: GetEventsInput = {}): Promise<EventSummary[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getEvents']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    if (input.category !== undefined) {
      request.category = input.category;
    }
    if (input.action !== undefined) {
      request.action = input.action;
    }
    if (input.name !== undefined) {
      request.name = input.name;
    }
    return this.reports.getEvents(request);
  }

  async getEntryPages(input: GetEntryPagesInput = {}): Promise<EntryPage[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getEntryPages']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    return this.reports.getEntryPages(request);
  }

  async getCampaigns(input: GetCampaignsInput = {}): Promise<Campaign[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getCampaigns']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    const [campaigns, currency] = await Promise.all([
      this.reports.getCampaigns(request),
      this.resolveSiteCurrency(siteId),
    ]);

    return campaigns.map(campaign => enrichRecordWithCurrency(campaign, currency) as unknown as Campaign);
  }

  async getEcommerceOverview(input: GetEcommerceOverviewInput = {}): Promise<EcommerceSummary> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getEcommerceOverview']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    const [summary, currency] = await Promise.all([
      this.reports.getEcommerceOverview(request),
      this.resolveSiteCurrency(siteId),
    ]);

    return adaptEcommerceSummary(summary, currency);
  }

  async getEcommerceRevenueTotals(
    input: GetEcommerceRevenueTotalsInput = {}
  ): Promise<EcommerceRevenueTotals> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getEcommerceRevenueTotals']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.includeSeries !== undefined) {
      request.includeSeries = input.includeSeries;
    }
    const [totals, currency] = await Promise.all([
      this.reports.getEcommerceRevenueTotals(request),
      this.resolveSiteCurrency(siteId),
    ]);

    const adaptedTotals = adaptEcommerceSummary(totals.totals, currency);
    const adaptedSeries = totals.series?.map(point => adaptEcommerceRevenueSeriesPoint(point, currency));

    return adaptedSeries ? { totals: adaptedTotals, series: adaptedSeries } : { totals: adaptedTotals };
  }

  async getEventCategories(input: GetEventCategoriesInput = {}): Promise<EventCategory[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getEventCategories']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    return this.reports.getEventCategories(request);
  }

  async getDeviceTypes(input: GetDeviceTypesInput = {}): Promise<DeviceTypeSummary[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getDeviceTypes']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    return this.reports.getDeviceTypes(request);
  }

  async getTrafficChannels(input: GetTrafficChannelsInput = {}): Promise<TrafficChannel[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getTrafficChannels']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    if (input.channelType !== undefined) {
      request.channelType = input.channelType;
    }
    const [channels, currency] = await Promise.all([
      this.reports.getTrafficChannels(request),
      this.resolveSiteCurrency(siteId),
    ]);

    return channels.map(channel => enrichRecordWithCurrency(channel, currency) as unknown as TrafficChannel);
  }

  async getGoalConversions(input: GetGoalConversionsInput = {}): Promise<GoalConversion[]> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getGoalConversions']>[0] = {
      siteId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    if (input.limit !== undefined) {
      request.limit = input.limit;
    }
    if (input.goalId !== undefined) {
      request.goalId = input.goalId;
    }
    if (input.goalType !== undefined) {
      request.goalType = input.goalType;
    }
    const [goals, currency] = await Promise.all([
      this.reports.getGoalConversions(request),
      this.resolveSiteCurrency(siteId),
    ]);

    return goals.map(goal => enrichRecordWithCurrency(goal as unknown as UnknownRecord, currency) as unknown as GoalConversion);
  }

  async getFunnelSummary(input: GetFunnelSummaryInput): Promise<FunnelSummary> {
    const siteId = this.resolveSiteId(input.siteId);
    const request: Parameters<ReportsService['getFunnelSummary']>[0] = {
      siteId,
      funnelId: input.funnelId,
      period: input.period ?? 'day',
      date: input.date ?? 'today',
    };
    if (input.segment !== undefined) {
      request.segment = input.segment;
    }
    return this.reports.getFunnelSummary(request);
  }

  getCacheStats(): CacheStatsSnapshot {
    return this.reports.getCacheStats();
  }

  getLastRateLimitEvent(): MatomoRateLimitEvent | undefined {
    return this.http.getLastRateLimitEvent();
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

  async getTrackingRequestMetadata(key: string): Promise<TrackingIdempotencyRecord | undefined> {
    return this.tracking.getIdempotencyRecord(key);
  }

  getTrackingQueueStats(): TrackingQueueStats {
    return this.tracking.getQueueStats();
  }

  async runDiagnostics(input: RunDiagnosticsInput = {}): Promise<RunDiagnosticsResult> {
    const checks: MatomoDiagnosticCheck[] = [];

    const baseCheck = await performDiagnosticCheck('base-url', 'Matomo base URL reachability', async () => {
      const { version } = await fetchMatomoVersionWithFallback(this.http);
      if (version) {
        return { version };
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
      const { login } = await fetchMatomoUserWithFallback(this.http);
      if (login) {
        return { login };
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

  async getHealthStatus(input: GetHealthStatusInput = {}): Promise<HealthCheckStatus> {
    const timestamp = new Date().toISOString();
    const checks: HealthCheck[] = [];

    // Matomo API connectivity check
    let matomoStatus: 'pass' | 'fail' = 'pass';
    let matomoOutput = '';
    let responseTime = 0;

    try {
      const startTime = Date.now();
      await fetchMatomoVersionWithFallback(this.http);
      responseTime = Date.now() - startTime;
      matomoOutput = `API responded in ${responseTime}ms`;
    } catch (error) {
      matomoStatus = 'fail';
      matomoOutput = error instanceof Error ? error.message : String(error);
    }

    checks.push({
      name: 'matomo-api',
      status: matomoStatus,
      componentType: 'service',
      observedValue: responseTime,
      observedUnit: 'ms',
      time: timestamp,
      output: matomoOutput,
    });

    // Cache health check
    const cacheStats = this.getCacheStats();
    const totalRequests = cacheStats.total.hits + cacheStats.total.misses;
    const hitRate = totalRequests > 0 ? (cacheStats.total.hits / totalRequests) * 100 : 0;

    let cacheStatus: 'pass' | 'warn' | 'fail' = 'pass';
    if (totalRequests >= this.cacheThresholds.sampleSize) {
      if (hitRate < this.cacheThresholds.failHitRate) {
        cacheStatus = 'fail';
      } else if (hitRate < this.cacheThresholds.warnHitRate) {
        cacheStatus = 'warn';
      }
    }

    const cacheDetails: Record<string, unknown> = {
      hitRate: Math.round(hitRate * 100) / 100,
      hits: cacheStats.total.hits,
      misses: cacheStats.total.misses,
      sets: cacheStats.total.sets,
      staleEvictions: cacheStats.total.staleEvictions,
      entries: cacheStats.total.entries,
      sampleSize: this.cacheThresholds.sampleSize,
      warnHitRate: this.cacheThresholds.warnHitRate,
      failHitRate: this.cacheThresholds.failHitRate,
    };

    checks.push({
      name: 'reports-cache',
      status: cacheStatus,
      componentType: 'cache',
      observedValue: Math.round(hitRate * 100) / 100,
      observedUnit: '%',
      time: timestamp,
      output: `Hit rate: ${hitRate.toFixed(1)}% (${cacheStats.total.hits}/${totalRequests} requests)`,
      details: cacheDetails,
    });

    // Tracking queue health check
    const queueStats = this.tracking.getQueueStats();
    const queueNow = Date.now();
    const backlogCount = queueStats.pending + queueStats.inflight;
    const oldestTimestamp = queueStats.oldestPendingAt ?? queueStats.lastRetryAt;
    const backlogAgeMs = oldestTimestamp ? Math.max(0, queueNow - oldestTimestamp) : 0;
    const cooldownMs =
      queueStats.cooldownUntil && queueStats.cooldownUntil > queueNow
        ? queueStats.cooldownUntil - queueNow
        : 0;

    let queueStatus: 'pass' | 'warn' | 'fail' = 'pass';
    if (
      backlogCount >= this.queueThresholds.pendingFail ||
      backlogAgeMs >= this.queueThresholds.ageFailMs
    ) {
      queueStatus = 'fail';
    } else if (
      backlogCount >= this.queueThresholds.pendingWarn ||
      backlogAgeMs >= this.queueThresholds.ageWarnMs ||
      cooldownMs > 0
    ) {
      queueStatus = 'warn';
    }

    const queueDetails: Record<string, unknown> = {
      pending: queueStats.pending,
      inflight: queueStats.inflight,
      totalProcessed: queueStats.totalProcessed,
      totalRetried: queueStats.totalRetried,
      lastError: queueStats.lastError,
      lastRetryAt: queueStats.lastRetryAt,
      lastBackoffMs: queueStats.lastBackoffMs,
      cooldownUntil: queueStats.cooldownUntil,
      lastRetryStatus: queueStats.lastRetryStatus,
      oldestPendingAt: queueStats.oldestPendingAt,
      backlogAgeMs: Math.round(backlogAgeMs),
    };

    const queueOutputParts = [
      `pending=${queueStats.pending}`,
      `inflight=${queueStats.inflight}`,
      `backlogAgeMs=${Math.round(backlogAgeMs)}`,
    ];

    if (typeof queueStats.lastBackoffMs === 'number') {
      queueOutputParts.push(`lastBackoffMs=${queueStats.lastBackoffMs}`);
    }

    if (typeof queueStats.lastRetryStatus === 'number') {
      queueOutputParts.push(`lastRetryStatus=${queueStats.lastRetryStatus}`);
    }

    if (cooldownMs > 0) {
      queueOutputParts.push(`cooldownMs=${Math.round(cooldownMs)}`);
    }

    checks.push({
      name: 'tracking-queue',
      status: queueStatus,
      componentType: 'queue',
      observedValue: backlogCount,
      observedUnit: 'pending',
      time: timestamp,
      output: queueOutputParts.join(', '),
      details: queueDetails,
    });

    // Site access check (if siteId provided and details requested)
    if (input.includeDetails && (input.siteId || this.defaultSiteId)) {
      let siteStatus: 'pass' | 'fail' = 'pass';
      let siteOutput = '';

      try {
        const siteId = this.resolveSiteId(input.siteId);
        await matomoGet<unknown>(this.http, {
          method: 'SitesManager.getSiteFromId',
          params: { idSite: siteId },
        });
        siteOutput = `Site ID ${siteId} accessible`;
      } catch (error) {
        siteStatus = 'fail';
        siteOutput = error instanceof Error ? error.message : String(error);
      }

      checks.push({
        name: 'site-access',
        status: siteStatus,
        componentType: 'service',
        time: timestamp,
        output: siteOutput,
      });
    }

    // Determine overall status
    const hasFailures = checks.some(check => check.status === 'fail');
    const hasWarnings = checks.some(check => check.status === 'warn');
    
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
    if (hasFailures) {
      overallStatus = 'unhealthy';
    } else if (hasWarnings) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    return {
      status: overallStatus,
      timestamp,
      checks,
    };
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
  DeviceTypeSummary,
  TopReferrer,
  EventCategory,
  TrackEventInput,
  TrackGoalInput,
  TrackPageviewInput,
  TrackPageviewResult,
  TrackResult,
  TrackingIdempotencyRecord,
  TrackingIdempotencyStore,
  TrackingQueueStats,
  TrackingBackoffOptions,
  CacheStatsSnapshot,
  CacheEvent,
  EcommerceRevenueTotalsInput,
  FunnelSummary,
  FunnelStepSummary,
  MatomoRateLimitEvent,
};

export type { MatomoRateLimitOptions } from './httpClient.js';

export { TrackingService } from './tracking.js';
export {
  MatomoApiError,
  MatomoAuthError,
  MatomoPermissionError,
  MatomoRateLimitError,
  MatomoClientError,
  MatomoServerError,
  MatomoNetworkError,
  MatomoParseError,
} from './errors.js';

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
