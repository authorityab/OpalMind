/* eslint-disable no-console */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
}

export type LogTransport = (record: LogRecord) => void;

const DEFAULT_SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|auth|key)/i;

const LOG_LEVEL_TO_CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

export function redactSecrets(value: string): string {
  return value
    .replace(/token_auth=[^&#\s"]+/gi, 'token_auth=REDACTED')
    .replace(/\btoken[\w-]*\s*[:=]\s*[^,\s]+/gi, match => {
      const [rawKey] = match.split(/[:=]/);
      const key = rawKey?.trim() ?? 'token';
      return `${key}=REDACTED`;
    })
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer REDACTED');
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSecrets(value.message),
      stack: typeof value.stack === 'string' ? redactSecrets(value.stack) : undefined,
    } satisfies LogContext;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[circular]';
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, seen));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const sanitizedEntries = entries.map(([key, entryValue]) => {
    if (DEFAULT_SENSITIVE_KEY_PATTERN.test(key)) {
      return [key, '[redacted]'] as const;
    }

    return [key, sanitizeValue(entryValue, seen)] as const;
  });

  return Object.fromEntries(sanitizedEntries);
}

function sanitizeContext(context: LogContext): LogContext {
  const seen = new WeakSet<object>();
  const sanitized = sanitizeValue(context, seen);
  return typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
    ? (sanitized as LogContext)
    : {};
}

const defaultTransport: LogTransport = record => {
  const consoleMethod = LOG_LEVEL_TO_CONSOLE_METHOD[record.level];
  const payload = {
    time: record.timestamp,
    level: record.level,
    message: record.message,
    ...record.context,
  } satisfies Record<string, unknown>;

  const serialized = JSON.stringify(payload);
  const printer = console[consoleMethod] as ((...args: unknown[]) => void) | undefined;
  if (typeof printer === 'function') {
    printer(serialized);
  } else {
    console.log(serialized);
  }
};

function emit(
  transport: LogTransport,
  level: LogLevel,
  baseBindings: LogContext,
  message: string,
  context?: LogContext
) {
  const timestamp = new Date().toISOString();
  const combined = { ...baseBindings, ...(context ?? {}) } satisfies LogContext;
  const sanitized = sanitizeContext(combined);
  transport({ level, message, timestamp, context: sanitized });
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export function createLogger(bindings: LogContext = {}, transport: LogTransport = defaultTransport): Logger {
  const baseBindings = { ...bindings } satisfies LogContext;

  return {
    debug(message, context) {
      emit(transport, 'debug', baseBindings, message, context);
    },
    info(message, context) {
      emit(transport, 'info', baseBindings, message, context);
    },
    warn(message, context) {
      emit(transport, 'warn', baseBindings, message, context);
    },
    error(message, context) {
      emit(transport, 'error', baseBindings, message, context);
    },
    child(childBindings) {
      return createLogger({ ...baseBindings, ...childBindings }, transport);
    },
  } satisfies Logger;
}

export const logger = createLogger({ service: 'opal' });
