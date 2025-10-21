import { URLSearchParams } from 'node:url';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTrackingUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('Matomo base URL is required for tracking');
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('Matomo base URL is required for tracking');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Matomo tracking URL must be an absolute http(s) URL');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Matomo tracking URL must use http or https');
  }

  const pathname = parsed.pathname;
  if (pathname.endsWith('matomo.php') || pathname.endsWith('piwik.php')) {
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  if (pathname.endsWith('index.php')) {
    parsed.pathname = pathname.replace(/index\.php$/, 'matomo.php');
  } else {
    const basePath = pathname.endsWith('/') ? pathname : `${pathname}/`;
    parsed.pathname = `${basePath}matomo.php`;
  }

  parsed.search = '';
  parsed.hash = '';

  return parsed.toString();
}

function generatePvId(): string {
  let id = '';
  while (id.length < 16) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

function generateIdempotencyKey(): string {
  return `${generatePvId()}${generatePvId()}`;
}

interface QueueOptions {
  maxRetries: number;
  retryDelayMs: number;
  idempotencyStore?: IdempotencyStore;
  computeDelayMs?: (context: { attempt: number; error: unknown }) => number;
  onRetry?: (event: { attempt: number; delayMs: number; error: unknown }) => void;
  onFailure?: (event: { attempts: number; error: unknown }) => void;
  onSuccess?: (event: { attempts: number }) => void;
}

interface QueueStats {
  pending: number;
  inflight: number;
  totalProcessed: number;
  totalRetried: number;
  lastError?: {
    message?: string;
    status?: number;
    timestamp: number;
  };
  lastRetryAt?: number;
  lastDelayMs?: number;
  cooldownUntil?: number;
  oldestPendingAt?: number;
}

class MatomoTrackingError extends Error {
  status: number | undefined;
  retryAfterMs: number | undefined;

  constructor(
    message: string,
    details: { status?: number; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'MatomoTrackingError';
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    if (details.cause instanceof Error || (details.cause && typeof details.cause === 'object')) {
      type ErrorWithCause = Error & { cause?: unknown };
      const self = this as ErrorWithCause;
      if (self.cause === undefined) {
        self.cause = details.cause;
      }
    }
  }
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) return 0;
    return Math.round(numeric * 1000);
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return undefined;
  const diff = parsedDate - Date.now();
  return diff > 0 ? diff : 0;
}

function parseRateLimitResetHeader(value: string | null): number | undefined {
  if (!value) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) {
      const diff = numeric - Date.now();
      return diff > 0 ? diff : 0;
    }

    if (numeric >= 1_000_000_000) {
      const diff = numeric * 1000 - Date.now();
      return diff > 0 ? diff : 0;
    }

    return numeric > 0 ? Math.round(numeric * 1000) : 0;
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return undefined;
  const diff = parsedDate - Date.now();
  return diff > 0 ? diff : 0;
}

function extractBackoffInfo(error: unknown): { status?: number; retryAfterMs?: number } {
  if (!error || typeof error !== 'object') {
    return {};
  }

  const status = typeof (error as { status?: unknown }).status === 'number' ? ((error as { status?: number }).status as number) : undefined;
  const retryAfter =
    typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
      ? ((error as { retryAfterMs?: number }).retryAfterMs as number)
      : undefined;

  const result: { status?: number; retryAfterMs?: number } = {};
  if (status !== undefined) {
    result.status = status;
  }
  if (retryAfter !== undefined) {
    result.retryAfterMs = retryAfter;
  }

  return result;
}

interface IdempotencyRecord<T = unknown> {
  key: string;
  value: T;
  attempts: number;
  completedAt: number;
}

type MaybePromise<T> = T | Promise<T>;

interface IdempotencyStore<T = unknown> {
  get(key: string): MaybePromise<IdempotencyRecord<T> | undefined>;
  set(record: IdempotencyRecord<T>): MaybePromise<void>;
}

