import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMatomoClient, TrackingService, type TrackingQueueStats } from '../src/index.js';

const baseUrl = 'https://matomo.example.com';
const token = 'token';

const createFetchMock = <T>(data: T) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

type JsonResponseOverrides = {
  ok?: boolean;
  status?: number;
  statusText?: string;
};

const createJsonResponse = (data: unknown, overrides: JsonResponseOverrides = {}) => ({
  ok: overrides.ok ?? true,
  status: overrides.status ?? 200,
  statusText: overrides.statusText ?? 'OK',
  headers: new Headers(),
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const createSequencedFetchMock = (responses: unknown[]) => {
  const mock = vi.fn();
  responses.forEach(response => {
    mock.mockResolvedValueOnce(createJsonResponse(response));
  });
  return mock;
};

const createMethodMissingResponse = (method: string) =>
  createJsonResponse(
    {
      result: 'error',
      message: `Method '${method}' does not exist or is not available in module '\\Piwik\\Plugins\\API\\API'.`,
    },
    { ok: false, status: 400, statusText: 'Bad Request' }
  );

const createPermissionErrorResponse = (method: string) =>
  createJsonResponse(
    {
      result: 'error',
      message: `Access denied for method '${method}'.`,
    },
    { ok: false, status: 403, statusText: 'Forbidden' }
  );
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MatomoClient', () => {
  it('throws when siteId is missing', async () => {
    const client = createMatomoClient({ baseUrl, tokenAuth: token });
    await expect(client.getKeyNumbers()).rejects.toThrow('siteId is required');
  });

  it('resolves default site ID when provided and merges pageview totals', async () => {
    const fetchMock = createSequencedFetchMock([{ nb_visits: 42 }, { nb_pageviews: 149, nb_uniq_pageviews: 140 }]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 5 });
    const result = await client.getKeyNumbers();

    expect(result.nb_visits).toEqual(42);
    expect(result.nb_pageviews).toEqual(149);
    expect(result.nb_uniq_pageviews).toEqual(140);

    const firstUrl = new URL((fetchMock.mock.calls[0] ?? [])[0] as string);
    expect(firstUrl.searchParams.get('idSite')).toBe('5');

    const secondUrl = new URL((fetchMock.mock.calls[1] ?? [])[0] as string);
    expect(secondUrl.searchParams.get('method')).toBe('Actions.get');
    expect(secondUrl.searchParams.get('idSite')).toBe('5');
  });

  it('guards against NaN responses from Matomo key numbers', async () => {
    const fetchMock = createSequencedFetchMock([
      {
        nb_visits: 'NaN',
        nb_actions: 'NaN',
        nb_visits_converted: false,
        sum_visit_length: '',
      },
      { nb_pageviews: 'NaN', nb_uniq_pageviews: 'NaN' },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 8 });
    const result = await client.getKeyNumbers();

    expect(result.nb_visits).toBe(0);
    expect(result.nb_actions).toBeUndefined();
    expect(result.nb_visits_converted).toBeUndefined();
    expect(result.nb_pageviews).toBeUndefined();
  });

  it('coerces scalar key number payloads into objects', async () => {
    const fetchMock = createSequencedFetchMock(['0', { nb_pageviews: '0' }]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 11 });
    const result = await client.getKeyNumbers();

    expect(result.nb_visits).toBe(0);
    expect(result.nb_pageviews).toBe(0);
  });

  it('unwraps array key number payloads returned by Matomo', async () => {
    const fetchMock = createSequencedFetchMock([
      [{ nb_visits: 5, nb_actions: '10' }],
      [{ nb_pageviews: '15', nb_uniq_pageviews: '12' }],
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 13 });
    const result = await client.getKeyNumbers();

    expect(result.nb_visits).toBe(5);
    expect(result.nb_actions).toBe(10);
    expect(result.nb_pageviews).toBe(15);
    expect(result.nb_uniq_pageviews).toBe(12);
  });

  it('falls back to nb_visits_series totals when aggregate visits are NaN', async () => {
    const fetchMock = createSequencedFetchMock([
      {
        nb_visits: 'NaN',
        nb_visits_series: {
          '2024-01-01': '12',
          '2024-01-02': 8,
        },
        nb_actions: 'NaN',
      },
      { nb_pageviews: 'NaN', nb_uniq_pageviews: 'NaN' },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.getKeyNumbers({ period: 'week', date: 'last2' });

    expect(result.nb_visits).toBe(20);
  });

  it('normalizes non-finite visit totals for longer ranges and parses pageview strings', async () => {
    const fetchMock = createSequencedFetchMock([
      {
        nb_visits: 'NaN',
        nb_actions: '12',
        nb_uniq_visitors: '0',
      },
      { nb_pageviews: '450', nb_uniq_pageviews: '325' },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 6 });
    const result = await client.getKeyNumbers({ period: 'week', date: 'last4' });

    expect(result.nb_visits).toBe(0);
    expect(result.nb_pageviews).toBe(450);
    expect(result.nb_uniq_pageviews).toBe(325);
    expect(result.nb_actions).toBe(12);

    const firstRequest = new URL(fetchMock.mock.calls[0][0] as string);
    expect(firstRequest.searchParams.get('period')).toBe('week');
    expect(firstRequest.searchParams.get('date')).toBe('last4');
  });

  it('returns key number series sorted by date', async () => {
    const seriesData = {
      '2024-01-02': { nb_visits: 2, nb_pageviews: 5 },
      '2024-01-01': { nb_visits: 1, nb_pageviews: 3 },
    };

    const fetchMock = createFetchMock(seriesData);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const result = await client.getKeyNumbersSeries({ date: 'last2' });

    expect(result).toEqual([
      { date: '2024-01-01', nb_visits: 1, nb_pageviews: 3 },
      { date: '2024-01-02', nb_visits: 2, nb_pageviews: 5 },
    ]);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('VisitsSummary.get');
    expect(url.searchParams.get('date')).toBe('last2');
  });

  it('coerces scalar series entries into key number objects', async () => {
    const seriesData = {
      '2025-08-01': 0,
      '2025-08-02': '3',
    };

    const fetchMock = createFetchMock(seriesData);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 12 });
    const result = await client.getKeyNumbersSeries({ date: '2025-08-01,2025-08-02', period: 'day' });

    expect(result).toEqual([
      { date: '2025-08-01', nb_visits: 0 },
      { date: '2025-08-02', nb_visits: 3 },
    ]);
  });

  it('unwraps array entries returned in key number series', async () => {
    const seriesData = {
      '2025-08-01': [{ nb_visits: '4', nb_pageviews: '6' }],
      '2025-08-02': [[{ nb_visits: 2 }]],
    } as Record<string, unknown>;

    const fetchMock = createFetchMock(seriesData);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 14 });
    const result = await client.getKeyNumbersSeries({ date: '2025-08-01,2025-08-02', period: 'day' });

    expect(result).toEqual([
      { date: '2025-08-01', nb_visits: 4, nb_pageviews: 6 },
      { date: '2025-08-02', nb_visits: 2 },
    ]);
  });

  it('runs diagnostics and reports successful checks', async () => {
    const fetchMock = createSequencedFetchMock([
      '5.0.0',
      { login: 'superuser' },
      { idsite: '1', name: 'Demo Site' },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
    const result = await client.runDiagnostics();

    expect(result.checks).toEqual([
      {
        id: 'base-url',
        label: 'Matomo base URL reachability',
        status: 'ok',
        details: { version: '5.0.0' },
      },
      {
        id: 'token-auth',
        label: 'Token authentication',
        status: 'ok',
        details: { login: 'superuser' },
      },
      {
        id: 'site-access',
        label: 'Site access permissions',
        status: 'ok',
        details: { idsite: '1', name: 'Demo Site' },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('method')).toBe('API.getMatomoVersion');
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('method')).toBe(
      'UsersManager.getUserByTokenAuth'
    );
    expect(new URL(fetchMock.mock.calls[2][0] as string).searchParams.get('method')).toBe('SitesManager.getSiteFromId');
  });

  it('reports token failures and skips site diagnostics', async () => {
    const fetchMock = createSequencedFetchMock([
      '5.0.0',
      { result: 'error', message: 'Invalid token' },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const result = await client.runDiagnostics();

    expect(result.checks[0]).toMatchObject({
      id: 'base-url',
      status: 'ok',
      details: { version: '5.0.0' },
    });
    expect(result.checks[1]).toMatchObject({
      id: 'token-auth',
      status: 'error',
      error: {
        type: 'matomo',
        message: expect.stringContaining('Matomo authentication failed'),
        guidance: expect.stringContaining('token'),
      },
    });
    expect(result.checks[2]).toMatchObject({
      id: 'site-access',
      status: 'skipped',
      skippedReason: 'Authentication failed, unable to verify site permissions.',
    });
  });

  it('falls back to the legacy version probe when Matomo lacks getMatomoVersion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createMethodMissingResponse('getMatomoVersion'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => '4.15.0',
        text: async () => JSON.stringify('4.15.0'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ login: 'viewer' }),
        text: async () => JSON.stringify({ login: 'viewer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ idsite: '2', name: 'Legacy Site' }),
        text: async () => JSON.stringify({ idsite: '2', name: 'Legacy Site' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.runDiagnostics();

    expect(result.checks[0]).toMatchObject({
      id: 'base-url',
      status: 'ok',
      details: { version: '4.15.0' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('method')).toBe('API.getMatomoVersion');
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('method')).toBe('API.getVersion');
    expect(new URL(fetchMock.mock.calls[2][0] as string).searchParams.get('method')).toBe(
      'UsersManager.getUserByTokenAuth'
    );
  });

  it('falls back to API.getLoggedInUser when getUserByTokenAuth is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => '5.0.0',
        text: async () => JSON.stringify('5.0.0'),
      })
      .mockResolvedValueOnce(createMethodMissingResponse('getUserByTokenAuth'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ login: 'legacy-user' }),
        text: async () => JSON.stringify({ login: 'legacy-user' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ idsite: '2', name: 'Legacy Site' }),
        text: async () => JSON.stringify({ idsite: '2', name: 'Legacy Site' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.runDiagnostics();

    expect(result.checks[1]).toMatchObject({
      id: 'token-auth',
      status: 'ok',
      details: { login: 'legacy-user' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('method')).toBe(
      'UsersManager.getUserByTokenAuth'
    );
    expect(new URL(fetchMock.mock.calls[2][0] as string).searchParams.get('method')).toBe('API.getLoggedInUser');
  });

  it('falls back to API.getLoggedInUser when UsersManager requires elevated permissions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse('5.0.0'))
      .mockResolvedValueOnce(createPermissionErrorResponse('UsersManager.getUserByTokenAuth'))
      .mockResolvedValueOnce(createJsonResponse({ login: 'viewer-token' }))
      .mockResolvedValueOnce(createJsonResponse({ idsite: '2', name: 'Viewer Site' }));

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.runDiagnostics();

    expect(result.checks[1]).toMatchObject({
      id: 'token-auth',
      status: 'ok',
      details: { login: 'viewer-token' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('method')).toBe(
      'UsersManager.getUserByTokenAuth'
    );
    expect(new URL(fetchMock.mock.calls[2][0] as string).searchParams.get('method')).toBe('API.getLoggedInUser');
  });

  it('flags base URL errors and stops further checks', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 9 });
    const result = await client.runDiagnostics();

    expect(result.checks[0]).toMatchObject({
      id: 'base-url',
      status: 'error',
      error: {
        type: 'network',
        message: 'Failed to reach Matomo instance.',
      },
    });
    expect(result.checks[1]).toMatchObject({
      id: 'token-auth',
      status: 'skipped',
      skippedReason: 'Matomo base URL could not be reached.',
    });
    expect(result.checks[2]).toMatchObject({
      id: 'site-access',
      status: 'skipped',
      skippedReason: 'Matomo base URL could not be reached.',
    });
  });

  it('caches repeated reporting calls within TTL', async () => {
    const responses = [[{ label: '/home' }], [{ label: '/other' }]];
    const fetchMock = createSequencedFetchMock(responses);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4, cacheTtlMs: 60_000 });
    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });
    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes through overrides for reporting helpers', async () => {
    const fetchMock = createFetchMock([{ label: 'Home', nb_visits: 100 }]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 7 });
    const result = await client.getMostPopularUrls({ siteId: 9, period: 'week', date: '2024-01-01', limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Home');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Actions.getPageUrls');
    expect(url.searchParams.get('idSite')).toBe('9');
    expect(url.searchParams.get('period')).toBe('week');
    expect(url.searchParams.get('date')).toBe('2024-01-01');
    expect(url.searchParams.get('filter_limit')).toBe('20');
    expect(url.searchParams.get('flat')).toBe('1');
  });

  it('coerces numeric fields when Matomo returns strings', async () => {
    const fetchMock = createFetchMock([{ label: 'Search', nb_visits: '12' }]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const result = await client.getTopReferrers({ period: 'month', date: '2024-01-01' });

    expect(result[0].nb_visits).toBe(12);
  });

  it('retrieves events with optional filters', async () => {
    const fetchMock = createFetchMock([{ label: 'CTA > click', nb_events: '5' }]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.getEvents({
      period: 'week',
      date: '2024-02-01',
      limit: 25,
      segment: 'country==SE',
      category: 'CTA',
      action: 'click',
      name: 'Download',
    });

    expect(result[0].nb_events).toBe(5);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Events.getAction');
    expect(url.searchParams.get('idSite')).toBe('2');
    expect(url.searchParams.get('period')).toBe('week');
    expect(url.searchParams.get('date')).toBe('2024-02-01');
    expect(url.searchParams.get('segment')).toBe('country==SE');
    expect(url.searchParams.get('filter_limit')).toBe('25');
    expect(url.searchParams.get('eventCategory')).toBe('CTA');
    expect(url.searchParams.get('eventAction')).toBe('click');
    expect(url.searchParams.get('eventName')).toBe('Download');
    expect(url.searchParams.get('flat')).toBe('1');
  });

  it('returns entry pages with defaults when omitted', async () => {
    const fetchMock = createFetchMock([{ label: '/home', nb_visits: '42', bounce_rate: '10%' }]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    const result = await client.getEntryPages();

    expect(result[0].nb_visits).toBe(42);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Actions.getEntryPageUrls');
    expect(url.searchParams.get('idSite')).toBe('4');
    expect(url.searchParams.get('period')).toBe('day');
    expect(url.searchParams.get('date')).toBe('today');
    expect(url.searchParams.get('filter_limit')).toBe('10');
    expect(url.searchParams.get('flat')).toBe('1');
  });

  it('fetches campaigns with overrides and numeric coercion', async () => {
    const fetchMock = createFetchMock([{ label: 'Spring Campaign', nb_visits: '12' }]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 9 });
    const result = await client.getCampaigns({ siteId: 11, period: 'month', date: '2025-01-01', limit: 25 });

    expect(result[0].nb_visits).toBe(12);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Referrers.getCampaigns');
    expect(url.searchParams.get('idSite')).toBe('11');
    expect(url.searchParams.get('period')).toBe('month');
    expect(url.searchParams.get('date')).toBe('2025-01-01');
    expect(url.searchParams.get('filter_limit')).toBe('25');
  });

  it('tracks cache stats and emits events', async () => {
    const fetchMock = createFetchMock([{ label: 'Home', nb_visits: '42' }]);
    vi.stubGlobal('fetch', fetchMock);

    const events: Array<{ type: string }> = [];

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 5,
      cache: {
        ttlMs: 60_000,
        onEvent: event => events.push(event),
      },
    });

    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });
    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });

    const stats = client.getCacheStats();
    expect(stats.total.misses).toBe(1);
    expect(stats.total.hits).toBe(1);
    expect(stats.total.sets).toBe(1);

    const popularStats = stats.features.find(feature => feature.feature === 'popularUrls');
    expect(popularStats?.hits).toBe(1);
    expect(popularStats?.misses).toBe(1);

    expect(events.some(event => event.type === 'set')).toBe(true);
    expect(events.some(event => event.type === 'hit')).toBe(true);
  });

  it('records stale evictions when cache entries expire', async () => {
    const fetchMock = createSequencedFetchMock([
      [{ label: 'Home', nb_visits: '10' }],
      [{ label: 'Home', nb_visits: '12' }],
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 6,
      cache: {
        ttlMs: 1,
      },
    });

    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });
    await new Promise(resolve => setTimeout(resolve, 5));
    await client.getMostPopularUrls({ period: 'day', date: 'today', limit: 5 });

    const stats = client.getCacheStats();
    expect(stats.total.staleEvictions).toBeGreaterThanOrEqual(1);
    expect(stats.total.sets).toBe(2);
  });

  it('returns ecommerce revenue totals with series when requested', async () => {
    const payload = {
      '2025-09-25': { nb_conversions: '2', revenue: '100', items: '5' },
      '2025-09-26': { nb_conversions: '1', revenue: '50', items: '2' },
    };
    const fetchMock = createFetchMock(payload);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 6 });
    const result = await client.getEcommerceRevenueTotals({
      period: 'day',
      date: 'last2',
      includeSeries: true,
    });

    expect(result.totals.revenue).toBe(150);
    expect(result.totals.nb_conversions).toBe(3);
    expect(result.totals.items).toBe(7);
    expect(result.series).toHaveLength(2);
    expect(result.series?.[0].label).toBe('2025-09-25');
    expect(result.series?.[0].revenue).toBe(100);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Goals.get');
    expect(url.searchParams.get('idGoal')).toBe('ecommerceOrder');
    expect(url.searchParams.get('idSite')).toBe('6');
    expect(url.searchParams.get('period')).toBe('day');
    expect(url.searchParams.get('date')).toBe('last2');
  });

  it('omits series when not requested and single summary', async () => {
    const payload = { nb_conversions: '2', revenue: '80' };
    const fetchMock = createFetchMock(payload);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    const result = await client.getEcommerceRevenueTotals();

    expect(result.totals.revenue).toBe(80);
    expect(result.series).toBeUndefined();
  });

  it('extracts ecommerce overview from nested responses', async () => {
    const fetchMock = createFetchMock({
      '2025-09-25': {
        'idgoal=ecommerceOrder': {
          nb_conversions: '3',
          revenue: '120.5',
          avg_order_revenue: '40.1666',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 6 });
    const result = await client.getEcommerceOverview({ date: '2025-09-25' });

    expect(result.nb_conversions).toBe(3);
    expect(result.revenue).toBeCloseTo(120.5);
    expect(result.avg_order_revenue).toBeCloseTo(40.1666);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Goals.get');
    expect(url.searchParams.get('idGoal')).toBe('ecommerceOrder');
    expect(url.searchParams.get('date')).toBe('2025-09-25');
    expect(url.searchParams.get('idSite')).toBe('6');
  });

  it('returns event categories with limit handling', async () => {
    const fetchMock = createFetchMock([
      { label: 'CTA', nb_events: '5' },
      { label: 'Navigation', nb_events: '2' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const result = await client.getEventCategories({ limit: 20, segment: 'country==SE' });

    expect(result[0].nb_events).toBe(5);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Events.getCategory');
    expect(url.searchParams.get('filter_limit')).toBe('20');
    expect(url.searchParams.get('segment')).toBe('country==SE');
    expect(url.searchParams.get('flat')).toBe('1');
  });

  it('lists device types with numeric coercion and overrides', async () => {
    const fetchMock = createFetchMock([
      { label: 'Desktop', nb_visits: '40' },
      { label: 'Mobile', nb_visits: '25' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 2 });
    const result = await client.getDeviceTypes({ siteId: 9, period: 'week', date: '2025-09-01', limit: 5 });

    expect(result[0].nb_visits).toBe(40);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('DevicesDetection.getType');
    expect(url.searchParams.get('idSite')).toBe('9');
    expect(url.searchParams.get('period')).toBe('week');
    expect(url.searchParams.get('date')).toBe('2025-09-01');
    expect(url.searchParams.get('filter_limit')).toBe('5');
  });

  it('retrieves traffic channels and supports alias filtering', async () => {
    const fetchMock = createFetchMock([
      { label: 'Direct Entry', nb_visits: '120' },
      { label: 'Search Engines', nb_visits: '80' },
      { label: 'Websites', nb_visits: '25' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });

    const channels = await client.getTrafficChannels({ period: 'week', date: '2025-09-01' });
    expect(channels).toHaveLength(3);
    expect(channels[0].nb_visits).toBe(120);

    const filtered = await client.getTrafficChannels({ channelType: 'search', period: 'week', date: '2025-09-01' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe('Search Engines');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Referrers.getReferrerType');
    expect(url.searchParams.get('filter_limit')).toBe('10');
  });

  it('fetches goal conversions with filters and normalization', async () => {
    const fetchMock = createFetchMock([
      { idgoal: 'ecommerceOrder', goal: 'Orders', type: 'ecommerce', nb_conversions: '12' },
      { idgoal: 2, name: 'Newsletter Signup', type: 'manually', nb_conversions: '8' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });

    const allGoals = await client.getGoalConversions({ period: 'month', date: '2025-01-01', limit: 5 });
    expect(allGoals).toHaveLength(2);
    expect(allGoals[0]).toMatchObject({ id: 'ecommerceOrder', type: 'ecommerce', nb_conversions: 12 });

    const ecommerceOnly = await client.getGoalConversions({ goalType: 'ecommerce', period: 'month', date: '2025-01-01' });
    expect(ecommerceOnly).toHaveLength(1);
    expect(ecommerceOnly[0].label).toBe('Orders');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Goals.get');
    expect(url.searchParams.get('filter_limit')).toBe('5');
  });

  it('handles goal conversions returned as an object map', async () => {
    const fetchMock = createFetchMock({
      donation: { idgoal: '1', goal: 'Donation', nb_conversions: '4', type: 'manually' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    const results = await client.getGoalConversions({ period: 'day', date: 'today', goalId: '1' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: '1', label: 'Donation', nb_conversions: 4 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Goals.get');
    expect(url.searchParams.get('idGoal')).toBe('1');
  });

  it('handles goal conversion summaries returned as a single object', async () => {
    const fetchMock = createFetchMock({
      nb_conversions: '7',
      nb_visits_converted: '3',
      revenue: '0',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 6 });
    const results = await client.getGoalConversions({ period: 'day', date: 'today', goalId: 2 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: '2', nb_conversions: 7 });
  });

  it('filters goal conversions by label when goalId is non-numeric', async () => {
    const fetchMock = createFetchMock([
      { idgoal: 1, goal: 'Donation g n f', nb_conversions: '2', nb_visits_converted: '1', revenue: '0' },
      { idgoal: 2, goal: 'Newsletter Signup', nb_conversions: '5', nb_visits_converted: '4', revenue: '0' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 12 });
    const results = await client.getGoalConversions({ period: 'day', date: 'last7', goalId: 'Donation g n f' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: '1', label: 'Donation g n f', nb_conversions: 2 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.has('idGoal')).toBe(false);
  });

  it('passes Matomo special goal identifiers through unchanged', async () => {
    const fetchMock = createFetchMock([
      { idgoal: 'ecommerceOrder', goal: 'Orders', nb_conversions: '9', revenue: '120.50', type: 'ecommerce' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const results = await client.getGoalConversions({ period: 'week', date: 'last7', goalId: 'ecommerceOrder' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'ecommerceOrder', nb_conversions: 9, revenue: 120.5, type: 'ecommerce' });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('idGoal')).toBe('ecommerceOrder');
  });

  it('aggregates goal conversions across nested date buckets', async () => {
    const fetchMock = createFetchMock({
      '2025-10-01': [
        { idgoal: 1, goal: 'Donation g n f', nb_conversions: '1', nb_visits_converted: '1', revenue: '0' },
      ],
      '2025-10-02': {
        goals: [
          { idgoal: '1', name: 'Donation g n f', nb_conversions: '1', nb_visits_converted: '0', revenue: '0' },
          { reportMetadata: { something: 'else' } },
        ],
      },
      reportMetadata: {
        idSites: ['12'],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 12 });
    const results = await client.getGoalConversions({ period: 'day', date: 'last7', goalId: '1' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '1',
      label: 'Donation g n f',
      nb_conversions: 2,
      nb_visits_converted: 1,
      revenue: 0,
    });
  });

  it('fetches funnel summary and normalizes step metrics', async () => {
    const fetchMock = createFetchMock({
      label: 'Checkout Funnel',
      overall_conversion_rate: '32.5%',
      nb_conversions_total: '48',
      nb_visits_total: '120',
      steps: [
        { idstep: 1, label: 'Cart', nb_visits_total: '120', nb_conversions: '80', step_conversion_rate: '66.7%' },
        { label: 'Payment', nb_visits_total: '80', nb_conversions_total: '48', overall_conversion_rate: '40%' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 5 });
    const result = await client.getFunnelSummary({ funnelId: 'checkout' });

    expect(result.id).toBe('checkout');
    expect(result.label).toBe('Checkout Funnel');
    expect(result.overallConversionRate).toBe(32.5);
    expect(result.totalConversions).toBe(48);
    expect(result.totalVisits).toBe(120);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ id: '1', conversions: 80, conversionRate: 66.7 });
    expect(result.steps[1]).toMatchObject({ id: '2', overallConversionRate: 40 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('method')).toBe('Funnels.getFunnel');
    expect(url.searchParams.get('idFunnel')).toBe('checkout');
    expect(url.searchParams.get('idSite')).toBe('5');
    expect(url.searchParams.get('period')).toBe('day');
    expect(url.searchParams.get('date')).toBe('today');
  });

  it('uses funnel definition steps when Matomo omits flow step metrics', async () => {
    const fetchMock = createSequencedFetchMock([
      {
        idFunnel: 7,
        label: 'Signup Flow',
        definition: {
          steps: {
            1: { name: 'Landing Page' },
            2: { pattern: '/signup', step_position: 2 },
          },
        },
      },
      { nb_conversions_total: '5', nb_visits_total: '20' },
      [],
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    const result = await client.getFunnelSummary({ funnelId: 'signup' });

    expect(result.label).toBe('Signup Flow');
    expect(result.totalConversions).toBe(5);
    expect(result.totalVisits).toBe(20);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ id: '1', label: 'Landing Page' });
    expect(result.steps[1]).toMatchObject({ id: '2', label: '/signup' });
  });

  it('tracks pageviews using the default siteId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 8 });
    const result = await client.trackPageview({ url: 'https://example.com/' });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = (init?.body as URLSearchParams).toString();
    expect(body).toContain('idsite=8');
  });

  it('allows overriding siteId on tracking calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    await client.trackEvent({ siteId: 11, category: 'cta', action: 'click' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = (init?.body as URLSearchParams).toString();
    expect(body).toContain('idsite=11');
    expect(body).toContain('e_c=cta');
  });

  describe('getHealthStatus', () => {
    it('returns healthy status when all checks pass', async () => {
      const fetchMock = createSequencedFetchMock(['3.14.0']);
      vi.stubGlobal('fetch', fetchMock);

      const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
      const result = await client.getHealthStatus();

      expect(result.status).toBe('healthy');
      expect(result.timestamp).toBeDefined();
      expect(result.checks).toHaveLength(3); // matomo-api, reports-cache, tracking-queue
      
      const matomoCheck = result.checks.find(c => c.name === 'matomo-api');
      expect(matomoCheck?.status).toBe('pass');
      expect(matomoCheck?.componentType).toBe('service');
      expect(matomoCheck?.observedUnit).toBe('ms');
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('method')).toBe('API.getMatomoVersion');

      const queueCheck = result.checks.find(c => c.name === 'tracking-queue');
      expect(queueCheck?.status).toBe('pass');
      expect(queueCheck?.observedValue).toBe(0);
      expect(queueCheck?.details).toEqual(
        expect.objectContaining({ pending: 0, inflight: 0, backlogAgeMs: 0 })
      );
    });

    it('returns unhealthy status when API fails', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
      const result = await client.getHealthStatus();

      expect(result.status).toBe('unhealthy');
      
      const matomoCheck = result.checks.find(c => c.name === 'matomo-api');
      expect(matomoCheck?.status).toBe('fail');
      expect(matomoCheck?.output).toContain('Failed to reach Matomo instance');
    });

    it('falls back to API.getVersion when getMatomoVersion is unavailable', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createMethodMissingResponse('getMatomoVersion'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          json: async () => '4.15.0',
          text: async () => JSON.stringify('4.15.0'),
        });

      vi.stubGlobal('fetch', fetchMock);

      const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
      const result = await client.getHealthStatus();

      expect(result.status).toBe('healthy');
      const matomoCheck = result.checks.find(c => c.name === 'matomo-api');
      expect(matomoCheck?.status).toBe('pass');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('method')).toBe('API.getMatomoVersion');
      expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('method')).toBe('API.getVersion');
    });

    it('marks tracking queue as warn when backlog crosses warn thresholds', async () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2024-03-01T12:00:00.000Z');
        vi.setSystemTime(now);

        const fetchMock = createSequencedFetchMock(['3.14.0']);
        vi.stubGlobal('fetch', fetchMock);

        const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
        const tracking = (client as unknown as { tracking: TrackingService }).tracking;
        const warnStats: TrackingQueueStats = {
          pending: 9,
          inflight: 2,
          totalProcessed: 15,
          totalRetried: 4,
          lastError: { message: 'rate limited', status: 429, timestamp: Date.now() - 30_000 },
          lastRetryAt: Date.now() - 30_000,
          lastBackoffMs: 2000,
          cooldownUntil: Date.now() + 15_000,
          lastRetryStatus: 429,
          oldestPendingAt: Date.now() - 70_000,
        };
        vi.spyOn(tracking, 'getQueueStats').mockReturnValue(warnStats);

        const result = await client.getHealthStatus();
        const queueCheck = result.checks.find(c => c.name === 'tracking-queue');

        expect(queueCheck?.status).toBe('warn');
        expect(queueCheck?.observedValue).toBe(11);
        expect(queueCheck?.output).toContain('backlogAgeMs=70000');
        expect(queueCheck?.details).toEqual(
          expect.objectContaining({
            pending: 9,
            inflight: 2,
            backlogAgeMs: 70000,
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks tracking queue as fail when backlog age exceeds fail threshold', async () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2024-03-01T12:00:00.000Z');
        vi.setSystemTime(now);

        const fetchMock = createSequencedFetchMock(['3.14.0']);
        vi.stubGlobal('fetch', fetchMock);

        const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
        const tracking = (client as unknown as { tracking: TrackingService }).tracking;
        const failStats: TrackingQueueStats = {
          pending: 2,
          inflight: 0,
          totalProcessed: 5,
          totalRetried: 3,
          lastError: { message: 'Matomo unavailable', status: 503, timestamp: Date.now() - 200_000 },
          lastRetryAt: Date.now() - 200_000,
          lastBackoffMs: 4000,
          cooldownUntil: undefined,
          lastRetryStatus: 503,
          oldestPendingAt: Date.now() - 200_000,
        };
        vi.spyOn(tracking, 'getQueueStats').mockReturnValue(failStats);

        const result = await client.getHealthStatus();
        const queueCheck = result.checks.find(c => c.name === 'tracking-queue');

        expect(queueCheck?.status).toBe('fail');
        expect(queueCheck?.observedValue).toBe(2);
        expect(queueCheck?.output).toContain('backlogAgeMs=200000');
        expect(queueCheck?.details).toEqual(
          expect.objectContaining({
            pending: 2,
            backlogAgeMs: 200000,
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('includes site access check when requested', async () => {
      const fetchMock = createSequencedFetchMock([
        '3.14.0', // API.getMatomoVersion
        { idsite: '5', name: 'Test Site' } // SitesManager.getSiteFromId
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 5 });
      const result = await client.getHealthStatus({ includeDetails: true });

      expect(result.checks).toHaveLength(4); // includes site-access check
      
      const siteCheck = result.checks.find(c => c.name === 'site-access');
      expect(siteCheck?.status).toBe('pass');
      expect(siteCheck?.output).toContain('Site ID 5 accessible');
    });
  });
});
