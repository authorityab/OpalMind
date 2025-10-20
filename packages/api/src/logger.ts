export type LogLevel = 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

function emitLog(payload: LogPayload): void {
  const { level, message, context } = payload;
  const body = context ? { message, ...context } : { message };
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    ...body,
  };

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(entry);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(entry);
  } else {
    // eslint-disable-next-line no-console
    console.info(entry);
  }
}

export const logger = {
  info(message: string, context?: Record<string, unknown>): void {
    emitLog({ level: 'info', message, context });
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emitLog({ level: 'warn', message, context });
  },
  error(message: string, context?: Record<string, unknown>): void {
    emitLog({ level: 'error', message, context });
  },
};

export type Logger = typeof logger;