class InMemoryIdempotencyStore<T = unknown> implements IdempotencyStore<T> {
  private readonly records = new Map<string, IdempotencyRecord<T>>();

  async get(key: string): Promise<IdempotencyRecord<T> | undefined> {
    return this.records.get(key);
  }

  async set(record: IdempotencyRecord<T>): Promise<void> {
    this.records.set(record.key, record);
  }
}

interface QueueTask {
  attempt: number;
  execute: (attempt: number) => Promise<unknown>;
  resolve: (value: unknown, attempts: number) => MaybePromise<void>;
  reject: (reason: unknown, attempts: number) => MaybePromise<void>;
  enqueuedAt: number;
  key?: string;
}

class RetryQueue {
  private readonly queue: QueueTask[] = [];
  private processing = false;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly idempotencyStore: IdempotencyStore;
  private readonly stats: QueueStats = {
    pending: 0,
    inflight: 0,
    totalProcessed: 0,
    totalRetried: 0,
  };

  constructor(private readonly options: QueueOptions) {
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  async enqueue<T>(
    run: (attempt: number) => Promise<T>,
    options: { idempotencyKey?: string } = {}
  ): Promise<T> {
    const { idempotencyKey } = options;

    if (idempotencyKey) {
      const completed = await this.idempotencyStore.get(idempotencyKey);
      if (completed) {
        return completed.value as T;
      }

      const inflight = this.inflight.get(idempotencyKey);
      if (inflight) {
        return inflight as Promise<T>;
      }
    }

    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (reason: unknown) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const task: QueueTask = {
      attempt: 0,
      execute: run as (attempt: number) => Promise<unknown>,
      enqueuedAt: Date.now(),
      resolve: async (value, attempts) => {
        if (idempotencyKey) {
          this.inflight.delete(idempotencyKey);
          await this.idempotencyStore.set({
            key: idempotencyKey,
            value,
            attempts,
            completedAt: Date.now(),
          });
        }

        resolvePromise(value as T);
      },
      reject: async reason => {
        if (idempotencyKey) {
          this.inflight.delete(idempotencyKey);
        }
        rejectPromise(reason);
      },
    };

    if (idempotencyKey !== undefined) {
      task.key = idempotencyKey;
    }

    if (idempotencyKey) {
      this.inflight.set(idempotencyKey, promise);
    }

    this.queue.push(task);
    this.stats.pending = this.queue.length;
    void this.process();

    return promise;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift() as QueueTask;
      this.stats.pending = this.queue.length;
      this.stats.inflight = 1;

      try {
        const result = await task.execute(task.attempt);
        const attempts = task.attempt + 1;
        await task.resolve(result, attempts);
        this.stats.totalProcessed += 1;
        this.stats.inflight = 0;
        this.stats.pending = this.queue.length;
        delete this.stats.cooldownUntil;
        delete this.stats.lastDelayMs;
        delete this.stats.lastError;
        if (this.options.onSuccess) {
          this.options.onSuccess({ attempts });
        }
      } catch (error) {
        const nextAttempt = task.attempt + 1;
        const errorInfo = extractErrorInfo(error);

        if (nextAttempt < this.options.maxRetries) {
          const delay = this.computeDelay(error, nextAttempt);
          this.stats.totalRetried += 1;
          if (errorInfo) {
            this.stats.lastError = errorInfo;
          }
          this.stats.lastRetryAt = Date.now();
          this.stats.lastDelayMs = delay;
          if (delay > 0) {
            this.stats.cooldownUntil = Date.now() + delay;
            await sleep(delay);
          } else {
            delete this.stats.cooldownUntil;
          }

          this.queue.push({
            ...task,
            attempt: nextAttempt,
          });
          this.stats.pending = this.queue.length;
          this.stats.inflight = 0;

          if (this.options.onRetry) {
            this.options.onRetry({ attempt: nextAttempt, delayMs: delay, error });
          }
        } else {
          const attempts = task.attempt + 1;
          if (errorInfo) {
            this.stats.lastError = errorInfo;
          } else {
            delete this.stats.lastError;
          }
          this.stats.inflight = 0;
          this.stats.pending = this.queue.length;
          delete this.stats.cooldownUntil;
          await task.reject(error, attempts);
          if (this.options.onFailure) {
            this.options.onFailure({ attempts, error });
          }
        }
      }
    }

    this.stats.inflight = 0;
    this.processing = false;
  }

