import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMatomoClient } from '../src/index.js';

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

const createSequencedFetchMock = (responses: unknown[]) => {
  const mock = vi.fn();
  responses.forEach(response => {
    mock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
      text: async () => JSON.stringify(response),
    });
  });
  return mock;
};

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
});
