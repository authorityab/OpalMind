import { URL } from 'node:url';

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

    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Matomo request failed: ${res.status} ${res.statusText} ${body}`.trim());
    }

    const data = (await res.json()) as T;

    return {
      data,
      status: res.status,
      ok: res.ok,
    };
  }
}

export async function matomoGet<T>(client: MatomoHttpClient, options: MatomoRequestOptions) {
  const response = await client.get<T>(options);
  return response.data;
}
