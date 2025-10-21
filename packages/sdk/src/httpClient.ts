import { URL } from 'node:url';

import {
  MatomoNetworkError,
  MatomoParseError,
  MatomoRateLimitError,
  classifyMatomoError,
  classifyMatomoResultError,
  extractMatomoError,
  type MatomoRateLimitInfo,
  type MatomoHttpErrorContext,
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

export interface MatomoRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export interface MatomoHttpClientOptions {
  rateLimit?: MatomoRateLimitOptions;
  timeoutMs?: number;
  retry?: MatomoRetryOptions;
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

function redactMatomoToken(input: string): string {
  if (!input) return input;

  try {
    const parsed = new URL(input);
    if (parsed.searchParams.has('token_auth')) {
      parsed.searchParams.set('token_auth', 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return input.replace(/token_auth=[^&#?]*/gi, 'token_auth=REDACTED');
  }
}

export class MatomoHttpClient {
  private readonly baseEndpoint: string;
  private readonly token: string;
  private readonly rateLimitMinDelayMs: number;
  private readonly onRateLimit: ((event: MatomoRateLimitEvent) => void) | undefined;
  private readonly timeoutMs: number;
  private readonly retryMaxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryJitterMs: number;
  private rateLimitCooldownUntil = 0;
  private lastRateLimitEvent: MatomoRateLimitEvent | undefined;

  constructor(baseUrl: string, tokenAuth: string, options: MatomoHttpClientOptions = {}) {
    this.baseEndpoint = normalizeBaseUrl(baseUrl);
    if (!tokenAuth) {
      throw new Error('Matomo token_auth is required');
    }

    this.token = tokenAuth;
    this.rateLimitMinDelayMs = options.rateLimit?.minThrottleMs ?? 1000;
    this.onRateLimit = options.rateLimit?.onLimit;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 10_000;
    const retryOptions = options.retry ?? {};
    this.retryMaxAttempts = retryOptions.maxAttempts && retryOptions.maxAttempts > 0 ? retryOptions.maxAttempts : 3;
    this.retryBaseDelayMs = retryOptions.baseDelayMs !== undefined && retryOptions.baseDelayMs >= 0 ? retryOptions.baseDelayMs : 250;
    this.retryMaxDelayMs = retryOptions.maxDelayMs && retryOptions.maxDelayMs > 0 ? retryOptions.maxDelayMs : 2_000;
    this.retryJitterMs = retryOptions.jitterMs !== undefined && retryOptions.jitterMs >= 0 ? retryOptions.jitterMs : 250;
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
    const redactedEndpoint = redactMatomoToken(endpoint);
    const res = await this.fetchWithRetry(endpoint, redactedEndpoint);

    const rateLimitFromHeaders = res.headers ? extractRateLimitFromHeaders(res.headers) : undefined;

    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch (error) {
      throw new MatomoNetworkError('Failed to read Matomo response.', {
        endpoint: redactedEndpoint,
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
            endpoint: redactedEndpoint,
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

      const errorContext: MatomoHttpErrorContext = {
        status: res.status,
        statusText: res.statusText,
        endpoint: redactedEndpoint,
      };
      if (bodyText !== undefined) {
        errorContext.bodyText = bodyText;
      }
      if (payload !== undefined) {
        errorContext.payload = payload;
      }
      if (rateLimitFromHeaders !== undefined) {
        errorContext.rateLimit = rateLimitFromHeaders;
      }

      throw classifyMatomoError(errorContext);
    }

    if (payload && typeof payload === 'object') {
      const extracted = extractMatomoError(payload);
      if (extracted) {
        const error = classifyMatomoResultError(redactedEndpoint, payload, rateLimitFromHeaders);
        if (error instanceof MatomoRateLimitError) {
          const payloadMeta: { status?: number; message?: string } = {};
          if (extracted.message !== undefined) {
            payloadMeta.message = extracted.message;
          }
          this.applyRateLimit(rateLimitFromHeaders, 'payload', payloadMeta);
        }
        throw error;
      }
    }

    if (rateLimitFromHeaders && rateLimitFromHeaders.remaining !== undefined) {
      if (rateLimitFromHeaders.remaining <= 0) {
        this.applyRateLimit(rateLimitFromHeaders, 'response-headers');
      } else {
        const lastEvent: MatomoRateLimitEvent = { source: 'response-headers' };
        if (rateLimitFromHeaders.limit !== undefined) {
          lastEvent.limit = rateLimitFromHeaders.limit;
        }
        if (rateLimitFromHeaders.remaining !== undefined) {
          lastEvent.remaining = rateLimitFromHeaders.remaining;
        }
        if (rateLimitFromHeaders.resetAt !== undefined) {
          lastEvent.resetAt = rateLimitFromHeaders.resetAt;
        }
        if (rateLimitFromHeaders.retryAfterMs !== undefined) {
          lastEvent.retryAfterMs = rateLimitFromHeaders.retryAfterMs;
        }
        this.lastRateLimitEvent = lastEvent;
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
    const event: MatomoRateLimitEvent = { source };
    if (info?.limit !== undefined) {
      event.limit = info.limit;
    }
    if (info?.remaining !== undefined) {
      event.remaining = info.remaining;
    }
    if (info?.resetAt !== undefined) {
      event.resetAt = info.resetAt;
    }
    if (info?.retryAfterMs !== undefined) {
      event.retryAfterMs = info.retryAfterMs;
    }
    if (meta.status !== undefined) {
      event.status = meta.status;
    }
    if (meta.message !== undefined) {
      event.message = meta.message;
    }

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

  private async fetchWithRetry(endpoint: string, redactedEndpoint: string): Promise<Response> {
    let attempt = 0;
    let delayMs = this.retryBaseDelayMs;
    let lastError: MatomoNetworkError | undefined;

    while (attempt < this.retryMaxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok && this.shouldRetryResponse(response) && attempt < this.retryMaxAttempts) {
          lastError = new MatomoNetworkError(
            `Matomo responded with status ${response.status}. Retrying request.`,
            {
              endpoint: redactedEndpoint,
              status: response.status,
            }
          );
          await this.delayWithJitter(delayMs);
          delayMs = this.nextDelay(delayMs);
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeout);

        const aborted = this.isAbortError(error);
        const message = aborted
          ? `Matomo request timed out after ${this.timeoutMs}ms.`
          : 'Failed to reach Matomo instance.';

        const networkError = new MatomoNetworkError(message, {
          endpoint: redactedEndpoint,
          cause: error,
        });

        if (attempt >= this.retryMaxAttempts) {
          throw networkError;
        }

        lastError = networkError;
        await this.delayWithJitter(delayMs);
        delayMs = this.nextDelay(delayMs);
      }
    }

    throw lastError ?? new MatomoNetworkError('Failed to reach Matomo instance.', { endpoint: redactedEndpoint });
  }

  private async delayWithJitter(delayMs: number): Promise<void> {
    if (delayMs <= 0 && this.retryJitterMs <= 0) {
      return;
    }

    const jitter = this.retryJitterMs > 0 ? Math.random() * this.retryJitterMs : 0;
    await sleep(delayMs + jitter);
  }

  private nextDelay(previousDelay: number): number {
    const doubled = previousDelay > 0 ? previousDelay * 2 : this.retryBaseDelayMs || 0;
    const candidate = Math.max(this.retryBaseDelayMs, doubled);
    return Math.min(this.retryMaxDelayMs, candidate);
  }

  private shouldRetryResponse(response: Response): boolean {
    if (response.status === 429) {
      return false;
    }

    if (response.status === 408) {
      return true;
    }

    return response.status >= 500 && response.status < 600;
  }

  private isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof Error && error.name === 'AbortError') {
      return true;
    }

    if (typeof error === 'object' && 'name' in error) {
      const name = (error as { name?: unknown }).name;
      return typeof name === 'string' && name === 'AbortError';
    }

    return false;
  }
}

export async function matomoGet<T>(client: MatomoHttpClient, options: MatomoRequestOptions) {
  const response = await client.get<T>(options);
  return response.data;
}
