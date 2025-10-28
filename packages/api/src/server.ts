import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { Parameter, ParameterType, ToolsService, Function as ToolFunction } from '@optimizely-opal/opal-tools-sdk';
import { logger as baseLogger, redactSecrets } from '@opalmind/logger';
import { createMatomoClient, type MatomoClientConfig } from '@opalmind/sdk';

import { ValidationError, parseToolInvocation } from './validation.js';

export const apiLogger = baseLogger.child({ package: '@opalmind/api' });
const toolsLogger = apiLogger.child({ component: 'tools-service' });

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    const charA = index < a.length ? a.charCodeAt(index) : 0;
    const charB = index < b.length ? b.charCodeAt(index) : 0;
    mismatch |= charA ^ charB;
  }

  return mismatch === 0;
}

function extractBearerToken(header: string | undefined): { scheme: string; token?: string } {
  if (!header) {
    return { scheme: '' };
  }

  const parts = header.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { scheme: '' };
  }

  const [rawScheme, ...rest] = parts as [string, ...string[]];
  const scheme = rawScheme ?? '';
  const token = rest.join(' ').trim();

  if (token.length > 0) {
    return { scheme, token };
  }

  return { scheme };
}

function formatAuthChallenge(details: { error?: string; description?: string }): string {
  const attributes = [`realm="MatomoTools"`];
  if (details.error) {
    attributes.push(`error="${details.error}"`);
  }
  if (details.description) {
    attributes.push(`error_description="${details.description}"`);
  }
  return `Bearer ${attributes.join(', ')}`;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isNaN(value) ? undefined : value;
  }

  const numeric = Number.parseInt(String(value), 10);
  return Number.isNaN(numeric) ? undefined : numeric;
}

function parseOptionalFloat(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const numeric = Number.parseFloat(String(value));
  return Number.isNaN(numeric) ? undefined : numeric;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function configureToolsServiceLogging(service: ToolsService) {
  const internal = service as unknown as { router: Router; functions: ToolFunction[] };
  const router = internal.router;
  const functions = internal.functions;

  const sanitizedRegisterTool: ToolsService['registerTool'] = function registerTool(
    name,
    description,
    handler,
    parameters,
    endpoint,
    authRequirements
  ) {
    const definition = new ToolFunction(name, description, parameters, endpoint, authRequirements);
    functions.push(definition);

    router.post(endpoint, async (req: Request, res: Response) => {
      const startTime = Date.now();
      let paramKeys: string[] = [];
      let authProvider: string | undefined;

      try {
        const { params, auth, usedFallback } = extractInvocationPayload(req.body, endpoint);
        paramKeys = summarizeParameters(params);
        authProvider = summarizeAuthProvider(auth);

        logToolInfo('request', {
          tool: name,
          endpoint,
          paramKeys,
          authProvider,
          fallbackUsed: usedFallback,
        });

        const handlerParamCount = handler.length;
        const result =
          handlerParamCount >= 2 ? await handler(params, auth) : await handler(params);

        res.json(result);

        logToolInfo('success', {
          tool: name,
          endpoint,
          durationMs: Date.now() - startTime,
          paramKeys,
        });
      } catch (error) {
        const status = determineErrorStatus(error);
        const sanitizedError = sanitizeErrorForLogs(error);

        logToolError('failure', {
          tool: name,
          endpoint,
          message: sanitizedError.message,
          status: sanitizedError.status,
          code: sanitizedError.code,
          paramKeys,
          authProvider,
        });

        res.status(status).json({ error: sanitizedError.message ?? 'Unknown error' });
      }
    });
  };

  (service as unknown as { registerTool: typeof sanitizedRegisterTool }).registerTool = sanitizedRegisterTool;
}

function extractInvocationPayload(
  body: unknown,
  endpoint: string
): { params: Record<string, unknown>; auth: unknown; usedFallback: boolean } {
  return parseToolInvocation(body, endpoint);
}

const SENSITIVE_PARAM_KEY = /(token|secret|password|auth)/i;

function summarizeParameters(params: unknown): string[] {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return Object.keys(params as Record<string, unknown>).map(key =>
      SENSITIVE_PARAM_KEY.test(key) ? '[redacted]' : key
    );
  }
  if (Array.isArray(params)) {
    return ['[array]'];
  }
  if (params === null || params === undefined) {
    return [];
  }
  return ['[primitive]'];
}