  getStats(): QueueStats {
    const oldestPendingAt =
      this.queue.length > 0
        ? this.queue.reduce<number | undefined>((oldest, task) => {
            if (oldest === undefined || task.enqueuedAt < oldest) {
              return task.enqueuedAt;
            }
            return oldest;
          }, undefined)
        : undefined;

    const result: QueueStats = {
      pending: this.stats.pending,
      inflight: this.stats.inflight,
      totalProcessed: this.stats.totalProcessed,
      totalRetried: this.stats.totalRetried,
    };

    if (this.stats.lastError) {
      result.lastError = { ...this.stats.lastError };
    }
    if (this.stats.lastRetryAt !== undefined) {
      result.lastRetryAt = this.stats.lastRetryAt;
    }
    if (this.stats.lastDelayMs !== undefined) {
      result.lastDelayMs = this.stats.lastDelayMs;
    }
    if (this.stats.cooldownUntil !== undefined) {
      result.cooldownUntil = this.stats.cooldownUntil;
    }
    if (oldestPendingAt !== undefined) {
      result.oldestPendingAt = oldestPendingAt;
    }

    return result;
  }

  private computeDelay(error: unknown, attempt: number): number {
    if (this.options.computeDelayMs) {
      const value = this.options.computeDelayMs({ attempt, error });
      if (Number.isFinite(value)) {
        return Math.max(0, Number(value));
      }
      return 0;
    }

    if (this.options.retryDelayMs > 0) {
      return Math.max(0, this.options.retryDelayMs * attempt);
    }

    return 0;
  }

  async getIdempotencyRecord<T = unknown>(key: string): Promise<IdempotencyRecord<T> | undefined> {
    return (await this.idempotencyStore.get(key)) as IdempotencyRecord<T> | undefined;
  }
}

function extractErrorInfo(error: unknown): QueueStats['lastError'] | undefined {
  const timestamp = Date.now();

  if (error instanceof Error) {
    const status =
      typeof (error as { status?: unknown }).status === 'number'
        ? ((error as { status?: number }).status as number)
        : undefined;
    const result: QueueStats['lastError'] = {
      message: error.message,
      timestamp,
    };
    if (status !== undefined) {
      result.status = status;
    }
    return result;
  }

  if (typeof error === 'string') {
    return { message: error, timestamp };
  }

  if (error && typeof error === 'object') {
    const status =
      typeof (error as { status?: unknown }).status === 'number'
        ? ((error as { status?: number }).status as number)
        : undefined;
    const result: QueueStats['lastError'] = {
      message: 'Unknown error',
      timestamp,
    };
    if (status !== undefined) {
      result.status = status;
    }
    return result;
  }

  return { message: 'Unknown error', timestamp };
}

export interface TrackingOptions {
  baseUrl: string;
  tokenAuth?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  idempotencyStore?: IdempotencyStore;
  backoff?: TrackingBackoffOptions;
}

export interface TrackingBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export interface TrackingQueueStats {
  pending: number;
  inflight: number;
  totalProcessed: number;
  totalRetried: number;
  lastError?: {
    message?: string;
    status?: number;
    timestamp: number;
  };
  lastRetryAt?: number;
  lastBackoffMs?: number;
  cooldownUntil?: number;
  lastRetryStatus?: number;
  oldestPendingAt?: number;
}

