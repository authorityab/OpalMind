import type {
  CampaignRecord,
  DeviceTypeSummaryRecord,
  EcommerceSummaryRecord,
  EntryPageRecord,
  EventCategoryRecord,
  EventSummaryRecord,
  KeyNumbersPayload,
  MostPopularUrlRecord,
  TopReferrerRecord,
  TrafficChannelRecord,
} from './schemas.js';
import type { ComparisonMap } from './comparisons.js';

export type MetricComparisons = ComparisonMap;

export interface KeyNumbers extends KeyNumbersPayload {
  comparisons: MetricComparisons;
}

export interface KeyNumbersSeriesPoint extends KeyNumbers {
  date: string;
}

export interface MostPopularUrl extends MostPopularUrlRecord {
  comparisons: MetricComparisons;
}

export interface TopReferrer extends TopReferrerRecord {
  comparisons: MetricComparisons;
}

export interface EventSummary extends EventSummaryRecord {
  comparisons: MetricComparisons;
}

export interface EntryPage extends EntryPageRecord {
  comparisons: MetricComparisons;
}

export interface Campaign extends CampaignRecord {
  comparisons: MetricComparisons;
}

export interface EcommerceSummary extends EcommerceSummaryRecord {
  comparisons: MetricComparisons;
}

export interface EcommerceRevenueSeriesPoint extends EcommerceSummary {
  label: string;
}

export interface EcommerceRevenueTotals {
  totals: EcommerceSummary;
  series?: EcommerceRevenueSeriesPoint[];
}

export interface EventCategory extends EventCategoryRecord {
  comparisons: MetricComparisons;
}

export interface DeviceTypeSummary extends DeviceTypeSummaryRecord {
  comparisons: MetricComparisons;
}

export interface TrafficChannel extends TrafficChannelRecord {
  comparisons: MetricComparisons;
}

export interface GoalConversion {
  id: string;
  label: string;
  type: string;
  nb_conversions?: number;
  nb_visits_converted?: number;
  revenue?: number;
  comparisons: MetricComparisons;
}

export type { ComparisonDelta, ComparisonMap } from './comparisons.js';
