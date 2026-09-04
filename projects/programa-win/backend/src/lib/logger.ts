import { safeMeta } from "./redact";

type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
const ORDER: Record<Level, number> = { silent: 0, fatal: 1, error: 2, warn: 3, info: 4, debug: 5, trace: 6 };

let threshold: Level = "info";
export function setLogLevel(level: Level): void {
  threshold = level;
}

function emit(level: Exclude<Level, "silent">, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] > ORDER[threshold]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? { meta: safeMeta(meta) } : {}),
  });
  // Toda saida vai para stderr: stdout fica livre para artefatos de CLI.
  console.error(line);
}

export const logger = {
  fatal: (m: string, x?: Record<string, unknown>) => emit("fatal", m, x),
  error: (m: string, x?: Record<string, unknown>) => emit("error", m, x),
  warn: (m: string, x?: Record<string, unknown>) => emit("warn", m, x),
  info: (m: string, x?: Record<string, unknown>) => emit("info", m, x),
  debug: (m: string, x?: Record<string, unknown>) => emit("debug", m, x),
};