export interface TrackPayloadBase {
  siteId: number;
  url?: string;
  visitorId?: string;
  uid?: string;
  clientTokenAuth?: string;
  ts?: number;
  referrer?: string;
  userAgent?: string;
  language?: string;
  customVars?: Record<string, string | number>;
  idempotencyKey?: string;
}

export interface TrackPageviewInput extends Omit<TrackPayloadBase, 'url'> {
  url: string;
  actionName?: string;
  pvId?: string;
}

export interface TrackEventInput extends TrackPayloadBase {
  category: string;
  action: string;
  name?: string;
  value?: number;
  url?: string;
}

export interface TrackGoalInput extends TrackPayloadBase {
  goalId: number;
  revenue?: number;
  url?: string;
}

export interface TrackResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface TrackPageviewResult extends TrackResult {
  pvId: string;
}

export interface TrackingIdempotencyRecord {
  key: string;
  attempts: number;
  completedAt: number;
  result: TrackResult;
}

export type TrackingIdempotencyStore = IdempotencyStore<TrackResult>;

export class TrackingService {
  private readonly trackingUrl: string;
  private readonly tokenAuth: string | undefined;
  private readonly queue: RetryQueue;
  private readonly backoff: Required<TrackingBackoffOptions>;
  private readonly metrics: {
    totalRequests: number;
    totalRetries: number;
    lastBackoffMs: number;
    lastRetryStatus: number | undefined;
    lastRetryAt: number | undefined;
  } = {
    totalRequests: 0,
    totalRetries: 0,
    lastBackoffMs: 0,
    lastRetryStatus: undefined,
    lastRetryAt: undefined,
  };

  constructor(options: TrackingOptions) {
    this.trackingUrl = normalizeTrackingUrl(options.baseUrl);
    this.tokenAuth = options.tokenAuth;
    const baseDelay = options.backoff?.baseDelayMs ?? options.retryDelayMs ?? 150;
    const maxDelay = options.backoff?.maxDelayMs ?? 10_000;
    const jitterMs = options.backoff?.jitterMs ?? 250;

    this.backoff = {
      baseDelayMs: Math.max(1, baseDelay),
      maxDelayMs: Math.max(Math.max(1, baseDelay), maxDelay),
      jitterMs: Math.max(0, jitterMs),
    };

    const maxRetries = options.maxRetries ?? 4;
    const queueOptions: QueueOptions = {
      maxRetries,
      retryDelayMs: this.backoff.baseDelayMs,
      computeDelayMs: ({ attempt, error }) => this.computeBackoffDelay(attempt, error),
      onRetry: event => this.recordRetry(event),
      onFailure: event => this.recordFailure(event),
      onSuccess: event => this.recordSuccess(event),
    };
    if (options.idempotencyStore) {
      queueOptions.idempotencyStore = options.idempotencyStore;
    }
    this.queue = new RetryQueue(queueOptions);
  }

  getQueueStats(): TrackingQueueStats {
    const stats = this.queue.getStats();
    const result: TrackingQueueStats = {
      pending: stats.pending,
      inflight: stats.inflight,
      totalProcessed: stats.totalProcessed,
      totalRetried: stats.totalRetried,
      lastBackoffMs: this.metrics.lastBackoffMs,
    };

    if (stats.lastError) {
      result.lastError = stats.lastError;
    }
    if (stats.lastRetryAt !== undefined) {
      result.lastRetryAt = stats.lastRetryAt;
    }
    if (stats.cooldownUntil !== undefined) {
      result.cooldownUntil = stats.cooldownUntil;
    }
    if (this.metrics.lastRetryStatus !== undefined) {
      result.lastRetryStatus = this.metrics.lastRetryStatus;
    }
    if (stats.oldestPendingAt !== undefined) {
      result.oldestPendingAt = stats.oldestPendingAt;
    }

    return result;
  }

