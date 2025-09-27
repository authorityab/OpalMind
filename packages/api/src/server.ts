import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Parameter, ParameterType, ToolsService } from '@optimizely-opal/opal-tools-sdk';
import { createMatomoClient } from '@matokit/sdk';

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

export function buildServer() {
  const app = express();
  app.use(express.json());

  const bearerToken = process.env.OPAL_BEARER_TOKEN || 'change-me';

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/tools')) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${bearerToken}`) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="MatomoTools"');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  });

  const defaultSiteIdEnv = process.env.MATOMO_DEFAULT_SITE_ID ?? '1';
  const defaultSiteId = Number.parseInt(defaultSiteIdEnv, 10);

  const matomoClient = createMatomoClient({
    baseUrl: process.env.MATOMO_BASE_URL || 'https://matomo.surputte.se',
    tokenAuth: process.env.MATOMO_TOKEN || 'set-me',
    defaultSiteId: Number.isNaN(defaultSiteId) ? undefined : defaultSiteId,
  });

  const toolsService = new ToolsService(app);

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

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
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
