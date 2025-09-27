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

interface QueueOptions {
  maxRetries: number;
  retryDelayMs: number;
}

interface QueueTask {
  attempt: number;
  execute: (attempt: number) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

class RetryQueue {
  private readonly queue: QueueTask[] = [];
  private processing = false;

  constructor(private readonly options: QueueOptions) {}

  enqueue<T>(run: (attempt: number) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueueTask = {
        attempt: 0,
        execute: run as (attempt: number) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.queue.push(task);
      void this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift() as QueueTask;
      try {
        const result = await task.execute(task.attempt);
        task.resolve(result);
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
          task.reject(error);
        }
      }
    }

    this.processing = false;
  }
}

export interface TrackingOptions {
  baseUrl: string;
  tokenAuth?: string;
  maxRetries?: number;
  retryDelayMs?: number;
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
    });
  }

  async trackPageview(input: TrackPageviewInput): Promise<TrackPageviewResult> {
    const pvId = input.pvId ?? generatePvId();

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

    const result = await this.enqueueRequest(params);
    return { ...result, pvId };
  }

  async trackEvent(input: TrackEventInput): Promise<TrackResult> {
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

    return this.enqueueRequest(params);
  }

  async trackGoal(input: TrackGoalInput): Promise<TrackResult> {
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

    return this.enqueueRequest(params);
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

  private enqueueRequest(params: URLSearchParams): Promise<TrackResult> {
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
    });
  }
}

export { generatePvId, normalizeTrackingUrl };