function summarizeAuthProvider(auth: unknown): string | undefined {
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const provider = (auth as Record<string, unknown>).provider;
    return typeof provider === 'string' ? provider : undefined;
  }
  return undefined;
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when provided.`);
  }

  return parsed;
}

function parseCorsAllowlist(): string[] {
  const raw = process.env.OPAL_CORS_ALLOWLIST;
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

function createCorsMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const allowlist = parseCorsAllowlist();
  const allowAll = process.env.OPAL_CORS_ALLOW_ALL === '1';
  const allowCredentials = allowAll || allowlist.length > 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    let allowedOrigin: string | undefined;

    if (allowAll && originHeader) {
      allowedOrigin = originHeader;
    } else if (originHeader && allowlist.includes(originHeader)) {
      allowedOrigin = originHeader;
    }

    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

type TrustProxySetting = boolean | number | string | string[];

function parseTrustProxySetting(value: string | undefined): TrustProxySetting {
  if (!value) {
    return ['loopback', 'linklocal', 'uniquelocal'];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ['loopback', 'linklocal', 'uniquelocal'];
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'false' || lowered === '0') {
    return false;
  }

  if (lowered === 'true') {
    return true;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return trimmed
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

function getClientIp(req: Request): string {
  if (Array.isArray(req.ips) && req.ips.length > 0) {
    const [firstIp] = req.ips;
    if (firstIp) {
      return firstIp;
    }
  }

  if (typeof req.ip === 'string' && req.ip.length > 0) {
    return req.ip;
  }

  const connection = req.socket || req.connection;
  if (connection && typeof connection.remoteAddress === 'string') {
    return connection.remoteAddress;
  }

  return 'unknown';
}

function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

function preventHttpParameterPollution(req: Request, _res: Response, next: NextFunction) {
  const query = req.query as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (Array.isArray(value)) {
      query[key] = value[value.length - 1];
    }
  }
  next();
}

function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  let lastCleanup = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();

    if (now - lastCleanup >= options.windowMs) {
      lastCleanup = now;
      for (const [bucketKey, entry] of buckets) {
        if (entry.expiresAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    const key = options.keyGenerator ? options.keyGenerator(req) : getClientIp(req);
    let bucket = buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      bucket = { count: 0, expiresAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    const limit = options.max;

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.max(0, Math.floor(bucket.expiresAt / 1000))));
      res.status(429).json({ error: options.message });
      return;
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.max(0, Math.floor(bucket.expiresAt / 1000))));

    next();
  };
}

function logToolInfo(event: 'request' | 'success', details: Record<string, unknown>) {
  toolsLogger.info('tools', { event, ...details });
}

function logToolError(event: 'failure', details: Record<string, unknown>) {
  toolsLogger.error('tools', { event, ...details });
}

function determineErrorStatus(error: unknown): number {
  const candidate =
    error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (candidate && Number.isFinite(candidate) && candidate >= 400 && candidate < 600) {
    return candidate;
  }
  return 500;
}

function sanitizeErrorForLogs(error: unknown): { message?: string; status?: number; code?: unknown } {
  if (error instanceof Error) {
    const status =
      typeof (error as { status?: unknown }).status === 'number' ? ((error as { status?: number }).status as number) : undefined;
    const code = (error as { code?: unknown }).code;
    const result: { message?: string; status?: number; code?: unknown } = {
      message: redactSecrets(error.message),
    };
    if (status !== undefined) {
      result.status = status;
    }
    if (code !== undefined) {
      result.code = code;
    }
    return result;
  }

  if (typeof error === 'string') {
    return { message: redactSecrets(error) };
  }

  return { message: 'Unknown error' };
}

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');

  const trustProxySetting = parseTrustProxySetting(process.env.OPAL_TRUST_PROXY);
  app.set('trust proxy', trustProxySetting);

  app.use(createCorsMiddleware());
  app.use(applySecurityHeaders);
  app.use(preventHttpParameterPollution);

  const requestBodyLimit = process.env.OPAL_REQUEST_BODY_LIMIT?.trim() || '256kb';
  app.use(
    express.json({
      limit: requestBodyLimit,
      type: ['application/json'],
    })
  );
  app.use(
    express.urlencoded({
      extended: false,
      limit: requestBodyLimit,
    })
  );

  const bearerToken = process.env.OPAL_BEARER_TOKEN?.trim();
  if (!bearerToken || bearerToken === 'change-me') {
    throw new Error('OPAL_BEARER_TOKEN must be set to a non-default value before starting the service.');
  }

  const matomoBaseUrl = process.env.MATOMO_BASE_URL?.trim();
  if (!matomoBaseUrl) {
    throw new Error('MATOMO_BASE_URL must be set before starting the service.');
  }

  const matomoToken = process.env.MATOMO_TOKEN?.trim();
  if (!matomoToken || matomoToken === 'set-me') {
    throw new Error('MATOMO_TOKEN must be set to a valid Matomo token before starting the service.');
  }

  const defaultSiteIdEnv = process.env.MATOMO_DEFAULT_SITE_ID?.trim();
  const defaultSiteId =
    defaultSiteIdEnv && defaultSiteIdEnv.length > 0 ? Number.parseInt(defaultSiteIdEnv, 10) : undefined;

  if (defaultSiteIdEnv && (Number.isNaN(defaultSiteId) || !Number.isFinite(defaultSiteId))) {
    throw new Error('MATOMO_DEFAULT_SITE_ID must be a valid integer when provided.');
  }

  const rateLimitWindowMs = parsePositiveIntegerEnv('OPAL_RATE_LIMIT_WINDOW_MS', 60_000);
  const rateLimitMax = parsePositiveIntegerEnv('OPAL_RATE_LIMIT_MAX', 60);

  const generalLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    message: 'Too many requests, please try again later.',
  });

  app.use('/tools', generalLimiter);

  const cacheWarnHitRate = parseOptionalFloat(process.env.MATOMO_CACHE_WARN_HIT_RATE);
  const cacheFailHitRate = parseOptionalFloat(process.env.MATOMO_CACHE_FAIL_HIT_RATE);
  const cacheSampleSize = parseOptionalNumber(process.env.MATOMO_CACHE_SAMPLE_SIZE);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requiresAuth = req.path.startsWith('/tools');
    if (!requiresAuth) {
      return next();
    }

    const header = req.headers.authorization;
    const { scheme, token } = extractBearerToken(header);

    if (!header || scheme.toLowerCase() !== 'bearer' || !token) {
      res.setHeader(
        'WWW-Authenticate',
        formatAuthChallenge({ error: 'invalid_request', description: 'Authorization header missing or malformed.' })
      );
      return res.status(401).json({ error: 'Authorization header missing or malformed.' });
    }

    if (!constantTimeEqual(bearerToken, token)) {
      res.setHeader(
        'WWW-Authenticate',
        formatAuthChallenge({ error: 'invalid_token', description: 'Bearer token is invalid.' })
      );
      return res.status(401).json({ error: 'Invalid bearer token.' });
    }

    return next();
  });

  const cacheHealthThresholds: Record<string, number> = {};
  if (cacheWarnHitRate !== undefined) cacheHealthThresholds.warnHitRate = cacheWarnHitRate;
  if (cacheFailHitRate !== undefined) cacheHealthThresholds.failHitRate = cacheFailHitRate;
  if (cacheSampleSize !== undefined) cacheHealthThresholds.sampleSize = cacheSampleSize;

  const clientConfig: MatomoClientConfig = {
    baseUrl: matomoBaseUrl,
    tokenAuth: matomoToken,
    ...(defaultSiteId !== undefined ? { defaultSiteId } : {}),
    ...(Object.keys(cacheHealthThresholds).length > 0
      ? { cacheHealth: cacheHealthThresholds }
      : {}),
  };

  const matomoClient = createMatomoClient(clientConfig);

  const toolsService = new ToolsService(app);
  configureToolsServiceLogging(toolsService);

  const siteIdParam = new Parameter('siteId', ParameterType.Integer, 'Override site ID (defaults to MATOMO_DEFAULT_SITE_ID)', false);
  const periodParam = new Parameter('period', ParameterType.String, 'Matomo period (day, week, month, year, range)', false);
  const dateParam = new Parameter('date', ParameterType.String, 'Date or range (YYYY-MM-DD, today, yesterday, last7, etc.)', false);
  const segmentParam = new Parameter('segment', ParameterType.String, 'Matomo segment expression', false);
  const limitParam = new Parameter('limit', ParameterType.Integer, 'Maximum number of records to return', false);
  const eventCategoryFilterParam = new Parameter('category', ParameterType.String, 'Filter by event category', false);
  const eventActionFilterParam = new Parameter('action', ParameterType.String, 'Filter by event action', false);
  const eventNameFilterParam = new Parameter('name', ParameterType.String, 'Filter by event name', false);
  const includeSeriesParam = new Parameter(
    'includeSeries',
    ParameterType.Boolean,
    'Include per-period breakdown for ecommerce revenue totals',
    false
  );
  const channelTypeParam = new Parameter(
    'channelType',
    ParameterType.String,
    'Filter traffic channels to a specific type (e.g., direct, search, social)',
    false
  );
  const goalFilterIdParam = new Parameter(
    'goalId',
    ParameterType.String,
    'Filter to a specific Matomo goal (numeric id or special goal name)',
    false
  );
  const goalTypeFilterParam = new Parameter(
    'goalType',
    ParameterType.String,
    'Filter goal conversions by Matomo goal type (ecommerce, manual, etc.)',
    false
  );
  const funnelIdParam = new Parameter('funnelId', ParameterType.String, 'Matomo funnel identifier', true);

  toolsService.registerTool(
    'GetKeyNumbers',
    'Returns Matomo key metrics for the selected period and date.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getKeyNumbers>[0] = {};
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (period !== undefined) {
        request.period = period;
      }
      if (date !== undefined) {
        request.date = date;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      return matomoClient.getKeyNumbers(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam],
    '/tools/get-key-numbers'
  );

  toolsService.registerTool(
    'DiagnoseMatomo',
    'Runs connectivity and permission checks against the configured Matomo instance.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const request: Parameters<typeof matomoClient.runDiagnostics>[0] = {};
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      return matomoClient.runDiagnostics(request);
    },
    [siteIdParam],
    '/tools/diagnose-matomo'
  );

  const includeDetailsParam = new Parameter('includeDetails', ParameterType.Boolean, 'Include detailed site access checks', false);

  toolsService.registerTool(
    'GetHealthStatus',
    'Returns comprehensive health status for Matomo API, cache, and dependencies.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const includeDetails = Boolean(parameters?.['includeDetails']);
      const request: Parameters<typeof matomoClient.getHealthStatus>[0] = { includeDetails };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      return matomoClient.getHealthStatus(request);
    },
    [siteIdParam, includeDetailsParam],
    '/tools/get-health-status'
  );

  toolsService.registerTool(
    'GetKeyNumbersHistorical',
    'Returns key metrics broken down per period for multi-day comparisons.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getKeyNumbersSeries>[0] = {
        period: period ?? 'day',
        date: date ?? 'last7',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      return matomoClient.getKeyNumbersSeries(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam],
    '/tools/get-key-numbers-historical'
  );

  toolsService.registerTool(
    'GetMostPopularUrls',
    'Retrieves the most visited pages for the selected period and date.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getMostPopularUrls>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getMostPopularUrls(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-most-popular-urls'
  );

  toolsService.registerTool(
    'GetTopReferrers',
    'Lists the top referrers driving traffic for the selected period.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getTopReferrers>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getTopReferrers(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-top-referrers'
  );

  toolsService.registerTool(
    'GetEntryPages',
    'Returns the most common entry pages for the selected time range.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getEntryPages>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getEntryPages(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-entry-pages'
  );

  toolsService.registerTool(
    'GetCampaigns',
    'Lists campaign-level referrer metrics.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getCampaigns>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getCampaigns(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-campaigns'
  );

  toolsService.registerTool(
    'GetEcommerceOverview',
    'Returns ecommerce order revenue and conversion metrics for the selected period.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getEcommerceOverview>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      return matomoClient.getEcommerceOverview(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam],
    '/tools/get-ecommerce-overview'
  );

  toolsService.registerTool(
    'GetEcommerceRevenue',
    'Aggregates ecommerce revenue totals with optional per-period breakdown.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const includeSeriesValue = parameters?.['includeSeries'];
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;
      const includeSeries =
        typeof includeSeriesValue === 'boolean'
          ? includeSeriesValue
          : typeof includeSeriesValue === 'string'
          ? includeSeriesValue.toLowerCase() === 'true'
          : undefined;

      const request: Parameters<typeof matomoClient.getEcommerceRevenueTotals>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (includeSeries !== undefined) {
        request.includeSeries = includeSeries;
      }
      return matomoClient.getEcommerceRevenueTotals(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, includeSeriesParam],
    '/tools/get-ecommerce-revenue'
  );

  toolsService.registerTool(
    'GetTrafficChannels',
    'Provides a high-level breakdown of traffic sources (direct, search, social, referrals, campaigns).',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const channelType = parseOptionalString(parameters?.['channelType']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getTrafficChannels>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      if (channelType !== undefined) {
        request.channelType = channelType;
      }
      return matomoClient.getTrafficChannels(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam, channelTypeParam],
    '/tools/get-traffic-channels'
  );

  toolsService.registerTool(
    'GetGoalConversions',
    'Returns goal conversion metrics with optional filtering by goal or type.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const goalIdValue = parameters?.['goalId'];
      const goalType = parseOptionalString(parameters?.['goalType']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const goalIdNumeric = parseOptionalNumber(goalIdValue);
      const goalIdString = parseOptionalString(goalIdValue);
      const goalId = goalIdString ?? goalIdNumeric;

      const request: Parameters<typeof matomoClient.getGoalConversions>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      if (goalId !== undefined) {
        request.goalId = goalId;
      }
      if (goalType !== undefined) {
        request.goalType = goalType;
      }
      return matomoClient.getGoalConversions(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam, goalFilterIdParam, goalTypeFilterParam],
    '/tools/get-goal-conversions'
  );

  toolsService.registerTool(
    'GetFunnelAnalytics',
    'Returns funnel conversion metrics and step breakdown for a Matomo funnel.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const funnelIdValue = parameters?.['funnelId'];
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const funnelIdString = parseOptionalString(funnelIdValue);
      const funnelIdNumeric = parseOptionalNumber(funnelIdValue);
      const funnelId = funnelIdString ?? (funnelIdNumeric !== undefined ? String(funnelIdNumeric) : undefined);

      if (!funnelId) {
        throw new Error('funnelId is required');
      }

      const request: Parameters<typeof matomoClient.getFunnelSummary>[0] = {
        funnelId,
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      return matomoClient.getFunnelSummary(request);
    },
    [siteIdParam, funnelIdParam, periodParam, dateParam, segmentParam],
    '/tools/get-funnel-analytics'
  );

  toolsService.registerTool(
    'GetEvents',
    'Returns aggregate event metrics optionally filtered by category, action, or name.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const category = parseOptionalString(parameters?.['category']);
      const action = parseOptionalString(parameters?.['action']);
      const name = parseOptionalString(parameters?.['name']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getEvents>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      if (category !== undefined) {
        request.category = category;
      }
      if (action !== undefined) {
        request.action = action;
      }
      if (name !== undefined) {
        request.name = name;
      }
      return matomoClient.getEvents(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam, eventCategoryFilterParam, eventActionFilterParam, eventNameFilterParam],
    '/tools/get-events'
  );

  toolsService.registerTool(
    'GetEventCategories',
    'Summarizes events grouped by category with aggregate counts and values.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getEventCategories>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getEventCategories(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-event-categories'
  );

  toolsService.registerTool(
    'GetDeviceTypes',
    'Breaks down visits by high-level device categories (desktop, mobile, tablet).',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const periodValue = parameters?.['period'];
      const dateValue = parameters?.['date'];
      const segmentValue = parameters?.['segment'];
      const limit = parseOptionalNumber(parameters?.['limit']);
      const period = typeof periodValue === 'string' ? periodValue : undefined;
      const date = typeof dateValue === 'string' ? dateValue : undefined;
      const segment = typeof segmentValue === 'string' ? segmentValue : undefined;

      const request: Parameters<typeof matomoClient.getDeviceTypes>[0] = {
        period: period ?? 'day',
        date: date ?? 'today',
      };
      if (siteId !== undefined) {
        request.siteId = siteId;
      }
      if (segment !== undefined) {
        request.segment = segment;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      return matomoClient.getDeviceTypes(request);
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-device-types'
  );

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, status: 'alive' });
  });

  const handleReadiness = async (_req: Request, res: Response) => {
    try {
      const health = await matomoClient.getHealthStatus();
      const isHealthy = health.status === 'healthy';
      const statusCode = isHealthy ? 200 : 503;

      res.status(statusCode).json({
        ok: isHealthy,
        status: health.status,
        health,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Matomo diagnostics unavailable';
      const safeMessage = redactSecrets(message);
      res.status(503).json({
        ok: false,
        status: 'unhealthy',
        error: safeMessage.includes('token_auth') ? 'Matomo diagnostics unavailable' : safeMessage,
      });
    }
  };

  app.get('/readyz', handleReadiness);
  app.get('/health', handleReadiness);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof ValidationError) {
      res.status(err.status).json({ error: redactSecrets(err.message) });
      return;
    }

    if (err && typeof err === 'object' && 'type' in err && (err as { type?: unknown }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large.' });
      return;
    }

    if (err instanceof SyntaxError && 'status' in (err as { status?: unknown })) {
      const syntaxStatus = (err as { status?: number }).status ?? 400;
      res.status(syntaxStatus).json({ error: 'Invalid JSON payload.' });
      return;
    }

    const statusCandidate =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: unknown }).status)
        : undefined;
    const status =
      statusCandidate && Number.isFinite(statusCandidate) && statusCandidate >= 400 && statusCandidate < 600
        ? statusCandidate
        : 500;
    const message =
      err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? ((err as { message: string }).message as string)
        : 'Internal server error';

    res.status(status).json({ error: redactSecrets(message) });
  });

  return app;
}

async function start() {
  const app = buildServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  return new Promise<void>((resolve, reject) => {
    app
      .listen(port, host, () => {
        apiLogger.info('server listening', { host, port });
        resolve();
      })
      .on('error', reject);
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  start().catch(err => {
    apiLogger.error('failed to start server', { error: err });
    process.exit(1);
  });
}
