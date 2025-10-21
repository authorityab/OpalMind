import { EventEmitter } from 'node:events';

import type { Express, NextFunction, Request, Response } from 'express';
import httpMocks from 'node-mocks-http';
import type { LogRecord } from '@opalmind/logger';
import { MatomoClientError } from '@opalmind/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMatomoClient = vi.hoisted(() => ({
  getKeyNumbers: vi.fn(),
  getKeyNumbersSeries: vi.fn(),
  getMostPopularUrls: vi.fn(),
  getTopReferrers: vi.fn(),
  getEntryPages: vi.fn(),
  getCampaigns: vi.fn(),
  getEvents: vi.fn(),
  getEcommerceOverview: vi.fn(),
  getEcommerceRevenueTotals: vi.fn(),
  getEventCategories: vi.fn(),
  getDeviceTypes: vi.fn(),
  getTrafficChannels: vi.fn(),
  getGoalConversions: vi.fn(),
  getFunnelSummary: vi.fn(),
  runDiagnostics: vi.fn(),
  getHealthStatus: vi.fn(),
  trackPageview: vi.fn(),
  trackEvent: vi.fn(),
  trackGoal: vi.fn(),
}));

const createMatomoClientMock = vi.hoisted(() => vi.fn(() => mockMatomoClient));
const logRecords = vi.hoisted(() => [] as LogRecord[]);
const testTransport = vi.hoisted(
  () =>
    (record: LogRecord) => {
      logRecords.push(record);
    }
);

vi.mock('@opalmind/sdk', async () => {
  const actual = await vi.importActual<typeof import('@opalmind/sdk')>('@opalmind/sdk');
  return {
    ...actual,
    createMatomoClient: createMatomoClientMock,
  };
});

vi.mock('@opalmind/logger', async () => {
  const actual = await vi.importActual<typeof import('@opalmind/logger')>('@opalmind/logger');
  const transport = testTransport;
  return {
    ...actual,
    logger: actual.createLogger({ service: 'opal' }, transport),
    createLogger: (bindings: Record<string, unknown> = {}, customTransport = transport) =>
      actual.createLogger(bindings, customTransport),
  };
});

type ExpressErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => void;

function isErrorHandlerLayer(layer: { handle: unknown }): layer is { handle: ExpressErrorHandler } {
  return typeof layer.handle === 'function' && layer.handle.length === 4;
}

async function createApp(): Promise<Express> {
  const module = await import('../src/server.js');
  return module.buildServer();
}

interface InvokeOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface InvokeResult {
  status: number;
  body: unknown;
  headers: NodeJS.OutgoingHttpHeaders;
}

