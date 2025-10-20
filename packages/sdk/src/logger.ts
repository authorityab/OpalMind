type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, message: string, details?: unknown): void {
  const entry = {
    level,
    message,
    details,
    timestamp: new Date().toISOString(),
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

export const sdkLogger = {
  warn(message: string, details?: unknown): void {
    emit('warn', message, details);
  },
};

export type SdkLogger = typeof sdkLogger;
