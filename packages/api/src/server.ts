import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { Parameter, ParameterType, ToolsService, Function as ToolFunction } from '@optimizely-opal/opal-tools-sdk';
import { createMatomoClient } from '@opalmind/sdk';

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
    throw new Error(`${field} is required`);
  }
  return parsed;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requireString(value: unknown, field: string): string {
  const parsed = parseOptionalString(value);
  if (!parsed) {
    throw new Error(`${field} is required`);
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
      const { params, auth, usedFallback } = extractInvocationPayload(req.body);
      const paramKeys = summarizeParameters(params);
      logToolInfo('request', {
        tool: name,
        endpoint,
        paramKeys,
        authProvider: summarizeAuthProvider(auth),
        fallbackUsed: usedFallback,
      });

      try {
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
        });

        res.status(status).json({ error: sanitizedError.message ?? 'Unknown error' });
      }
    });
  };

  (service as unknown as { registerTool: typeof sanitizedRegisterTool }).registerTool = sanitizedRegisterTool;
}

function extractInvocationPayload(body: unknown): { params: unknown; auth: unknown; usedFallback: boolean } {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if ('parameters' in record) {
      return {
        params: record.parameters,
        auth: record.auth,
        usedFallback: false,
      };
    }
    return { params: body, auth: record.auth, usedFallback: true };
  }

  return { params: body, auth: undefined, usedFallback: true };
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

function logToolInfo(event: 'request' | 'success', details: Record<string, unknown>) {
  console.info('[tools]', { event, ...details });
}

function logToolError(event: 'failure', details: Record<string, unknown>) {
  console.error('[tools]', { event, ...details });
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
  app.use(express.json());

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

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requiresAuth = req.path.startsWith('/tools') || req.path.startsWith('/track');
    if (!requiresAuth) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${bearerToken}`) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="MatomoTools"');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  });

  const matomoClient = createMatomoClient({
    baseUrl: matomoBaseUrl,
    tokenAuth: matomoToken,
    defaultSiteId,
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

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const health = await matomoClient.getHealthStatus();
      const isHealthy = health.status === 'healthy';
      const statusCode = health.status === 'unhealthy' ? 503 : 200;

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
        // eslint-disable-next-line no-console
        console.log(`Server listening on http://${host}:${port}`);
        resolve();
      })
      .on('error', reject);
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  start().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