  async trackPageview(input: TrackPageviewInput): Promise<TrackPageviewResult> {
    const pvId = input.pvId ?? generatePvId();
    const idempotencyKey = input.idempotencyKey ?? pvId;

    const baseInput: Parameters<TrackingService['buildBaseParams']>[0] = {
      idSite: input.siteId,
    };
    if (input.url !== undefined) {
      baseInput.url = input.url;
    }
    if (input.visitorId !== undefined) {
      baseInput.visitorId = input.visitorId;
    }
    if (input.uid !== undefined) {
      baseInput.uid = input.uid;
    }
    if (input.ts !== undefined) {
      baseInput.ts = input.ts;
    }
    if (input.referrer !== undefined) {
      baseInput.referrer = input.referrer;
    }
    if (input.userAgent !== undefined) {
      baseInput.userAgent = input.userAgent;
    }
    if (input.language !== undefined) {
      baseInput.language = input.language;
    }
    if (input.customVars !== undefined) {
      baseInput.customVars = input.customVars;
    }

    const params = this.buildBaseParams(baseInput);

    params.set('action_name', input.actionName ?? input.url);
    params.set('pv_id', pvId);

    const result = await this.enqueueRequest(params, { idempotencyKey });
    return { ...result, pvId };
  }

  async trackEvent(input: TrackEventInput): Promise<TrackResult> {
    const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey();
    const baseInput: Parameters<TrackingService['buildBaseParams']>[0] = {
      idSite: input.siteId,
    };
    if (input.url !== undefined) {
      baseInput.url = input.url;
    }
    if (input.visitorId !== undefined) {
      baseInput.visitorId = input.visitorId;
    }
    if (input.uid !== undefined) {
      baseInput.uid = input.uid;
    }
    if (input.ts !== undefined) {
      baseInput.ts = input.ts;
    }
    if (input.referrer !== undefined) {
      baseInput.referrer = input.referrer;
    }
    if (input.userAgent !== undefined) {
      baseInput.userAgent = input.userAgent;
    }
    if (input.language !== undefined) {
      baseInput.language = input.language;
    }
    if (input.customVars !== undefined) {
      baseInput.customVars = input.customVars;
    }

    const params = this.buildBaseParams(baseInput);

    params.set('e_c', input.category);
    params.set('e_a', input.action);
    if (input.name) params.set('e_n', input.name);
    if (typeof input.value === 'number') params.set('e_v', String(input.value));

    return this.enqueueRequest(params, { idempotencyKey });
  }

  async trackGoal(input: TrackGoalInput): Promise<TrackResult> {
    const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey();
    const baseInput: Parameters<TrackingService['buildBaseParams']>[0] = {
      idSite: input.siteId,
    };
    if (input.url !== undefined) {
      baseInput.url = input.url;
    }
    if (input.visitorId !== undefined) {
      baseInput.visitorId = input.visitorId;
    }
    if (input.uid !== undefined) {
      baseInput.uid = input.uid;
    }
    if (input.ts !== undefined) {
      baseInput.ts = input.ts;
    }
    if (input.referrer !== undefined) {
      baseInput.referrer = input.referrer;
    }
    if (input.userAgent !== undefined) {
      baseInput.userAgent = input.userAgent;
    }
    if (input.language !== undefined) {
      baseInput.language = input.language;
    }
    if (input.customVars !== undefined) {
      baseInput.customVars = input.customVars;
    }

    const params = this.buildBaseParams(baseInput);

    params.set('idgoal', String(input.goalId));
    if (typeof input.revenue === 'number') {
      params.set('revenue', input.revenue.toString());
    }

    return this.enqueueRequest(params, { idempotencyKey });
  }

  private computeBackoffDelay(attempt: number, error: unknown): number {
    const info = extractBackoffInfo(error);
    if (typeof info.retryAfterMs === 'number' && Number.isFinite(info.retryAfterMs)) {
      return Math.max(0, info.retryAfterMs);
    }

    const exponent = Math.max(0, attempt - 1);
    const base = this.backoff.baseDelayMs * Math.pow(2, exponent);
    const capped = Math.min(this.backoff.maxDelayMs, base);
    const jitter = this.backoff.jitterMs > 0 ? Math.random() * this.backoff.jitterMs : 0;
    return Math.max(0, Math.round(capped + jitter));
  }

