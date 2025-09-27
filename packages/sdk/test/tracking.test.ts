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
      tracking: { retryDelayMs: 10 },
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
});
