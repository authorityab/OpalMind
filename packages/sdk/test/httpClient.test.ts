import { afterEach, describe, expect, it, vi } from 'vitest';

import { MatomoHttpClient } from '../src/httpClient.js';
import {
  MatomoAuthError,
  MatomoClientError,
  MatomoNetworkError,
  MatomoParseError,
  MatomoRateLimitError,
} from '../src/errors.js';

const createFetchMock = <T>(data: T, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
  });

describe('MatomoHttpClient', () => {
  const baseUrl = 'https://matomo.example.com/index.php';
  const token = 'secret-token';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('throws a client error when Matomo responds with a 4xx payload', async () => {
    const fetchMock = createFetchMock({ result: 'error', message: 'Oops' }, false, 400);
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoClientError);
  });

  it('redacts token_auth values from error endpoints', async () => {
    const fetchMock = createFetchMock({ result: 'error', message: 'Oops' }, false, 400);
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    let caught: unknown;
    try {
      await client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MatomoClientError);
    const matomoError = caught as MatomoClientError;
    expect(matomoError.endpoint).toContain('token_auth=REDACTED');
    expect(matomoError.endpoint).not.toContain(token);

    const serialized = JSON.parse(JSON.stringify(matomoError));
    expect(serialized.endpoint).toContain('token_auth=REDACTED');
    expect(serialized.endpoint).not.toContain(token);
  });

  it('throws an auth error when Matomo rejects the token', async () => {
    const fetchMock = createFetchMock({ result: 'error', message: 'Invalid token' }, true, 200);
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoAuthError);
  });

  it('throws a parse error when Matomo returns invalid JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>oops</html>',
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoParseError);
  });

  it('throws a network error when fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token);

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoNetworkError);
  });

  it('throttles subsequent requests when rate limit headers indicate depletion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const firstHeaders = new Headers({
      'X-Matomo-Rate-Limit-Remaining': '0',
      'X-Matomo-Rate-Limit-Reset': String(Math.floor((Date.now() + 5000) / 1000)),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ visits: 10 }),
        headers: firstHeaders,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ visits: 12 }),
        headers: new Headers(),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token, { rateLimit: { minThrottleMs: 0 } });

    await client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } });

    const secondRequest = client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } });

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await secondRequest;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invokes rate limit callback and surfaces details on 429 responses', async () => {
    const onLimit = vi.fn();
    const headers = new Headers({
      'Retry-After': '3',
      'X-Matomo-Rate-Limit-Limit': '100',
      'X-Matomo-Rate-Limit-Remaining': '0',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => JSON.stringify({ result: 'error', message: 'Rate limit exceeded' }),
      headers,
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token, {
      rateLimit: { onLimit },
    });

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoRateLimitError);

    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit.mock.calls[0][0]).toMatchObject({
      source: 'http-status',
      status: 429,
      remaining: 0,
      limit: 100,
    });

    const event = client.getLastRateLimitEvent();
    expect(event?.retryAfterMs).toBe(3000);
  });

  it('aborts and surfaces a network error when the request exceeds the timeout', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    let capturedSignal: AbortSignal | undefined;

    const fetchMock = vi.fn((_endpoint: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.reject(abortError);
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token, {
      timeoutMs: 1000,
      retry: { maxAttempts: 1, baseDelayMs: 0, jitterMs: 0 },
    });

    await expect(
      client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } })
    ).rejects.toBeInstanceOf(MatomoNetworkError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('retries transient network failures with exponential backoff', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ visits: 42 }),
        headers: new Headers(),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token, {
      timeoutMs: 2000,
      retry: { maxAttempts: 3, baseDelayMs: 500, jitterMs: 0 },
    });

    const promise = client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } });

    await vi.advanceTimersByTimeAsync(500);

    const response = await promise;
    expect(response).toEqual({
      data: { visits: 42 },
      status: 200,
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    randomSpy.mockRestore();
  });

  it('retries 503 responses before failing or succeeding', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'unavailable',
      headers: new Headers(),
    };

    const secondResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ visits: 15 }),
      headers: new Headers(),
    };

    const fetchMock = vi.fn().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);

    vi.stubGlobal('fetch', fetchMock);

    const client = new MatomoHttpClient(baseUrl, token, {
      timeoutMs: 2000,
      retry: { maxAttempts: 2, baseDelayMs: 300, jitterMs: 0 },
    });

    const promise = client.get({ method: 'VisitsSummary.get', params: { idSite: 1 } });

    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;
    expect(result).toEqual({
      data: { visits: 15 },
      status: 200,
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    randomSpy.mockRestore();
  });
});
