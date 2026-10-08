/**
 * Tiny leveled logger. Set LOG_LEVEL=debug|info|warn|error (default: info).
 * Output goes to stdout/stderr so it shows up in `docker logs` / `docker compose logs`.
 */
const ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const

export type LogLevel = keyof typeof ORDER

const requested = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase() as LogLevel
const level: LogLevel = requested in ORDER ? requested : "info"
const threshold = ORDER[level]

function timestamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function write(levelToWrite: LogLevel, message: string, ...args: unknown[]): void {
  if (ORDER[levelToWrite] < threshold) return
  const line = `[${timestamp()}] ${levelToWrite.toUpperCase().padEnd(5)} ${message}`
  if (levelToWrite === "error") console.error(line, ...args)
  else if (levelToWrite === "warn") console.warn(line, ...args)
  else console.log(line, ...args)
}

export const log = {
  level,
  debug: (message: string, ...args: unknown[]) => write("debug", message, ...args),
  info: (message: string, ...args: unknown[]) => write("info", message, ...args),
  warn: (message: string, ...args: unknown[]) => write("warn", message, ...args),
  error: (message: string, ...args: unknown[]) => write("error", message, ...args),
}
