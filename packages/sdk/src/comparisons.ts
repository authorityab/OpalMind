export type DeltaDirection = 'up' | 'down' | 'neutral';

export interface ComparisonDelta {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  deltaPercentage: number | null;
  deltaFormatted: string | null;
  direction: DeltaDirection;
  directionSymbol: '▲' | '▼' | '—';
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function resolveDirection(
  current: number | null,
  previous: number | null,
  deltaPercentage: number | null,
  absoluteChange: number | null
): { direction: DeltaDirection; directionSymbol: '▲' | '▼' | '—' } {
  if (deltaPercentage !== null) {
    if (deltaPercentage > 0) {
      return { direction: 'up', directionSymbol: '▲' };
    }

    if (deltaPercentage < 0) {
      return { direction: 'down', directionSymbol: '▼' };
    }
  }

  if (absoluteChange !== null && absoluteChange !== 0) {
    if (absoluteChange > 0) {
      return { direction: 'up', directionSymbol: '▲' };
    }

    if (absoluteChange < 0) {
      return { direction: 'down', directionSymbol: '▼' };
    }
  }

  if (current !== null && previous !== null) {
    if (current > previous) {
      return { direction: 'up', directionSymbol: '▲' };
    }

    if (current < previous) {
      return { direction: 'down', directionSymbol: '▼' };
    }
  }

  return { direction: 'neutral', directionSymbol: '—' };
}

export function computeComparisonDelta(currentValue: unknown, previousValue: unknown): ComparisonDelta {
  const current = toNumberOrNull(currentValue);
  const previous = toNumberOrNull(previousValue);

  const absoluteChange = current !== null && previous !== null ? current - previous : null;

  let deltaPercentage: number | null = null;
  let deltaFormatted: string | null = null;

  if (current !== null && previous !== null) {
    if (previous !== 0) {
      const rawDelta = ((current - previous) / previous) * 100;
      if (Number.isFinite(rawDelta)) {
        deltaPercentage = Math.round(rawDelta * 10) / 10;
        deltaFormatted = `${deltaPercentage.toFixed(1)}%`;
      }
    } else if (current === 0) {
      deltaPercentage = 0;
      deltaFormatted = '0.0%';
    } else {
      deltaPercentage = null;
      deltaFormatted = 'N/A';
    }
  }

  const { direction, directionSymbol } = resolveDirection(current, previous, deltaPercentage, absoluteChange);

  return {
    current,
    previous,
    absoluteChange,
    deltaPercentage,
    deltaFormatted,
    direction,
    directionSymbol,
  };
}

function isComparableKey(key: string, current: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  const currentValue = current[key];
  const previousValue = previous[key];

  return typeof currentValue === 'number' || typeof previousValue === 'number';
}

export type ComparisonMap = Record<string, ComparisonDelta>;

export function buildComparisonMap(
  current: Record<string, unknown>,
  previous: Record<string, unknown>
): ComparisonMap {
  const keys = new Set<string>();

  for (const key of Object.keys(current)) {
    if (isComparableKey(key, current, previous)) {
      keys.add(key);
    }
  }

  for (const key of Object.keys(previous)) {
    if (isComparableKey(key, current, previous)) {
      keys.add(key);
    }
  }

  const comparisons: ComparisonMap = {};

  for (const key of keys) {
    comparisons[key] = computeComparisonDelta(current[key], previous[key]);
  }

  return comparisons;
}

export function annotateRecordWithComparisons<T extends Record<string, unknown>>(
  current: T,
  previous: Record<string, unknown>
): T & { comparisons: ComparisonMap } {
  const comparisons = buildComparisonMap(current, previous);
  return { ...current, comparisons };
}

function toMapKey(key: string | number | undefined | null): string | number | undefined {
  if (key === undefined || key === null) {
    return undefined;
  }

  return typeof key === 'number' ? key : key;
}

export function annotateArrayWithComparisons<T extends Record<string, unknown>>(
  current: T[],
  previous: T[],
  options: { key?: (item: T, index: number) => string | number | undefined } = {}
): Array<T & { comparisons: ComparisonMap }> {
  const { key } = options;
  const previousMap = new Map<string | number, T>();

  if (key) {
    previous.forEach((item, index) => {
      const identifier = toMapKey(key(item, index));
      if (identifier !== undefined) {
        previousMap.set(identifier, item);
      }
    });
  }

  return current.map((item, index) => {
    const identifier = key ? toMapKey(key(item, index)) : undefined;
    const previousItem =
      (identifier !== undefined ? previousMap.get(identifier) : undefined) ?? previous[index] ?? ({} as T);

    const comparisons = buildComparisonMap(item, previousItem ?? {});
    return { ...item, comparisons };
  });
}