async function invoke(app: Express, options: InvokeOptions): Promise<InvokeResult> {
  const { url, method = 'POST', headers = {}, body } = options;

  const req = httpMocks.createRequest({
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

  return new Promise<InvokeResult>((resolve, reject) => {
    res.on('end', () => {
      const payload = res._isJSON() ? res._getJSONData() : res._getData();
      resolve({
        status: res.statusCode,
        body: payload,
        headers: res.getHeaders(),
      });
    });

    res.on('error', reject);

    app.handle(req, res);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createMatomoClientMock.mockImplementation(() => mockMatomoClient);
  mockMatomoClient.getKeyNumbers.mockReset();
  mockMatomoClient.getKeyNumbersSeries.mockReset();
  mockMatomoClient.getMostPopularUrls.mockReset();
  mockMatomoClient.getTopReferrers.mockReset();
  mockMatomoClient.getEntryPages.mockReset();
  mockMatomoClient.getCampaigns.mockReset();
  mockMatomoClient.getEvents.mockReset();
  mockMatomoClient.getEcommerceOverview.mockReset();
  mockMatomoClient.getEcommerceRevenueTotals.mockReset();
  mockMatomoClient.getEventCategories.mockReset();
  mockMatomoClient.getDeviceTypes.mockReset();
  mockMatomoClient.getTrafficChannels.mockReset();
  mockMatomoClient.getGoalConversions.mockReset();
  mockMatomoClient.getFunnelSummary.mockReset();
  mockMatomoClient.runDiagnostics.mockReset();
  mockMatomoClient.getHealthStatus.mockReset();
  mockMatomoClient.trackPageview.mockReset();
  mockMatomoClient.trackEvent.mockReset();
  mockMatomoClient.trackGoal.mockReset();

  delete process.env.OPAL_CORS_ALLOWLIST;
  delete process.env.OPAL_CORS_ALLOW_ALL;
  delete process.env.OPAL_REQUEST_BODY_LIMIT;
  delete process.env.OPAL_RATE_LIMIT_WINDOW_MS;
  delete process.env.OPAL_RATE_LIMIT_MAX;
  delete process.env.OPAL_TRACK_RATE_LIMIT_MAX;
  delete process.env.MATOMO_CACHE_WARN_HIT_RATE;
  delete process.env.MATOMO_CACHE_FAIL_HIT_RATE;
  delete process.env.MATOMO_CACHE_SAMPLE_SIZE;

  process.env.MATOMO_BASE_URL = 'https://matomo.example.com';
  process.env.MATOMO_TOKEN = 'token';
  process.env.MATOMO_DEFAULT_SITE_ID = '1';
  process.env.OPAL_BEARER_TOKEN = 'test-token';
});

afterEach(() => {
  delete process.env.MATOMO_BASE_URL;
  delete process.env.MATOMO_TOKEN;
  delete process.env.MATOMO_DEFAULT_SITE_ID;
  delete process.env.OPAL_BEARER_TOKEN;
  delete process.env.OPAL_CORS_ALLOWLIST;
  delete process.env.OPAL_CORS_ALLOW_ALL;
  delete process.env.OPAL_REQUEST_BODY_LIMIT;
  delete process.env.OPAL_RATE_LIMIT_WINDOW_MS;
  delete process.env.OPAL_RATE_LIMIT_MAX;
  delete process.env.OPAL_TRACK_RATE_LIMIT_MAX;
});

describe('health endpoint', () => {
  it('returns liveness without invoking Matomo', async () => {
    const app = await createApp();

    const response = await invoke(app, {
      url: '/healthz',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: 'alive' });
    expect(mockMatomoClient.getHealthStatus).not.toHaveBeenCalled();
  });

  it('returns readiness diagnostics when Matomo is healthy', async () => {
    const app = await createApp();
    const healthPayload = {
      status: 'healthy',
      checks: [
        {
          name: 'matomo-api',
          status: 'pass',
          componentType: 'service',
          observedValue: 120,
          observedUnit: 'ms',
          time: '2024-03-01T12:00:00.000Z',
          output: 'API responded in 120ms',
        },
      ],
    };
    mockMatomoClient.getHealthStatus.mockResolvedValue(healthPayload);

    const response = await invoke(app, {
      url: '/readyz',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      status: 'healthy',
      health: healthPayload,
    });
  });

  it('returns health diagnostics when Matomo is healthy', async () => {
    const app = await createApp();
    const healthPayload = {
      status: 'healthy',
      checks: [
        {
          name: 'matomo-api',
          status: 'pass',
          componentType: 'service',
          observedValue: 120,
          observedUnit: 'ms',
          time: '2024-03-01T12:00:00.000Z',
          output: 'API responded in 120ms',
        },
      ],
    };
    mockMatomoClient.getHealthStatus.mockResolvedValue(healthPayload);

    const response = await invoke(app, {
      url: '/health',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      status: 'healthy',
      health: healthPayload,
    });
    expect(mockMatomoClient.getHealthStatus).toHaveBeenCalledWith();
  });

  it('returns 503 when health status is unhealthy', async () => {
    const app = await createApp();
    const healthPayload = {
      status: 'unhealthy',
      checks: [
        {
          name: 'matomo-api',
          status: 'fail',
          componentType: 'service',
          observedValue: 0,
          observedUnit: 'ms',
          time: '2024-03-01T12:05:00.000Z',
          output: 'Matomo unreachable',
        },
      ],
    };
    mockMatomoClient.getHealthStatus.mockResolvedValue(healthPayload);

    const response = await invoke(app, {
      url: '/health',
      method: 'GET',
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      status: 'unhealthy',
      health: healthPayload,
    });
  });

  it('returns 503 when readiness reports unhealthy', async () => {
    const app = await createApp();
    const healthPayload = {
      status: 'unhealthy',
      checks: [],
    };
    mockMatomoClient.getHealthStatus.mockResolvedValue(healthPayload);

    const response = await invoke(app, {
      url: '/readyz',
      method: 'GET',
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      status: 'unhealthy',
      health: healthPayload,
    });
  });

  it('redacts token information when diagnostics throw', async () => {
    const app = await createApp();
    mockMatomoClient.getHealthStatus.mockRejectedValue(
      new Error('Failed to reach Matomo instance token_auth=secret')
    );

    const response = await invoke(app, {
      url: '/health',
      method: 'GET',
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      status: 'unhealthy',
      error: 'Matomo diagnostics unavailable',
    });
  });
});

describe('security middleware', () => {
  it('honors configured CORS allowlist', async () => {
    process.env.OPAL_CORS_ALLOWLIST = 'https://allowed.example.com';
    mockMatomoClient.getHealthStatus.mockResolvedValue({ status: 'healthy', checks: [] });

    const app = await createApp();
    const response = await invoke(app, {
      url: '/health',
      method: 'GET',
      headers: { origin: 'https://allowed.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
  });

  it('applies rate limiting to tool endpoints', async () => {
    process.env.OPAL_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.OPAL_RATE_LIMIT_MAX = '1';
    mockMatomoClient.getKeyNumbers.mockResolvedValue({ nb_visits: 5 });

    const app = await createApp();

    const first = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'day', date: 'today' } },
    });
    expect(first.status).toBe(200);

    const second = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'day', date: 'today' } },
    });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'Too many requests, please try again later.' });
  });

  it('applies stricter rate limiting to tracking endpoints', async () => {
    process.env.OPAL_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.OPAL_TRACK_RATE_LIMIT_MAX = '1';
    mockMatomoClient.trackEvent.mockResolvedValue({ ok: true, status: 204, body: '' });

    const app = await createApp();

    const first = await invoke(app, {
      url: '/track/event',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { category: 'cta', action: 'click', siteId: 1 } },
    });
    expect(first.status).toBe(200);

    const second = await invoke(app, {
      url: '/track/event',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { category: 'cta', action: 'click', siteId: 1 } },
    });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'Too many tracking requests, please try again later.' });
  });

  it('rejects payloads exceeding the configured body limit', async () => {
    const app = await createApp();
    const routerStack = (app as unknown as { _router?: { stack: Array<{ handle: unknown }> } })._router?.stack ?? [];
    const errorLayer = routerStack.find(isErrorHandlerLayer);
    if (!errorLayer) {
      throw new Error('Expected error handling middleware to be registered.');
    }

    const req = httpMocks.createRequest({
      method: 'POST',
      url: '/tools/get-key-numbers',
    });
    const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

    const simulatedError = Object.assign(new Error('entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: res._isJSON() ? res._getJSONData() : res._getData(),
        });
      });
      res.on('error', reject);

      errorLayer.handle(
        simulatedError,
        req as unknown as Request,
        res as unknown as Response,
        reject as NextFunction
      );
    });

    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: 'Request body is too large.' });
  });
});

