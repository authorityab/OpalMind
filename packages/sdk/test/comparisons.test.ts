import { describe, expect, it } from 'vitest';

import { computeComparisonDelta } from '../src/comparisons.js';

describe('computeComparisonDelta', () => {
  it('returns formatted deltas with direction when previous value is non-zero', () => {
    const delta = computeComparisonDelta(120, 100);

    expect(delta.current).toBe(120);
    expect(delta.previous).toBe(100);
    expect(delta.absoluteChange).toBe(20);
    expect(delta.deltaPercentage).toBe(20);
    expect(delta.deltaFormatted).toBe('20.0%');
    expect(delta.direction).toBe('up');
    expect(delta.directionSymbol).toBe('▲');
  });

  it('marks delta as N/A when the baseline is zero but preserves direction', () => {
    const delta = computeComparisonDelta(5, 0);

    expect(delta.deltaPercentage).toBeNull();
    expect(delta.deltaFormatted).toBe('N/A');
    expect(delta.direction).toBe('up');
    expect(delta.directionSymbol).toBe('▲');
  });
});
