import { afterEach, describe, expect, it, vi } from 'vitest';

import { MatomoHttpClient } from '../src/httpClient.js';

const createFetchMock = <T>(data: T, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

describe('MatomoHttpClient', () => {
  const baseUrl = 'https://matomo.example.com/index.php';
  const token = 'secret-token';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes the base URL when missing index.php', async () => {
    const fetchMock = createFetchMock({ visits: 10 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient('https://matomo.example.com', token);
    await client.get({
      method: 'VisitsSummary.get',
      params: { idSite: 1 },
    });

    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.pathname.endsWith('/index.php')).toBe(true);
  });

  it('builds the correct query string for API requests', async () => {
    const fetchMock = createFetchMock({ visits: 10 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);
    await client.get({
      method: 'VisitsSummary.get',
      params: {
        idSite: 1,
        period: 'day',
        date: 'today',
        segment: 'browser==Chrome',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);

    expect(requestUrl.origin + requestUrl.pathname).toBe(baseUrl);
    expect(requestUrl.searchParams.get('module')).toBe('API');
    expect(requestUrl.searchParams.get('method')).toBe('VisitsSummary.get');
    expect(requestUrl.searchParams.get('token_auth')).toBe(token);
    expect(requestUrl.searchParams.get('format')).toBe('JSON');
    expect(requestUrl.searchParams.get('idSite')).toBe('1');
    expect(requestUrl.searchParams.get('period')).toBe('day');
    expect(requestUrl.searchParams.get('date')).toBe('today');
    expect(requestUrl.searchParams.get('segment')).toBe('browser==Chrome');
  });

  it('throws when Matomo responds with an error', async () => {
    const fetchMock = createFetchMock({ error: 'Oops' }, false, 400);
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toThrow(/Matomo request failed/);
  });
});