describe('tools logging', () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  afterEach(() => {
    logRecords.length = 0;
  });

  it('redacts sensitive values from request/success logs', async () => {
    const app = await createApp();
    mockMatomoClient.getKeyNumbers.mockResolvedValue({ nb_visits: 5 });

    await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: {
        parameters: { period: 'day', date: 'today', token_auth: 'super-secret' },
      },
    });

    const infoEntries = logRecords.filter(record => record.level === 'info' && record.message === 'tools');
    const serialized = JSON.stringify(infoEntries satisfies LogRecord[]);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('token_auth=');
    expect(serialized).toContain('[redacted]');
  });

  it('redacts sensitive values from error logs and responses', async () => {
    const app = await createApp();
    mockMatomoClient.getKeyNumbers.mockRejectedValue(
      new MatomoClientError('Failed to fetch key numbers from Matomo. Please try again later.', {
        status: 500,
        code: 'matomo.error',
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          data: { error: 'Your token_auth=super-secret is invalid' },
        },
      })
    );

    const result = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: {
        parameters: { period: 'day', date: 'today', token_auth: 'super-secret' },
      },
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Failed to fetch key numbers from Matomo. Please try again later.' });

    const errorEntries = logRecords.filter(record => record.level === 'error' && record.message === 'tools');
    const serializedErrors = JSON.stringify(errorEntries satisfies LogRecord[]);
    expect(serializedErrors).not.toContain('super-secret');
    expect(serializedErrors).not.toContain('token_auth=');
    expect(serializedErrors).toContain('[redacted]');
  });
});

