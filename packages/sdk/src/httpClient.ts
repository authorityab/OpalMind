import { URL } from 'node:url';

import {
  MatomoNetworkError,
  MatomoParseError,
  MatomoRateLimitError,
  classifyMatomoError,
  classifyMatomoResultError,
  extractMatomoError,
  type MatomoRateLimitInfo,
} from './errors.js';

export interface MatomoRequestOptions {
  method: string;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface MatomoResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

export interface MatomoRateLimitEvent extends MatomoRateLimitInfo {
  source: 'response-headers' | 'http-status' | 'payload';
  status?: number;
  message?: string;
}

export interface MatomoRateLimitOptions {
  minThrottleMs?: number;
  onLimit?: (event: MatomoRateLimitEvent) => void;
}

export interface MatomoHttpClientOptions {
  rateLimit?: MatomoRateLimitOptions;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseNumericHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0) return undefined;
  return parsed;
}

function parseResetHeader(value: string | null): number | undefined {
  const numeric = parseNumericHeader(value);
  if (numeric !== undefined) {
    if (numeric > 1_000_000_000_000) {
      return Math.floor(numeric);
    }

    if (numeric >= 1_000_000_000) {
      return Math.floor(numeric * 1000);
    }

    return Date.now() + Math.floor(numeric * 1000);
  }

  if (!value) return undefined;
  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return undefined;
  return parsedDate;
}

function parseRetryAfter(value: string | null): number | undefined {
  const numeric = parseNumericHeader(value);
  if (numeric !== undefined) {
    return Math.floor(numeric * 1000);
  }

  if (!value) return undefined;
  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return undefined;
  const diff = parsedDate - Date.now();
  return diff > 0 ? diff : 0;
}

function extractRateLimitFromHeaders(headers: Headers): MatomoRateLimitInfo | undefined {
  const limit =
    parseNumericHeader(headers.get('x-matomo-rate-limit-limit')) ??
    parseNumericHeader(headers.get('x-ratelimit-limit')) ??
    parseNumericHeader(headers.get('ratelimit-limit'));

  const remaining =
    parseNumericHeader(headers.get('x-matomo-rate-limit-remaining')) ??
    parseNumericHeader(headers.get('x-ratelimit-remaining')) ??
    parseNumericHeader(headers.get('ratelimit-remaining'));

  const resetAt =
    parseResetHeader(headers.get('x-matomo-rate-limit-reset')) ??
    parseResetHeader(headers.get('x-ratelimit-reset')) ??
    parseResetHeader(headers.get('ratelimit-reset'));

  const retryAfterMs = parseRetryAfter(headers.get('retry-after'));

  if (
    limit === undefined &&
    remaining === undefined &&
    resetAt === undefined &&
    retryAfterMs === undefined
  ) {
    return undefined;
  }

  const info: MatomoRateLimitInfo = {};
  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;
  if (resetAt !== undefined) info.resetAt = resetAt;
  if (retryAfterMs !== undefined) info.retryAfterMs = retryAfterMs;
  return info;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('Matomo base URL is required');
  }

  const trimmed = baseUrl.trim();
  if (trimmed.endsWith('index.php')) {
    return trimmed;
  }

  return `${trimmed.replace(/\/?$/, '')}/index.php`;
}

export class MatomoHttpClient {
  private readonly baseEndpoint: string;
  private readonly token: string;
  private readonly rateLimitMinDelayMs: number;
  private readonly onRateLimit?: (event: MatomoRateLimitEvent) => void;
  private rateLimitCooldownUntil = 0;
  private lastRateLimitEvent?: MatomoRateLimitEvent;

  constructor(baseUrl: string, tokenAuth: string, options: MatomoHttpClientOptions = {}) {
    this.baseEndpoint = normalizeBaseUrl(baseUrl);
    if (!tokenAuth) {
      throw new Error('Matomo token_auth is required');
    }

    this.token = tokenAuth;
    this.rateLimitMinDelayMs = options.rateLimit?.minThrottleMs ?? 1000;
    this.onRateLimit = options.rateLimit?.onLimit;
  }

