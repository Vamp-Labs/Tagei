// Minimal structured logger shared by the A3 chain modules (bigint-safe JSON extras).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Recursively converts bigints to decimal strings so a value is JSON-serialisable. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { name: value.name, message: value.message };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}

export interface LogSink {
  log(line: string): void;
  error(line: string): void;
}

export function createLogger(scope: string, level: LogLevel = 'info', sink: LogSink = console): Logger {
  const min = ORDER[level];
  const write = (lvl: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const tail = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(toJsonSafe(extra))}` : '';
    const line = `${new Date().toISOString()} ${lvl} [${scope}] ${msg}${tail}`;
    if (lvl === 'error' || lvl === 'warn') sink.error(line);
    else sink.log(line);
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
    child: (s) => createLogger(`${scope}:${s}`, level, sink),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
