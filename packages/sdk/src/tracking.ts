import { URLSearchParams } from 'node:url';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTrackingUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('Matomo base URL is required for tracking');
  }

  const trimmed = baseUrl.trim();
  if (trimmed.endsWith('matomo.php')) {
    return trimmed;
  }

  if (trimmed.endsWith('piwik.php')) {
    return trimmed;
  }

  return `${trimmed.replace(/\/?$/, '')}/matomo.php`;
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
  key?: string;
}

class RetryQueue {
  private readonly queue: QueueTask[] = [];
  private processing = false;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly idempotencyStore: IdempotencyStore;

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
      key: idempotencyKey,
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

    if (idempotencyKey) {
      this.inflight.set(idempotencyKey, promise);
    }

    this.queue.push(task);
    void this.process();

    return promise;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift() as QueueTask;
      try {
        const result = await task.execute(task.attempt);
        const attempts = task.attempt + 1;
        await task.resolve(result, attempts);
      } catch (error) {
        const nextAttempt = task.attempt + 1;
        if (nextAttempt < this.options.maxRetries) {
          if (this.options.retryDelayMs > 0) {
            await sleep(this.options.retryDelayMs * nextAttempt);
          }
          this.queue.push({
            ...task,
            attempt: nextAttempt,
          });
        } else {
          const attempts = task.attempt + 1;
          await task.reject(error, attempts);
        }
      }
    }

    this.processing = false;
  }

  async getIdempotencyRecord<T = unknown>(key: string): Promise<IdempotencyRecord<T> | undefined> {
    return (await this.idempotencyStore.get(key)) as IdempotencyRecord<T> | undefined;
  }
}

export interface TrackingOptions {
  baseUrl: string;
  tokenAuth?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  idempotencyStore?: IdempotencyStore;
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
  private readonly tokenAuth?: string;
  private readonly queue: RetryQueue;

  constructor(options: TrackingOptions) {
    this.trackingUrl = normalizeTrackingUrl(options.baseUrl);
    this.tokenAuth = options.tokenAuth;
    this.queue = new RetryQueue({
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 150,
      idempotencyStore: options.idempotencyStore,
    });
  }

  async trackPageview(input: TrackPageviewInput): Promise<TrackPageviewResult> {
    const pvId = input.pvId ?? generatePvId();
    const idempotencyKey = input.idempotencyKey ?? pvId;

    const params = this.buildBaseParams({
      idSite: input.siteId,
      url: input.url,
      visitorId: input.visitorId,
      uid: input.uid,
      ts: input.ts,
      referrer: input.referrer,
      userAgent: input.userAgent,
      language: input.language,
      customVars: input.customVars,
    });

    params.set('action_name', input.actionName ?? input.url);
    params.set('pv_id', pvId);

    const result = await this.enqueueRequest(params, { idempotencyKey });
    return { ...result, pvId };
  }

  async trackEvent(input: TrackEventInput): Promise<TrackResult> {
    const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey();
    const params = this.buildBaseParams({
      idSite: input.siteId,
      url: input.url,
      visitorId: input.visitorId,
      uid: input.uid,
      ts: input.ts,
      referrer: input.referrer,
      userAgent: input.userAgent,
      language: input.language,
      customVars: input.customVars,
    });

    params.set('e_c', input.category);
    params.set('e_a', input.action);
    if (input.name) params.set('e_n', input.name);
    if (typeof input.value === 'number') params.set('e_v', String(input.value));

    return this.enqueueRequest(params, { idempotencyKey });
  }

  async trackGoal(input: TrackGoalInput): Promise<TrackResult> {
    const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey();
    const params = this.buildBaseParams({
      idSite: input.siteId,
      url: input.url,
      visitorId: input.visitorId,
      uid: input.uid,
      ts: input.ts,
      referrer: input.referrer,
      userAgent: input.userAgent,
      language: input.language,
      customVars: input.customVars,
    });

    params.set('idgoal', String(input.goalId));
    if (typeof input.revenue === 'number') {
      params.set('revenue', input.revenue.toString());
    }

    return this.enqueueRequest(params, { idempotencyKey });
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
    return this.queue.enqueue(async () => {
      const response = await fetch(this.trackingUrl, {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Matomo tracking request failed: ${response.status} ${response.statusText}`);
      }

      return {
        ok: response.ok,
        status: response.status,
        body,
      } satisfies TrackResult;
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
