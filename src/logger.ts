export type LogLevel = 'info' | 'warn' | 'error';

export type Logger = ((level: LogLevel, message: string, detail?: unknown) => void) & {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
};

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, detail?: unknown) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(detail === undefined ? {} : { detail: redact(detail) }),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  const logger = emit as Logger;
  logger.info = (message, detail) => emit('info', message, detail);
  logger.warn = (message, detail) => emit('warn', message, detail);
  logger.error = (message, detail) => emit('error', message, detail);
  return logger;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/password=[^&\s]+/gi, 'password=[redacted]')
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = /password|secret|token|cookie|authorization/i.test(key) ? '[redacted]' : redact(child);
    }
    return out;
  }
  return value;
}
