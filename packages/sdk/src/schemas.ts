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
  })
  .passthrough();

export type KeyNumbers = z.infer<typeof keyNumbersSchema>;

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

export type Campaign = z.infer<typeof campaignsSchema>[number];