  async get<T>({ method, params = {} }: MatomoRequestOptions): Promise<MatomoResponse<T>> {
    if (!method) {
      throw new Error('Matomo API method is required');
    }

    await this.enforceRateLimit();

    const url = new URL(this.baseEndpoint);
    url.searchParams.set('module', 'API');
    url.searchParams.set('method', method);
    url.searchParams.set('token_auth', this.token);
    url.searchParams.set('format', 'JSON');

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const endpoint = url.toString();
    let res: Awaited<ReturnType<typeof fetch>>;

    try {
      res = await fetch(endpoint);
    } catch (error) {
      throw new MatomoNetworkError('Failed to reach Matomo instance.', {
        endpoint,
        cause: error,
      });
    }

    const rateLimitFromHeaders = res.headers ? extractRateLimitFromHeaders(res.headers) : undefined;

    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch (error) {
      throw new MatomoNetworkError('Failed to read Matomo response.', {
        endpoint,
        cause: error,
        status: res.status,
      });
    }

    let payload: unknown = undefined;
    const trimmedBody = bodyText?.trim() ?? '';

    if (trimmedBody.length > 0) {
      try {
        payload = JSON.parse(trimmedBody);
      } catch (error) {
        if (res.ok) {
          throw new MatomoParseError('Failed to parse Matomo JSON response.', {
            endpoint,
            status: res.status,
            body: bodyText,
            cause: error,
          });
        }
      }
    }

    if (!res.ok) {
      if (res.status === 429 || rateLimitFromHeaders) {
        this.applyRateLimit(rateLimitFromHeaders, 'http-status', {
          status: res.status,
          message: bodyText,
        });
      }

      throw classifyMatomoError({
        status: res.status,
        statusText: res.statusText,
        endpoint,
        bodyText,
        payload,
        rateLimit: rateLimitFromHeaders,
      });
    }

    if (payload && typeof payload === 'object') {
      const extracted = extractMatomoError(payload);
      if (extracted) {
        const error = classifyMatomoResultError(endpoint, payload, rateLimitFromHeaders);
        if (error instanceof MatomoRateLimitError) {
          this.applyRateLimit(rateLimitFromHeaders, 'payload', {
            message: extracted.message,
          });
        }
        throw error;
      }
    }

    if (rateLimitFromHeaders && rateLimitFromHeaders.remaining !== undefined) {
      if (rateLimitFromHeaders.remaining <= 0) {
        this.applyRateLimit(rateLimitFromHeaders, 'response-headers');
      } else {
        this.lastRateLimitEvent = {
          ...rateLimitFromHeaders,
          source: 'response-headers',
        };
      }
    }

    return {
      data: payload as T,
      status: res.status,
      ok: res.ok,
    };
  }

  getLastRateLimitEvent(): MatomoRateLimitEvent | undefined {
    return this.lastRateLimitEvent ? { ...this.lastRateLimitEvent } : undefined;
  }

  private async enforceRateLimit(): Promise<void> {
    while (this.rateLimitCooldownUntil > Date.now()) {
      const waitMs = this.rateLimitCooldownUntil - Date.now();
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }
  }

  private applyRateLimit(
    info: MatomoRateLimitInfo | undefined,
    source: MatomoRateLimitEvent['source'],
    meta: { status?: number; message?: string } = {}
  ): void {
    const event: MatomoRateLimitEvent = {
      ...info,
      source,
      status: meta.status,
      message: meta.message,
    };

    const shouldThrottle = this.shouldThrottle(event);

    if (shouldThrottle) {
      const waitMs = this.calculateThrottleDelay(event);
      if (waitMs > 0) {
        const resumeAt = Date.now() + waitMs;
        this.rateLimitCooldownUntil = Math.max(this.rateLimitCooldownUntil, resumeAt);
      }
      this.lastRateLimitEvent = event;
      if (this.onRateLimit) {
        this.onRateLimit(event);
      }
      return;
    }

    this.lastRateLimitEvent = event;
  }

  private shouldThrottle(event: MatomoRateLimitEvent): boolean {
    if (event.retryAfterMs !== undefined && event.retryAfterMs > 0) {
      return true;
    }

    if (event.resetAt !== undefined && event.resetAt > Date.now()) {
      return true;
    }

    if (event.remaining !== undefined) {
      return event.remaining <= 0;
    }

    return event.source !== 'response-headers';
  }

  private calculateThrottleDelay(event: MatomoRateLimitEvent): number {
    const now = Date.now();
    const candidates: number[] = [];

    if (event.retryAfterMs !== undefined) {
      candidates.push(event.retryAfterMs);
    }

    if (event.resetAt !== undefined) {
      candidates.push(Math.max(0, event.resetAt - now));
    }

    if (candidates.length === 0) {
      candidates.push(this.rateLimitMinDelayMs);
    } else if (this.rateLimitMinDelayMs > 0) {
      candidates.push(this.rateLimitMinDelayMs);
    }

    return Math.max(0, ...candidates);
  }
}

export async function matomoGet<T>(client: MatomoHttpClient, options: MatomoRequestOptions) {
  const response = await client.get<T>(options);
  return response.data;
}
