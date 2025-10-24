import { z } from 'zod';

const numeric = z.coerce.number();

export const keyNumbersSchema = z
  .object({
    nb_visits: numeric,
    nb_uniq_visitors: numeric.optional(),
    nb_actions: numeric.optional(),
    nb_users: numeric.optional(),
    nb_visits_converted: numeric.optional(),
    sum_visit_length: numeric.optional(),
    max_actions: numeric.optional(),
    bounce_rate: z.string().optional(),
    nb_actions_per_visit: z.union([numeric, z.string()]).optional(),
    nb_pageviews: numeric.optional(),
    nb_uniq_pageviews: numeric.optional(),
    avg_time_on_site: z
      .union([
        numeric,
        z.object({
          value: numeric,
          unit: z.enum(['seconds']),
        }),
      ])
      .optional(),
  })
  .passthrough();

export type KeyNumbers = z.infer<typeof keyNumbersSchema>;

export const keyNumbersSeriesSchema = z.record(keyNumbersSchema);

export const mostPopularUrlsSchema = z.array(
  z
    .object({
      label: z.string(),
      url: z.string().optional(),
      nb_hits: numeric.optional(),
      nb_visits: numeric.optional(),
      nb_uniq_visitors: numeric.optional(),
      sum_time_spent: numeric.optional(),
    })
    .passthrough()
);

export type MostPopularUrl = z.infer<typeof mostPopularUrlsSchema>[number];

export const topReferrersSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      nb_visits_converted: numeric.optional(),
    })
    .passthrough()
);

export type TopReferrer = z.infer<typeof topReferrersSchema>[number];

export const eventsSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_events: numeric.optional(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      sum_event_value: numeric.optional(),
      nb_events_with_value: numeric.optional(),
      avg_event_value: z.union([numeric, z.string()]).optional(),
      min_event_value: numeric.optional(),
      max_event_value: numeric.optional(),
    })
    .passthrough()
);

export type EventSummary = z.infer<typeof eventsSchema>[number];

export const entryPagesSchema = z.array(
  z
    .object({
      label: z.string(),
      url: z.string().optional(),
      nb_visits: numeric.optional(),
      nb_uniq_visitors: numeric.optional(),
      nb_hits: numeric.optional(),
      sum_time_spent: numeric.optional(),
      entry_nb_uniq_visitors: numeric.optional(),
      entry_nb_visits: numeric.optional(),
      entry_nb_actions: numeric.optional(),
      entry_sum_visit_length: numeric.optional(),
      entry_bounce_count: numeric.optional(),
      exit_nb_uniq_visitors: numeric.optional(),
      exit_nb_visits: numeric.optional(),
      avg_page_load_time: numeric.optional(),
      avg_time_on_page: numeric.optional(),
      bounce_rate: z.string().optional(),
      exit_rate: z.string().optional(),
    })
    .passthrough()
);

export type EntryPage = z.infer<typeof entryPagesSchema>[number];

export const campaignsSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      nb_visits_converted: numeric.optional(),
      revenue: numeric.optional(),
    })
    .passthrough()
);

export type RawCampaign = z.infer<typeof campaignsSchema>[number];

export const ecommerceSummarySchema = z
  .object({
    nb_conversions: numeric.optional(),
    nb_visits: numeric.optional(),
    nb_visits_converted: numeric.optional(),
    conversion_rate: z.string().optional(),
    revenue: numeric.optional(),
    revenue_per_visit: numeric.optional(),
    revenue_per_conversion: numeric.optional(),
    avg_order_revenue: numeric.optional(),
    items: numeric.optional(),
    revenue_subtotal: numeric.optional(),
    revenue_tax: numeric.optional(),
    revenue_shipping: numeric.optional(),
    revenue_discount: numeric.optional(),
  })
  .passthrough();

export type RawEcommerceSummary = z.infer<typeof ecommerceSummarySchema>;

export const eventCategoriesSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_events: numeric.optional(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      sum_event_value: numeric.optional(),
      nb_events_with_value: numeric.optional(),
      avg_event_value: z.union([numeric, z.string()]).optional(),
      min_event_value: numeric.optional(),
      max_event_value: numeric.optional(),
    })
    .passthrough()
);

export type EventCategory = z.infer<typeof eventCategoriesSchema>[number];

export const deviceTypesSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      nb_visits_converted: numeric.optional(),
      nb_hits: numeric.optional(),
      sum_visit_length: numeric.optional(),
      avg_time_on_site: numeric.optional(),
      bounce_rate: z.string().optional(),
      max_actions: numeric.optional(),
    })
    .passthrough()
);

export type DeviceTypeSummary = z.infer<typeof deviceTypesSchema>[number];

export const trafficChannelsSchema = z.array(
  z
    .object({
      label: z.string(),
      nb_visits: numeric.optional(),
      nb_actions: numeric.optional(),
      nb_visits_converted: numeric.optional(),
      sum_visit_length: numeric.optional(),
      nb_hits: numeric.optional(),
      bounce_rate: z.string().optional(),
      revenue: numeric.optional(),
    })
    .passthrough()
);

export type RawTrafficChannel = z.infer<typeof trafficChannelsSchema>[number];

export const goalConversionsSchema = z.array(
  z
    .object({
      idgoal: z.union([z.string(), numeric]).optional(),
      goal: z.string().optional(),
      name: z.string().optional(),
      type: z.string().optional(),
      nb_conversions: numeric.optional(),
      nb_visits_converted: numeric.optional(),
      revenue: numeric.optional(),
    })
    .passthrough()
);

export type RawGoalConversion = z.infer<typeof goalConversionsSchema>[number];

export const funnelStepSchema = z
  .object({
    idstep: z.union([z.string(), numeric]).optional(),
    label: z.string().optional(),
    name: z.string().optional(),
    overall_conversion_rate: z.union([numeric, z.string()]).optional(),
    step_conversion_rate: z.union([numeric, z.string()]).optional(),
    step_abandonment_rate: z.union([numeric, z.string()]).optional(),
    nb_conversions: numeric.optional(),
    nb_conversions_total: numeric.optional(),
    nb_visits_total: numeric.optional(),
    nb_users: numeric.optional(),
    nb_targets: numeric.optional(),
    avg_time_to_convert: numeric.optional(),
    median_time_to_convert: numeric.optional(),
  })
  .passthrough();

export type RawFunnelStep = z.infer<typeof funnelStepSchema>;

export const funnelSummarySchema = z
  .object({
    idfunnel: z.union([z.string(), numeric]).optional(),
    label: z.string().optional(),
    name: z.string().optional(),
    overall_conversion_rate: z.union([numeric, z.string()]).optional(),
    overall_abandonment_rate: z.union([numeric, z.string()]).optional(),
    nb_conversions_total: numeric.optional(),
    nb_visits_total: numeric.optional(),
    steps: z
      .union([
        z.array(funnelStepSchema),
        z.record(funnelStepSchema),
      ])
      .optional(),
  })
  .passthrough();

export type RawFunnelSummary = z.infer<typeof funnelSummarySchema>;

export const funnelResponseSchema = z.union([
  funnelSummarySchema,
  z.array(funnelSummarySchema),
  z.record(funnelSummarySchema),
]);