  private recordRetry(event: { attempt: number; delayMs: number; error: unknown }): void {
    this.metrics.totalRetries += 1;
    this.metrics.lastBackoffMs = event.delayMs;
    const info = extractBackoffInfo(event.error);
    this.metrics.lastRetryStatus = info.status;
    this.metrics.lastRetryAt = Date.now();
  }

  private recordFailure(event: { attempts: number; error: unknown }): void {
    const info = extractBackoffInfo(event.error);
    this.metrics.lastRetryStatus = info.status;
  }

  private recordSuccess(event: { attempts: number }): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { attempts } = event;
    // Keep the last backoff metrics but clear active retry timestamp.
    this.metrics.lastRetryAt = undefined;
  }

  private buildBaseParams(input: {
    idSite: number;
    url?: string;
    visitorId?: string;
    uid?: string;
    ts?: number;
    referrer?: string;
    userAgent?: string;
    language?: string;
    customVars?: Record<string, string | number>;
  }): URLSearchParams {
    const params = new URLSearchParams();
    params.set('idsite', String(input.idSite));
    params.set('rec', '1');
    params.set('apiv', '1');
    params.set('send_image', '0');

    if (input.url) params.set('url', input.url);
    if (input.visitorId) params.set('_id', input.visitorId);
    if (input.uid) params.set('uid', input.uid);
    if (typeof input.ts === 'number') params.set('cdt', new Date(input.ts).toISOString());
    if (input.referrer) params.set('urlref', input.referrer);
    if (input.userAgent) params.set('ua', input.userAgent);
    if (input.language) params.set('lang', input.language);

    if (input.customVars) {
      params.set('cvar', JSON.stringify(input.customVars));
    }

    if (this.tokenAuth) {
      params.set('token_auth', this.tokenAuth);
    }

    return params;
  }

  private enqueueRequest(
    params: URLSearchParams,
    options?: { idempotencyKey?: string }
  ): Promise<TrackResult> {
    return this.queue.enqueue(async attempt => {
      if (attempt === 0) {
        this.metrics.totalRequests += 1;
      }

      try {
        const response = await fetch(this.trackingUrl, {
          method: 'POST',
          body: params,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        const body = await response.text();

        if (!response.ok) {
          const headers = response.headers ?? new Headers();
          const retryAfterMs =
            parseRetryAfterHeader(headers.get('Retry-After')) ??
            parseRateLimitResetHeader(headers.get('X-Matomo-Rate-Limit-Reset'));

          const errorDetails: { status: number; retryAfterMs?: number } = {
            status: response.status,
          };
          if (retryAfterMs !== undefined) {
            errorDetails.retryAfterMs = retryAfterMs;
          }

          throw new MatomoTrackingError(
            `Matomo tracking request failed (${response.status} ${response.statusText})`,
            errorDetails
          );
        }

        return {
          ok: response.ok,
          status: response.status,
          body,
        } satisfies TrackResult;
      } catch (error) {
        if (error instanceof MatomoTrackingError) {
          throw error;
        }

        if (error instanceof Error) {
          throw new MatomoTrackingError(error.message || 'Matomo tracking request failed', {
            cause: error,
          });
        }

        throw new MatomoTrackingError('Matomo tracking request failed');
      }
    }, options);
  }

  async getIdempotencyRecord(key: string): Promise<TrackingIdempotencyRecord | undefined> {
    const record = await this.queue.getIdempotencyRecord<TrackResult>(key);
    if (!record) return undefined;

    return {
      key: record.key,
      attempts: record.attempts,
      completedAt: record.completedAt,
      result: record.value,
    } satisfies TrackingIdempotencyRecord;
  }
}

export { generatePvId, normalizeTrackingUrl, generateIdempotencyKey };
