import { EventEmitter } from 'node:events';

import type { Express } from 'express';
import httpMocks from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMatomoClient = {
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
  trackPageview: vi.fn(),
  trackEvent: vi.fn(),
  trackGoal: vi.fn(),
};

const createMatomoClientMock = vi.fn(() => mockMatomoClient);

vi.mock('@matokit/sdk', () => ({
  createMatomoClient: createMatomoClientMock,
}));

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

async function invoke(app: Express, options: InvokeOptions): Promise<{ status: number; body: unknown }> {
  const { url, method = 'POST', headers = {}, body } = options;

  const req = httpMocks.createRequest({
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    res.on('end', () => {
      const payload = res._isJSON() ? res._getJSONData() : res._getData();
      resolve({
        status: res.statusCode,
        body: payload,
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
  mockMatomoClient.trackPageview.mockReset();
  mockMatomoClient.trackEvent.mockReset();
  mockMatomoClient.trackGoal.mockReset();

  process.env.MATOMO_BASE_URL = 'https://matomo.example.com';
  process.env.MATOMO_TOKEN = 'token';
  process.env.MATOMO_DEFAULT_SITE_ID = '1';
  process.env.OPAL_BEARER_TOKEN = 'change-me';
});

afterEach(() => {
  delete process.env.MATOMO_BASE_URL;
  delete process.env.MATOMO_TOKEN;
  delete process.env.MATOMO_DEFAULT_SITE_ID;
  delete process.env.OPAL_BEARER_TOKEN;
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
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('proxies to getKeyNumbers with parsed parameters', async () => {
    const app = await createApp();
    const mockResponse = { nb_visits: 10 };
    mockMatomoClient.getKeyNumbers.mockResolvedValue(mockResponse);

    const response = await invoke(app, {
      url: '/tools/get-key-numbers',
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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

  it('forwards referrer requests with defaults when omitted', async () => {
    const app = await createApp();
    const referrersPayload = [{ label: 'Search', nb_visits: 12 }];
    mockMatomoClient.getTopReferrers.mockResolvedValue(referrersPayload);

    const response = await invoke(app, {
      url: '/tools/get-top-referrers',
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
      body: { parameters: { period: 'day', date: 'today' } },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Unexpected token < in JSON at position 0' });
  });

  it('records pageviews via track endpoint', async () => {
    const app = await createApp();
    mockMatomoClient.trackPageview.mockResolvedValue({ ok: true, status: 204, body: '', pvId: 'abcdef1234567890' });

    const response = await invoke(app, {
      url: '/track/pageview',
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
      body: { parameters: {} },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'url is required' });
    expect(mockMatomoClient.trackPageview).not.toHaveBeenCalled();
  });

  it('records events via track endpoint', async () => {
    const app = await createApp();
    mockMatomoClient.trackEvent.mockResolvedValue({ ok: true, status: 204, body: '' });

    const response = await invoke(app, {
      url: '/track/event',
      headers: { authorization: 'Bearer change-me' },
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
      headers: { authorization: 'Bearer change-me' },
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
