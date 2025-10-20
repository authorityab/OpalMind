import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { Parameter, ParameterType, ToolsService, Function as ToolFunction } from '@optimizely-opal/opal-tools-sdk';
import { createMatomoClient, type TrackingQueueThresholds } from '@opalmind/sdk';

import { ValidationError, parseToolInvocation } from './validation.js';
import { logger } from './logger.js';

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
    return { scheme: '', token: undefined };
  }

  const parts = header.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { scheme: '', token: undefined };
  }

  const [scheme, ...rest] = parts;
  const token = rest.join(' ').trim();
  return {
    scheme,
    token: token.length > 0 ? token : undefined,
  };
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

function parseRequiredNumber(value: unknown, field: string): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    throw new ValidationError(`${field} is required`);
  }
  return parsed;
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

function requireString(value: unknown, field: string): string {
  const parsed = parseOptionalString(value);
  if (!parsed) {
    throw new ValidationError(`${field} is required`);
  }
  return parsed;
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
  useTokenKey?: boolean;
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, { count: number; expiresAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const token = options.useTokenKey && typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const key = `${req.ip ?? 'unknown'}:${token}`;
    const entry = buckets.get(key);

    if (!entry || entry.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
      next();
      return;
    }

    if (entry.count >= options.max) {
      res.status(429).json({ error: options.message });
      return;
    }

    entry.count += 1;
    next();
  };
}

function logToolInfo(event: 'request' | 'success', details: Record<string, unknown>) {
  logger.info('tools', { event, ...details });
}

function logToolError(event: 'failure', details: Record<string, unknown>) {
  logger.error('tools', { event, ...details });
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
    return {
      message: redactTokens(error.message),
      status,
      code,
    };
  }

  if (typeof error === 'string') {
    return { message: redactTokens(error) };
  }

  return { message: 'Unknown error' };
}

