import { URL } from 'node:url';

import {
  MatomoNetworkError,
  MatomoParseError,
  classifyMatomoError,
  classifyMatomoResultError,
  extractMatomoError,
} from './errors.js';

export interface MatomoRequestOptions {
  method: string;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface MatomoResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('Matomo base URL is required');
  }

  const trimmed = baseUrl.trim();
  if (trimmed.endsWith('index.php')) {
    return trimmed;
  }

  return `${trimmed.replace(/\/?$/, '')}/index.php`;
}

export class MatomoHttpClient {
  private readonly baseEndpoint: string;
  private readonly token: string;

  constructor(baseUrl: string, tokenAuth: string) {
    this.baseEndpoint = normalizeBaseUrl(baseUrl);
    if (!tokenAuth) {
      throw new Error('Matomo token_auth is required');
    }

    this.token = tokenAuth;
  }

  async get<T>({ method, params = {} }: MatomoRequestOptions): Promise<MatomoResponse<T>> {
    if (!method) {
      throw new Error('Matomo API method is required');
    }

    const url = new URL(this.baseEndpoint);
    url.searchParams.set('module', 'API');
    url.searchParams.set('method', method);
    url.searchParams.set('token_auth', this.token);
    url.searchParams.set('format', 'JSON');

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const endpoint = url.toString();
    let res: Awaited<ReturnType<typeof fetch>>;

    try {
      res = await fetch(endpoint);
    } catch (error) {
      throw new MatomoNetworkError('Failed to reach Matomo instance.', {
        endpoint,
        cause: error,
      });
    }

    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch (error) {
      throw new MatomoNetworkError('Failed to read Matomo response.', {
        endpoint,
        cause: error,
        status: res.status,
      });
    }

    let payload: unknown = undefined;
    const trimmedBody = bodyText?.trim() ?? '';

    if (trimmedBody.length > 0) {
      try {
        payload = JSON.parse(trimmedBody);
      } catch (error) {
        if (res.ok) {
          throw new MatomoParseError('Failed to parse Matomo JSON response.', {
            endpoint,
            status: res.status,
            body: bodyText,
            cause: error,
          });
        }
      }
    }

    if (!res.ok) {
      throw classifyMatomoError({
        status: res.status,
        statusText: res.statusText,
        endpoint,
        bodyText,
        payload,
      });
    }

    if (payload && typeof payload === 'object') {
      const extracted = extractMatomoError(payload);
      if (extracted) {
        throw classifyMatomoResultError(endpoint, payload);
      }
    }

    return {
      data: payload as T,
      status: res.status,
      ok: res.ok,
    };
  }
}

export async function matomoGet<T>(client: MatomoHttpClient, options: MatomoRequestOptions) {
  const response = await client.get<T>(options);
  return response.data;
}
