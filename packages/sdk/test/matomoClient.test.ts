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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MatomoClient', () => {
  it('throws when siteId is missing', async () => {
    const client = createMatomoClient({ baseUrl, tokenAuth: token });
    await expect(client.getKeyNumbers()).rejects.toThrow('siteId is required');
  });

  it('resolves default site ID when provided', async () => {
    const fetchMock = createFetchMock({ nb_visits: 42 });
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 5 });
    const result = await client.getKeyNumbers();

    expect(result.nb_visits).toEqual(42);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('idSite')).toBe('5');
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