function redactTokens(value: string): string {
  return value
    .replace(/token_auth=[^&#\s"]+/gi, 'token_auth=REDACTED')
    .replace(/\btoken[\w-]*\s*[:=]\s*[^,\s]+/gi, match => `${match.split(/[:=]/)[0].trim()}=REDACTED`)
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer REDACTED');
}

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');

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

  const rateLimitWindowMs = parsePositiveIntegerEnv('OPAL_RATE_LIMIT_WINDOW_MS', 60_000);
  const rateLimitMax = parsePositiveIntegerEnv('OPAL_RATE_LIMIT_MAX', 60);
  const trackRateLimitMax = parsePositiveIntegerEnv('OPAL_TRACK_RATE_LIMIT_MAX', 120);

  const generalLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    message: 'Too many requests, please try again later.',
  });

  const trackingLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    max: trackRateLimitMax,
    message: 'Too many tracking requests, please try again later.',
    useTokenKey: true,
  });

  app.use('/tools', generalLimiter);
  app.use('/track', trackingLimiter);

  const bearerToken = process.env.OPAL_BEARER_TOKEN?.trim();
  if (!bearerToken || bearerToken === 'change-me') {
    throw new Error('OPAL_BEARER_TOKEN must be set to a non-default value before starting the service.');
  }
  const normalizedBearerToken = bearerToken.toLowerCase();

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

  const queueWarnPending = parseOptionalNumber(process.env.MATOMO_QUEUE_WARN_PENDING);
  const queueFailPending = parseOptionalNumber(process.env.MATOMO_QUEUE_FAIL_PENDING);
  const queueWarnAgeMs = parseOptionalNumber(process.env.MATOMO_QUEUE_WARN_AGE_MS);
  const queueFailAgeMs = parseOptionalNumber(process.env.MATOMO_QUEUE_FAIL_AGE_MS);
  const cacheWarnHitRate = parseOptionalFloat(process.env.MATOMO_CACHE_WARN_HIT_RATE);
  const cacheFailHitRate = parseOptionalFloat(process.env.MATOMO_CACHE_FAIL_HIT_RATE);
  const cacheSampleSize = parseOptionalNumber(process.env.MATOMO_CACHE_SAMPLE_SIZE);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requiresAuth = req.path.startsWith('/tools') || req.path.startsWith('/track');
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

    const normalizedToken = token.toLowerCase();
    if (!constantTimeEqual(normalizedBearerToken, normalizedToken)) {
      res.setHeader(
        'WWW-Authenticate',
        formatAuthChallenge({ error: 'invalid_token', description: 'Bearer token is invalid.' })
      );
      return res.status(401).json({ error: 'Invalid bearer token.' });
    }

    return next();
  });

  const queueHealthThresholds: Partial<TrackingQueueThresholds> = {};
  if (queueWarnPending !== undefined) queueHealthThresholds.pendingWarn = queueWarnPending;
  if (queueFailPending !== undefined) queueHealthThresholds.pendingFail = queueFailPending;
  if (queueWarnAgeMs !== undefined) queueHealthThresholds.ageWarnMs = queueWarnAgeMs;
  if (queueFailAgeMs !== undefined) queueHealthThresholds.ageFailMs = queueFailAgeMs;

  const cacheHealthThresholds: Record<string, number> = {};
  if (cacheWarnHitRate !== undefined) cacheHealthThresholds.warnHitRate = cacheWarnHitRate;
  if (cacheFailHitRate !== undefined) cacheHealthThresholds.failHitRate = cacheFailHitRate;
  if (cacheSampleSize !== undefined) cacheHealthThresholds.sampleSize = cacheSampleSize;

  const matomoClient = createMatomoClient({
    baseUrl: matomoBaseUrl,
    tokenAuth: matomoToken,
    defaultSiteId,
    tracking: {
      baseUrl: matomoBaseUrl,
      healthThresholds:
        Object.keys(queueHealthThresholds).length > 0 ? queueHealthThresholds : undefined,
    },
    cacheHealth: Object.keys(cacheHealthThresholds).length > 0 ? cacheHealthThresholds : undefined,
  });

  const toolsService = new ToolsService(app);
  configureToolsServiceLogging(toolsService);

  const siteIdParam = new Parameter('siteId', ParameterType.Integer, 'Override site ID (defaults to MATOMO_DEFAULT_SITE_ID)', false);
  const periodParam = new Parameter('period', ParameterType.String, 'Matomo period (day, week, month, year, range)', false);
  const dateParam = new Parameter('date', ParameterType.String, 'Date or range (YYYY-MM-DD, today, yesterday, last7, etc.)', false);
  const segmentParam = new Parameter('segment', ParameterType.String, 'Matomo segment expression', false);
  const limitParam = new Parameter('limit', ParameterType.Integer, 'Maximum number of records to return', false);
  const pageUrlParam = new Parameter('url', ParameterType.String, 'Absolute URL for the pageview', true);
  const eventUrlParam = new Parameter('url', ParameterType.String, 'Absolute URL associated with the event or goal', false);
  const actionNameParam = new Parameter('actionName', ParameterType.String, 'Human-readable page title', false);
  const pvIdParam = new Parameter('pvId', ParameterType.String, 'Provide an existing Matomo pv_id for continuity', false);
  const visitorIdParam = new Parameter('visitorId', ParameterType.String, '16-character Matomo visitor ID', false);
  const uidParam = new Parameter('uid', ParameterType.String, 'User identifier for Matomo', false);
  const referrerParam = new Parameter('referrer', ParameterType.String, 'Referrer URL', false);
  const timestampParam = new Parameter('timestamp', ParameterType.Integer, 'Event timestamp (ms since epoch)', false);
  const categoryParam = new Parameter('category', ParameterType.String, 'Event category', true);
  const actionParam = new Parameter('action', ParameterType.String, 'Event action', true);
  const nameParam = new Parameter('name', ParameterType.String, 'Event name', false);
  const valueParam = new Parameter('value', ParameterType.Integer, 'Event value', false);
  const goalIdParam = new Parameter('goalId', ParameterType.Integer, 'Goal identifier', true);
  const revenueParam = new Parameter('revenue', ParameterType.Number, 'Goal revenue amount', false);
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

      return matomoClient.getKeyNumbers({ siteId, period, date, segment });
    },
    [siteIdParam, periodParam, dateParam, segmentParam],
    '/tools/get-key-numbers'
  );

  toolsService.registerTool(
    'DiagnoseMatomo',
    'Runs connectivity and permission checks against the configured Matomo instance.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      return matomoClient.runDiagnostics({ siteId });
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
      return matomoClient.getHealthStatus({ siteId, includeDetails });
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

      return matomoClient.getKeyNumbersSeries({
        siteId,
        period: period ?? 'day',
        date: date ?? 'last7',
        segment,
      });
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

      return matomoClient.getMostPopularUrls({ siteId, period: period ?? 'day', date: date ?? 'today', segment, limit });
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

      return matomoClient.getTopReferrers({ siteId, period: period ?? 'day', date: date ?? 'today', segment, limit });
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

      return matomoClient.getEntryPages({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
      });
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

      return matomoClient.getCampaigns({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
      });
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

      return matomoClient.getEcommerceOverview({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
      });
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

      return matomoClient.getEcommerceRevenueTotals({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        includeSeries,
      });
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

      return matomoClient.getTrafficChannels({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
        channelType,
      });
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

      return matomoClient.getGoalConversions({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
        goalId,
        goalType,
      });
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

      return matomoClient.getFunnelSummary({
        siteId,
        funnelId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
      });
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

      return matomoClient.getEvents({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
        category,
        action,
        name,
      });
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

      return matomoClient.getEventCategories({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
      });
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

      return matomoClient.getDeviceTypes({
        siteId,
        period: period ?? 'day',
        date: date ?? 'today',
        segment,
        limit,
      });
    },
    [siteIdParam, periodParam, dateParam, segmentParam, limitParam],
    '/tools/get-device-types'
  );

  toolsService.registerTool(
    'TrackPageview',
    'Records a server-side pageview with optional pv_id continuity.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const url = requireString(parameters?.['url'], 'url');
      const actionName = parseOptionalString(parameters?.['actionName']);
      const pvId = parseOptionalString(parameters?.['pvId']);
      const visitorId = parseOptionalString(parameters?.['visitorId']);
      const uid = parseOptionalString(parameters?.['uid']);
      const referrer = parseOptionalString(parameters?.['referrer']);
      const timestamp = parseOptionalNumber(parameters?.['timestamp']);

      const result = await matomoClient.trackPageview({
        siteId,
        url,
        actionName,
        pvId,
        visitorId,
        uid,
        referrer,
        ts: timestamp,
      });

      return { ok: result.ok, status: result.status, pvId: result.pvId };
    },
    [
      siteIdParam,
      pageUrlParam,
      actionNameParam,
      pvIdParam,
      visitorIdParam,
      uidParam,
      referrerParam,
      timestampParam,
    ],
    '/track/pageview'
  );

  toolsService.registerTool(
    'TrackEvent',
    'Records a Matomo custom event.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const category = requireString(parameters?.['category'], 'category');
      const action = requireString(parameters?.['action'], 'action');
      const name = parseOptionalString(parameters?.['name']);
      const value = parseOptionalNumber(parameters?.['value']);
      const url = parseOptionalString(parameters?.['url']);
      const visitorId = parseOptionalString(parameters?.['visitorId']);
      const uid = parseOptionalString(parameters?.['uid']);
      const referrer = parseOptionalString(parameters?.['referrer']);
      const timestamp = parseOptionalNumber(parameters?.['timestamp']);

      const result = await matomoClient.trackEvent({
        siteId,
        category,
        action,
        name,
        value,
        url,
        visitorId,
        uid,
        referrer,
        ts: timestamp,
      });

      return { ok: result.ok, status: result.status };
    },
    [
      siteIdParam,
      categoryParam,
      actionParam,
      nameParam,
      valueParam,
      eventUrlParam,
      visitorIdParam,
      uidParam,
      referrerParam,
      timestampParam,
    ],
    '/track/event'
  );

  toolsService.registerTool(
    'TrackGoal',
    'Records a goal conversion.',
    async (parameters: Record<string, unknown>) => {
      const siteId = parseOptionalNumber(parameters?.['siteId']);
      const goalId = parseRequiredNumber(parameters?.['goalId'], 'goalId');
      const revenue = parseOptionalNumber(parameters?.['revenue']);
      const url = parseOptionalString(parameters?.['url']);
      const visitorId = parseOptionalString(parameters?.['visitorId']);
      const uid = parseOptionalString(parameters?.['uid']);
      const referrer = parseOptionalString(parameters?.['referrer']);
      const timestamp = parseOptionalNumber(parameters?.['timestamp']);

      const result = await matomoClient.trackGoal({
        siteId,
        goalId,
        revenue,
        url,
        visitorId,
        uid,
        referrer,
        ts: timestamp,
      });

      return { ok: result.ok, status: result.status };
    },
    [
      siteIdParam,
      goalIdParam,
      revenueParam,
      eventUrlParam,
      visitorIdParam,
      uidParam,
      referrerParam,
      timestampParam,
    ],
    '/track/goal'
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
      res.status(503).json({
        ok: false,
        status: 'unhealthy',
        error: message.includes('token_auth') ? 'Matomo diagnostics unavailable' : message,
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
      res.status(err.status).json({ error: redactTokens(err.message) });
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

    res.status(status).json({ error: redactTokens(message) });
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
        logger.info('server.listening', { address: `http://${host}:${port}` });
        resolve();
      })
      .on('error', reject);
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  start().catch(err => {
    logger.error('server.start_failed', { error: err instanceof Error ? err.message : err });
    process.exit(1);
  });
}
