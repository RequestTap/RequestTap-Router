export interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...meta,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else if (level === "debug") {
    console.debug(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger: Logger = {
  error: (msg, meta?) => log("error", msg, meta),
  warn: (msg, meta?) => log("warn", msg, meta),
  info: (msg, meta?) => log("info", msg, meta),
  debug: (msg, meta?) => log("debug", msg, meta),
};
