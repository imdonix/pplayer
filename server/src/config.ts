import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { log } from "./lib/log.ts"

const serverRoot = resolve(import.meta.dir, "..")

function envPath(name: string, fallback: string): string {
  const value = process.env[name]
  return value ? resolve(value) : fallback
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: envPath("DATA_DIR", resolve(serverRoot, "data")),
  webDir: envPath("WEB_DIR", resolve(serverRoot, "../web/dist")),
  ytDlpBin: process.env.YTDLP_BIN ?? "yt-dlp",
  ffmpegBin: process.env.FFMPEG_BIN ?? "ffmpeg",
  cookiesFile: process.env.YTDLP_COOKIES ? resolve(process.env.YTDLP_COOKIES) : "",
}

export const dirs = {
  media: resolve(config.dataDir, "media"),
  thumbs: resolve(config.dataDir, "thumbs"),
}

for (const dir of [config.dataDir, dirs.media, dirs.thumbs]) {
  mkdirSync(dir, { recursive: true })
}

function loadApiKey(): string {
  const fromEnv = process.env.API_KEY?.trim()
  if (fromEnv) return fromEnv

  const keyFile = resolve(config.dataDir, "api-key.txt")
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim()

  const key = randomBytes(16).toString("hex")
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 })
  log.warn(
    `No API_KEY environment variable set. Generated one for you:\n\n    ${key}\n\n` +
      `  It is stored in ${keyFile} and will be reused on the next start.`,
  )
  return key
}

export const apiKey = loadApiKey()

/** Constant-time-ish string comparison so the API key is not leaked through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
