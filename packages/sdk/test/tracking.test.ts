import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMatomoClient } from '../src/index.js';

const baseUrl = 'https://matomo.example.com/index.php';
const token = 'token';

const successResponse = {
  ok: true,
  status: 204,
  statusText: 'No Content',
  text: async () => '',
};

describe('TrackingService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tracks pageviews and returns pvId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 3 });
    const result = await client.trackPageview({ url: 'https://example.com/' });

    expect(result.ok).toBe(true);
    expect(result.pvId).toHaveLength(16);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = (init?.body as URLSearchParams).toString();

    expect(body).toContain('idsite=3');
    expect(body).toContain('url=https%3A%2F%2Fexample.com%2F');
    expect(body).toContain('action_name=https%3A%2F%2Fexample.com%2F');
    expect(body).toContain('pv_id=');
  });

  it('normalizes tracking URLs when baseUrl includes index.php', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 3,
      tracking: { baseUrl },
    });

    await client.trackEvent({ category: 'cta', action: 'click' });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://matomo.example.com/matomo.php');
  });

  it('retries failed requests before rejecting', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue(successResponse);

    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 2,
      tracking: { retryDelayMs: 10, backoff: { baseDelayMs: 10, jitterMs: 0 } },
    });

    const trackPromise = client.trackEvent({
      siteId: 2,
      category: 'cta',
      action: 'click',
    });

    await vi.advanceTimersByTimeAsync(20);
    const result = await trackPromise;

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tracks goals with revenue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 1 });
    await client.trackGoal({ goalId: 7, revenue: 19.95, url: 'https://example.com/thank-you' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = (init?.body as URLSearchParams).toString();

    expect(body).toContain('idgoal=7');
    expect(body).toContain('revenue=19.95');
    expect(body).toContain('url=https%3A%2F%2Fexample.com%2Fthank-you');
  });

  it('dedupes tracking requests that share an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({ baseUrl, tokenAuth: token, defaultSiteId: 4 });
    const idempotencyKey = 'event-dedupe-key';

    const [first, second] = await Promise.all([
      client.trackEvent({ category: 'cta', action: 'click', idempotencyKey }),
      client.trackEvent({ category: 'cta', action: 'click', idempotencyKey }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    const metadata = await client.getTrackingRequestMetadata(idempotencyKey);
    expect(metadata?.attempts).toBe(1);
    expect(metadata?.result.ok).toBe(true);

    const replay = await client.trackEvent({ category: 'cta', action: 'click', idempotencyKey });
    expect(replay).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects tracking base URLs that use unsupported schemes', () => {
    expect(() =>
      createMatomoClient({
        baseUrl,
        tokenAuth: token,
        tracking: { baseUrl: 'ftp://matomo.example.com/matomo.php' },
      })
    ).toThrow('Matomo tracking URL must use http or https');
  });

  it('honors Retry-After headers before retrying tracking requests', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const throttledResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate limited',
      headers: new Headers({ 'Retry-After': '2' }),
    };

    const success = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
      headers: new Headers(),
    };

    const fetchMock = vi.fn().mockResolvedValueOnce(throttledResponse).mockResolvedValueOnce(success);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 5,
      tracking: {
        backoff: { jitterMs: 0 },
      },
    });

    const promise = client.trackEvent({ category: 'cta', action: 'click' });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const stats = client.getTrackingQueueStats();
    expect(stats.lastBackoffMs).toBeGreaterThanOrEqual(2000);
    expect(stats.lastRetryStatus).toBe(429);

    randomSpy.mockRestore();
  });

  it('applies exponential backoff for repeated server errors', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const serverError = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'unavailable',
      headers: new Headers(),
    };

    const success = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
      headers: new Headers(),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(success);
    vi.stubGlobal('fetch', fetchMock);

    const client = createMatomoClient({
      baseUrl,
      tokenAuth: token,
      defaultSiteId: 6,
      tracking: {
        maxRetries: 4,
        backoff: { baseDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 },
      },
    });

    const promise = client.trackGoal({ goalId: 9 });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const stats = client.getTrackingQueueStats();
    expect(stats.totalRetried).toBeGreaterThanOrEqual(2);
    expect(stats.lastBackoffMs).toBeGreaterThanOrEqual(200);

    randomSpy.mockRestore();
  });
});