describe('tool endpoints', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await createApp();

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      body: { parameters: { period: 'day', date: 'today' } },
      headers: {},
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authorization header missing or malformed.' });
    expect(response.headers['www-authenticate']).toContain('error="invalid_request"');
  });

  it('rejects requests with invalid bearer tokens', async () => {
    const app = await createApp();

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      body: { parameters: { period: 'day', date: 'today' } },
      headers: { authorization: 'Bearer totally-wrong-token' },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid bearer token.' });
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('accepts bearer tokens regardless of casing', async () => {
    const app = await createApp();
    const mockResponse = { nb_visits: 5 };
    mockMatomoClient.getKeyNumbers.mockResolvedValue(mockResponse);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      body: { parameters: { period: 'day', date: 'today' } },
      headers: { authorization: 'bearer TEST-TOKEN' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResponse);
  });

  it('proxies to getKeyNumbers with parsed parameters', async () => {
    const app = await createApp();
    const mockResponse = { nb_visits: 10 };
    mockMatomoClient.getKeyNumbers.mockResolvedValue(mockResponse);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'week', date: '2024-01-01', segment: 'country==SE' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResponse);
    expect(mockMatomoClient.getKeyNumbers).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'week',
      date: '2024-01-01',
      segment: 'country==SE',
    });
  });

  it('returns historical key numbers with defaults', async () => {
    const app = await createApp();
    const historicalPayload = [
      { date: '2024-02-01', nb_visits: 10, nb_pageviews: 15 },
      { date: '2024-02-02', nb_visits: 12, nb_pageviews: 18 },
    ];
    mockMatomoClient.getKeyNumbersSeries.mockResolvedValue(historicalPayload);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers-historical',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(historicalPayload);
    expect(mockMatomoClient.getKeyNumbersSeries).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'last7',
      segment: undefined,
    });
  });

  it('coerces numeric parameters for list endpoints', async () => {
    const app = await createApp();
    const urlsPayload = [{ label: 'Home', nb_visits: 42 }];
    mockMatomoClient.getMostPopularUrls.mockResolvedValue(urlsPayload);

    const response = await invoke(app, {
      url: '/tools/get-most-popular-urls',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { limit: '5', period: 'month', date: 'yesterday' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(urlsPayload);
    expect(mockMatomoClient.getMostPopularUrls).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'month',
      date: 'yesterday',
      segment: undefined,
      limit: 5,
    });
  });

  it('returns funnel analytics for the requested funnel', async () => {
    const app = await createApp();
    const funnelPayload = {
      id: 'signup',
      label: 'Signup Funnel',
      period: 'month',
      date: '2024-01-01',
      steps: [{ id: '1', label: 'Landing', conversions: 120 }],
    };

    mockMatomoClient.getFunnelSummary.mockResolvedValue(funnelPayload);

    const response = await invoke(app, {
      url: '/tools/get-funnel-analytics',
      headers: { authorization: 'Bearer test-token' },
      body: {
        parameters: {
          siteId: 3,
          funnelId: 'signup',
          period: 'month',
          date: '2024-01-01',
          segment: 'country==SE',
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(funnelPayload);
    expect(mockMatomoClient.getFunnelSummary).toHaveBeenCalledWith({
      siteId: 3,
      funnelId: 'signup',
      period: 'month',
      date: '2024-01-01',
      segment: 'country==SE',
    });
  });

  it('returns diagnostics result from Matomo client', async () => {
    const app = await createApp();
    const diagnostics = {
      checks: [
        { id: 'base-url', label: 'Matomo base URL reachability', status: 'ok', details: { version: '5.0.0' } },
      ],
    };
    mockMatomoClient.runDiagnostics.mockResolvedValue(diagnostics);

    const response = await invoke(app, {
      url: '/tools/diagnose-matomo',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { siteId: '7' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(diagnostics);
    expect(mockMatomoClient.runDiagnostics).toHaveBeenCalledWith({ siteId: 7 });
  });

  it('forwards referrer requests with defaults when omitted', async () => {
    const app = await createApp();
    const referrersPayload = [{ label: 'Search', nb_visits: 12 }];
    mockMatomoClient.getTopReferrers.mockResolvedValue(referrersPayload);

    const response = await invoke(app, {
      url: '/tools/get-top-referrers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(referrersPayload);
    expect(mockMatomoClient.getTopReferrers).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'today',
      segment: undefined,
      limit: undefined,
    });
  });

  it('returns entry pages with parsed parameters', async () => {
    const app = await createApp();
    const entryPayload = [{ label: '/home', nb_visits: 42 }];
    mockMatomoClient.getEntryPages.mockResolvedValue(entryPayload);

    const response = await invoke(app, {
      url: '/tools/get-entry-pages',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'week', date: 'yesterday', limit: '15' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(entryPayload);
    expect(mockMatomoClient.getEntryPages).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'week',
      date: 'yesterday',
      segment: undefined,
      limit: 15,
    });
  });

  it('returns campaign metrics with defaults', async () => {
    const app = await createApp();
    const campaignPayload = [{ label: 'Spring Launch', nb_visits: 12 }];
    mockMatomoClient.getCampaigns.mockResolvedValue(campaignPayload);

    const response = await invoke(app, {
      url: '/tools/get-campaigns',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(campaignPayload);
    expect(mockMatomoClient.getCampaigns).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'today',
      segment: undefined,
      limit: undefined,
    });
  });

  it('returns ecommerce overview with defaults', async () => {
    const app = await createApp();
    const ecommerceResponse = { revenue: 120, nb_conversions: 3 };
    mockMatomoClient.getEcommerceOverview.mockResolvedValue(ecommerceResponse);

    const response = await invoke(app, {
      url: '/tools/get-ecommerce-overview',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(ecommerceResponse);
    expect(mockMatomoClient.getEcommerceOverview).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'today',
      segment: undefined,
    });
  });

  it('returns ecommerce revenue totals with optional series', async () => {
    const app = await createApp();
    const payload = {
      totals: { revenue: 150, nb_conversions: 3 },
      series: [{ label: '2025-09-25', revenue: 100, nb_conversions: 2 }],
    };
    mockMatomoClient.getEcommerceRevenueTotals.mockResolvedValue(payload);

    const response = await invoke(app, {
      url: '/tools/get-ecommerce-revenue',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'day', date: 'last2', includeSeries: 'true' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(mockMatomoClient.getEcommerceRevenueTotals).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'last2',
      segment: undefined,
      includeSeries: true,
    });
  });

  it('returns traffic channels with optional filtering', async () => {
    const app = await createApp();
    const channelsPayload = [
      { label: 'Direct Entry', nb_visits: 120 },
      { label: 'Search Engines', nb_visits: 80 },
    ];
    mockMatomoClient.getTrafficChannels.mockResolvedValue(channelsPayload);

    const response = await invoke(app, {
      url: '/tools/get-traffic-channels',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { channelType: 'search', period: 'week', date: '2025-09-01', limit: '10' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(channelsPayload);
    expect(mockMatomoClient.getTrafficChannels).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'week',
      date: '2025-09-01',
      segment: undefined,
      limit: 10,
      channelType: 'search',
    });
  });

  it('returns goal conversions with optional filters', async () => {
    const app = await createApp();
    const goalsPayload = [{ id: 'ecommerceOrder', label: 'Orders', type: 'ecommerce', nb_conversions: 12 }];
    mockMatomoClient.getGoalConversions.mockResolvedValue(goalsPayload);

    const response = await invoke(app, {
      url: '/tools/get-goal-conversions',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { goalType: 'ecommerce', period: 'month', date: '2025-01' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(goalsPayload);
    expect(mockMatomoClient.getGoalConversions).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'month',
      date: '2025-01',
      segment: undefined,
      limit: undefined,
      goalId: undefined,
      goalType: 'ecommerce',
    });
  });

  it('retrieves events with optional filters', async () => {
    const app = await createApp();
    const eventsPayload = [{ label: 'CTA > click', nb_events: 5 }];
    mockMatomoClient.getEvents.mockResolvedValue(eventsPayload);

    const response = await invoke(app, {
      url: '/tools/get-events',
      headers: { authorization: 'Bearer test-token' },
      body: {
        parameters: {
          period: 'month',
          date: '2024-02-01',
          segment: 'country==SE',
          limit: '50',
          category: 'CTA',
          action: 'click',
          name: 'Download',
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(eventsPayload);
    expect(mockMatomoClient.getEvents).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'month',
      date: '2024-02-01',
      segment: 'country==SE',
      limit: 50,
      category: 'CTA',
      action: 'click',
      name: 'Download',
    });
  });

  it('returns event categories with limit parsing', async () => {
    const app = await createApp();
    const categoriesPayload = [{ label: 'CTA', nb_events: 5 }];
    mockMatomoClient.getEventCategories.mockResolvedValue(categoriesPayload);

    const response = await invoke(app, {
      url: '/tools/get-event-categories',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { limit: '25', period: 'week', date: '2024-03-01' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(categoriesPayload);
    expect(mockMatomoClient.getEventCategories).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'week',
      date: '2024-03-01',
      segment: undefined,
      limit: 25,
    });
  });

  it('returns device type breakdown', async () => {
    const app = await createApp();
    const devicesPayload = [{ label: 'Desktop', nb_visits: 42 }];
    mockMatomoClient.getDeviceTypes.mockResolvedValue(devicesPayload);

    const response = await invoke(app, {
      url: '/tools/get-device-types',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { segment: 'country==SE', limit: '10' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(devicesPayload);
    expect(mockMatomoClient.getDeviceTypes).toHaveBeenCalledWith({
      siteId: undefined,
      period: 'day',
      date: 'today',
      segment: 'country==SE',
      limit: 10,
    });
  });

  it('returns 500 when Matomo client rejects (missing siteId)', async () => {
    const app = await createApp();
    const error = new Error('siteId is required');
    mockMatomoClient.getKeyNumbers.mockRejectedValue(error);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'siteId is required' });
    expect(mockMatomoClient.getKeyNumbers).toHaveBeenCalledTimes(1);
  });

  it('surfaces Matomo client parse errors (bad JSON)', async () => {
    const app = await createApp();
    const parseError = new SyntaxError('Unexpected token < in JSON at position 0');
    mockMatomoClient.getKeyNumbers.mockRejectedValue(parseError);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'day', date: 'today' } },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Unexpected token < in JSON at position 0' });
  });

  it('redacts Matomo token details from tool error responses', async () => {
    const app = await createApp();
    const matomoError = new MatomoClientError('Matomo authentication failed: Invalid token', {
      endpoint:
        'https://matomo.example.com/index.php?module=API&method=VisitsSummary.get&token_auth=REDACTED',
    });

    mockMatomoClient.getKeyNumbers.mockRejectedValue(matomoError);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { period: 'day', date: 'today' } },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Matomo authentication failed: Invalid token' });
    expect(matomoError.endpoint).toContain('token_auth=REDACTED');
    expect(response.body.error).not.toContain('token_auth');
  });

  it('records pageviews via track endpoint', async () => {
    const app = await createApp();
    mockMatomoClient.trackPageview.mockResolvedValue({ ok: true, status: 204, body: '', pvId: 'abcdef1234567890' });

    const response = await invoke(app, {
      url: '/track/pageview',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { url: 'https://example.com/', actionName: 'Home' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: 204, pvId: 'abcdef1234567890' });
    expect(mockMatomoClient.trackPageview).toHaveBeenCalledWith({
      siteId: undefined,
      url: 'https://example.com/',
      actionName: 'Home',
      pvId: undefined,
      visitorId: undefined,
      uid: undefined,
      referrer: undefined,
      ts: undefined,
    });
  });

  it('requires url for pageview tracking', async () => {
    const app = await createApp();

    const response = await invoke(app, {
      url: '/track/pageview',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'url is required' });
    expect(mockMatomoClient.trackPageview).not.toHaveBeenCalled();
  });

  it('records events via track endpoint', async () => {
    const app = await createApp();
    mockMatomoClient.trackEvent.mockResolvedValue({ ok: true, status: 204, body: '' });

    const response = await invoke(app, {
      url: '/track/event',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { category: 'CTA', action: 'click', value: 2 } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: 204 });
    expect(mockMatomoClient.trackEvent).toHaveBeenCalledWith({
      siteId: undefined,
      category: 'CTA',
      action: 'click',
      name: undefined,
      value: 2,
      url: undefined,
      visitorId: undefined,
      uid: undefined,
      referrer: undefined,
      ts: undefined,
    });
  });

  it('records goals via track endpoint', async () => {
    const app = await createApp();
    mockMatomoClient.trackGoal.mockResolvedValue({ ok: true, status: 204, body: '' });

    const response = await invoke(app, {
      url: '/track/goal',
      headers: { authorization: 'Bearer test-token' },
      body: { parameters: { goalId: 5, revenue: 10.5 } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: 204 });
    expect(mockMatomoClient.trackGoal).toHaveBeenCalledWith({
      siteId: undefined,
      goalId: 5,
      revenue: 10.5,
      url: undefined,
      visitorId: undefined,
      uid: undefined,
      referrer: undefined,
      ts: undefined,
    });
  });
});

describe('tracking endpoints', () => {
  it('rejects unauthenticated tracking requests', async () => {
    const app = await createApp();

    const response = await invoke(app, {
      url: '/track/pageview',
      body: { parameters: { url: 'https://example.com/' } },
      headers: {},
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authorization header missing or malformed.' });
    expect(response.headers['www-authenticate']).toContain('error="invalid_request"');
  });
});

describe('configuration guards', () => {
  it('throws when MATOMO_BASE_URL is missing', async () => {
    delete process.env.MATOMO_BASE_URL;

    await expect(createApp()).rejects.toThrow('MATOMO_BASE_URL must be set before starting the service.');
  });

  it('throws when MATOMO_TOKEN is missing', async () => {
    delete process.env.MATOMO_TOKEN;

    await expect(createApp()).rejects.toThrow('MATOMO_TOKEN must be set to a valid Matomo token before starting the service.');
  });

  it('throws when MATOMO_DEFAULT_SITE_ID is not numeric', async () => {
    process.env.MATOMO_DEFAULT_SITE_ID = 'not-a-number';

    await expect(createApp()).rejects.toThrow('MATOMO_DEFAULT_SITE_ID must be a valid integer when provided.');
  });
});
