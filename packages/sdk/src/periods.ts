const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfDay(date).getTime() + days * MS_PER_DAY);
}

function addMonths(date: Date, months: number): Date {
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDate = date.getUTCDate();
  return new Date(Date.UTC(utcYear, utcMonth + months, utcDate));
}

function addYears(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseRelativeKeyword(value: string, now: Date): Date | undefined {
  const normalized = value.toLowerCase();
  if (normalized === 'today') {
    return startOfDay(now);
  }

  if (normalized === 'yesterday') {
    return addDays(startOfDay(now), -1);
  }

  return undefined;
}

function parseMatomoDate(value: string, now: Date): Date | undefined {
  return parseIsoDate(value) ?? parseRelativeKeyword(value, now);
}

function parseDateRange(value: string, now: Date): { start: Date; end: Date } | undefined {
  const [rawStart, rawEnd] = value.split(',').map(part => part.trim());
  if (!rawStart || !rawEnd) {
    return undefined;
  }

  const start = parseMatomoDate(rawStart, now);
  const end = parseMatomoDate(rawEnd, now);
  if (!start || !end) {
    return undefined;
  }

  const normalizedStart = startOfDay(start);
  const normalizedEnd = startOfDay(end);

  if (normalizedStart.getTime() > normalizedEnd.getTime()) {
    return undefined;
  }

  return { start: normalizedStart, end: normalizedEnd };
}

function shiftRange(range: { start: Date; end: Date }, offsetDays: number): { start: Date; end: Date } {
  return {
    start: addDays(range.start, offsetDays),
    end: addDays(range.end, offsetDays),
  };
}

function deriveRangeForLastKeyword(keyword: string, now: Date): { start: Date; end: Date } | undefined {
  const match = keyword.match(/^last(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count) || count <= 0) {
    return undefined;
  }

  const end = startOfDay(now);
  const start = addDays(end, -(count - 1));
  return { start, end };
}

function deriveRangeForPreviousKeyword(keyword: string, now: Date): { start: Date; end: Date } | undefined {
  const match = keyword.match(/^previous(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count) || count <= 0) {
    return undefined;
  }

  const end = addDays(startOfDay(now), -count);
  const start = addDays(end, -(count - 1));
  return { start, end };
}

export function resolvePreviousPeriodDate(period: string, date: string, now: Date = new Date()): string | undefined {
  const normalizedPeriod = period.trim().toLowerCase();
  const normalizedDate = date.trim();

  const explicitRange = parseDateRange(normalizedDate, now);
  if (explicitRange) {
    const durationDays = Math.round((explicitRange.end.getTime() - explicitRange.start.getTime()) / MS_PER_DAY) + 1;
    const offset = -durationDays;
    const previousRange = shiftRange(explicitRange, offset);
    return `${formatDate(previousRange.start)},${formatDate(previousRange.end)}`;
  }

  const lastRange = deriveRangeForLastKeyword(normalizedDate, now);
  if (lastRange) {
    const count = Math.round((lastRange.end.getTime() - lastRange.start.getTime()) / MS_PER_DAY) + 1;
    const previousRange = shiftRange(lastRange, -count);
    return `${formatDate(previousRange.start)},${formatDate(previousRange.end)}`;
  }

  const previousRange = deriveRangeForPreviousKeyword(normalizedDate, now);
  if (previousRange) {
    const count = Math.round((previousRange.end.getTime() - previousRange.start.getTime()) / MS_PER_DAY) + 1;
    const earlier = shiftRange(previousRange, -count);
    return `${formatDate(earlier.start)},${formatDate(earlier.end)}`;
  }

  const parsedDate = parseMatomoDate(normalizedDate, now);
  if (!parsedDate) {
    return undefined;
  }

  switch (normalizedPeriod) {
    case 'day': {
      return formatDate(addDays(parsedDate, -1));
    }
    case 'week': {
      return formatDate(addDays(parsedDate, -7));
    }
    case 'month': {
      return formatDate(addMonths(parsedDate, -1));
    }
    case 'year': {
      return formatDate(addYears(parsedDate, -1));
    }
    case 'range': {
      return formatDate(addDays(parsedDate, -1));
    }
    default: {
      return formatDate(addDays(parsedDate, -1));
    }
  }
}
