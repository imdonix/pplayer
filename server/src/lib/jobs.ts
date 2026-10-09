import { eq } from "drizzle-orm"
import { existsSync } from "node:fs"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { config, dirs } from "../config.ts"
import { db } from "../db/index.ts"
import { episodes, type EpisodeStatus } from "../db/schema.ts"
import { broadcast } from "./bus.ts"
import { log } from "./log.ts"
import { toDto } from "./types.ts"

type Subprocess = ReturnType<typeof Bun.spawn>

interface LiveJob {
  child: Subprocess | null
  cancel: boolean
}

const queue: string[] = []
const live = new Map<string, LiveJob>()
/** Ids that were enqueued while a cancelled job was still winding down. */
const requeue = new Set<string>()
let pumping = false

/** Add an episode to the processing queue (one job runs at a time). */
export function enqueue(id: string): void {
  const job = live.get(id)
  if (job) {
    // A job is running (or dying). If it was cancelled, run this one after it exits.
    if (job.cancel) requeue.add(id)
    return
  }
  if (!queue.includes(id)) {
    queue.push(id)
    log.debug(`[${id}] queued (${queue.length} waiting)`)
  }
  void pump()
}

/** Kill a running job and drop it from the queue. */
export function cancelJob(id: string): void {
  const job = live.get(id)
  if (job) {
    job.cancel = true
    try {
      job.child?.kill()
    } catch {
      // already dead
    }
    log.warn(`[${id}] cancelled`)
  }
  const index = queue.indexOf(id)
  if (index >= 0) {
    queue.splice(index, 1)
    log.warn(`[${id}] removed from queue`)
  }
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      const job: LiveJob = { child: null, cancel: false }
      live.set(id, job)
      try {
        await processEpisode(id, job)
      } catch (err) {
        if (!job.cancel) fail(id, err)
      } finally {
        live.delete(id)
        // If the episode was enqueued again while this (cancelled) job was dying,
        // run it now.
        if (requeue.delete(id) && !queue.includes(id)) queue.push(id)
      }
    }
  } finally {
    pumping = false
  }
}

function getRow(id: string) {
  return db.select().from(episodes).where(eq(episodes.id, id)).get()
}

export function getEpisodeDto(id: string) {
  const row = getRow(id)
  return row ? toDto(row) : null
}

function update(id: string, patch: Partial<typeof episodes.$inferInsert>, broadcastUpdate = true) {
  const row = db
    .update(episodes)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(episodes.id, id))
    .returning()
    .get()
  if (row && broadcastUpdate) broadcast({ type: "episode", episode: toDto(row) })
  return row
}

function fail(id: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  log.error(`[${id}] failed: ${message}`)
  update(id, { status: "error", stage: null, progress: null, error: message.slice(0, 800) })
}

function stageReporter(id: string, status: EpisodeStatus, stage: string) {
  update(id, { status, stage, progress: null, error: null })
  let lastBroadcast = 0
  return (progress: number | null, force = false) => {
    const now = Date.now()
    if (!force && now - lastBroadcast < 600) return
    lastBroadcast = now
    update(id, { progress })
  }
}

async function processEpisode(id: string, job: LiveJob): Promise<void> {
  const row = getRow(id)
  if (!row) return

  const dir = resolve(dirs.media, id)
  await mkdir(dir, { recursive: true })
  log.info(`[${id}] processing ${row.url}`)

  // 1. Fetch video metadata with yt-dlp
  stageReporter(id, "fetching", "Fetching video info")(null, true)
  const meta = await fetchMetadata(row.url, job)
  if (job.cancel) return
  update(id, {
    title: meta.title,
    author: meta.author,
    durationSec: meta.duration,
    thumbnailUrl: meta.thumbnail,
  })
  log.info(
    `[${id}] video: "${meta.title}"${meta.author ? ` by ${meta.author}` : ""}` +
      `${meta.duration ? ` (${Math.round(meta.duration / 60)} min)` : ""}`,
  )

  // Cache the thumbnail locally (best effort) so the library also works offline.
  if (meta.thumbnail) {
    try {
      const response = await fetch(meta.thumbnail)
      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? ""
        const ext = contentType.includes("webp") ? "webp" : contentType.includes("png") ? "png" : "jpg"
        const relative = `thumbs/${id}.${ext}`
        await writeFile(resolve(config.dataDir, relative), Buffer.from(await response.arrayBuffer()))
        update(id, { thumbnailPath: relative })
        log.debug(`[${id}] thumbnail cached (${ext})`)
      }
    } catch (err) {
      log.debug(`[${id}] thumbnail download failed (ignored): ${err instanceof Error ? err.message : err}`)
    }
  }
  if (job.cancel) return

  // 2. Download the best audio-only stream
  const reportDownload = stageReporter(id, "downloading", "Downloading audio")
  const downloadStarted = Date.now()
  log.info(`[${id}] downloading audio with yt-dlp…`)
  const source = await downloadAudio(row.url, dir, job, (progress) => reportDownload(progress))
  if (job.cancel) return
  reportDownload(1, true)
  const sourceSize = await stat(source).then((info) => info.size).catch(() => 0)
  log.info(
    `[${id}] downloaded ${formatMb(sourceSize)} in ${elapsed(downloadStarted)} (${basename(source)})`,
  )

  // 3. Convert / remux to M4A (AAC) which plays everywhere, including iOS
  const duration = meta.duration ?? getRow(id)?.durationSec ?? null
  const reportConvert = stageReporter(id, "converting", "Converting to M4A")
  const output = resolve(dir, "audio.m4a")
  const convertStarted = Date.now()
  await convertToM4a(id, source, output, duration, job, (progress) => reportConvert(progress))
  if (job.cancel) return
  reportConvert(1, true)
  log.info(`[${id}] converted in ${elapsed(convertStarted)}`)

  await rm(source, { force: true }).catch(() => {})

  const info = await stat(output)
  update(id, {
    status: "ready",
    stage: null,
    progress: 1,
    error: null,
    filePath: `media/${id}/audio.m4a`,
    fileSize: info.size,
  })
  log.info(`[${id}] ready: "${meta.title}" (${formatMb(info.size)})`)
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function elapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

interface VideoMeta {
  title: string
  author: string
  duration: number | null
  thumbnail: string | null
}

function cookieArgs(): string[] {
  return config.cookiesFile && existsSync(config.cookiesFile) ? ["--cookies", config.cookiesFile] : []
}

async function fetchMetadata(url: string, job: LiveJob): Promise<VideoMeta> {
  const args = ["-J", "--no-playlist", "--playlist-items", "1", "--no-warnings", ...cookieArgs(), url]
  const proc = Bun.spawn([config.ytDlpBin, ...args], { stdout: "pipe", stderr: "pipe" })
  job.child = proc
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  job.child = null
  if (job.cancel) return { title: "", author: "", duration: null, thumbnail: null }
  if (code !== 0) throw new Error(ytError(stderr) ?? `yt-dlp exited with code ${code}`)

  let json: any
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error("Could not parse the video info returned by yt-dlp")
  }
  if (json?._type === "playlist" && Array.isArray(json.entries)) {
    json = json.entries.find((entry: unknown) => entry) ?? json
  }
  if (!json || typeof json !== "object") throw new Error("No video found for this URL")

  const thumbnail =
    json.thumbnail ??
    (Array.isArray(json.thumbnails)
      ? [...json.thumbnails].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
      : null)

  return {
    title: typeof json.title === "string" && json.title.trim() ? json.title.trim() : "Untitled",
    author: [json.uploader, json.channel].find((value) => typeof value === "string" && value.trim()) ?? "",
    duration: typeof json.duration === "number" && Number.isFinite(json.duration) ? Math.round(json.duration) : null,
    thumbnail: typeof thumbnail === "string" ? thumbnail : null,
  }
}

async function downloadAudio(
  url: string,
  dir: string,
  job: LiveJob,
  onProgress: (progress: number) => void,
): Promise<string> {
  const args = [
    "--no-playlist",
    "--playlist-items", "1",
    "--newline",
    "--no-warnings",
    "--force-overwrites",
    // Prefer YouTube's AAC stream (m4a): it can be remuxed instead of
    // transcoded, turning minutes of ffmpeg work into milliseconds.
    "-f", "bestaudio[ext=m4a]/bestaudio/best",
    "-o", resolve(dir, "source.%(ext)s"),
    ...cookieArgs(),
    url,
  ]
  const proc = Bun.spawn([config.ytDlpBin, ...args], { stdout: "pipe", stderr: "pipe" })
  job.child = proc
  const stderrTail: string[] = []
  await Promise.all([
    readLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
      const match = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line)
      if (match) onProgress(Number(match[1]) / 100)
    }),
    readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => pushTail(stderrTail, line)),
  ])
  const code = await proc.exited
  job.child = null
  if (job.cancel) return resolve(dir, "source.missing")
  if (code !== 0) throw new Error(ytError(stderrTail.join("\n")) ?? `Download failed (yt-dlp exit code ${code})`)

  const files = (await readdir(dir)).filter((file) => file.startsWith("source.") && !file.endsWith(".part"))
  if (files.length === 0) throw new Error("yt-dlp finished but no audio file was found")
  return resolve(dir, files[0])
}

const COPY_EXTENSIONS = new Set([".m4a", ".mp4", ".aac"])

async function convertToM4a(
  id: string,
  source: string,
  output: string,
  duration: number | null,
  job: LiveJob,
  onProgress: (progress: number) => void,
): Promise<void> {
  const ext = source.slice(source.lastIndexOf(".")).toLowerCase()
  // YouTube's M4A streams are already AAC, so a remux is enough. Anything else
  // (webm/opus, etc.) is transcoded to AAC.
  const copy = COPY_EXTENSIONS.has(ext)
  log.info(`[${id}] ffmpeg: ${copy ? "remuxing (stream copy)" : "transcoding to AAC 192k"}`)
  // Opus/WebM sources must be transcoded. The fast AAC coder roughly halves
  // that (benchmark: 30 min of audio ≈ 57s → 30s) with a negligible quality
  // difference at 192 kbps.
  const codecArgs = copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-aac_coder", "fast"]
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", source,
    "-vn",
    ...codecArgs,
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    output,
  ]
  const proc = Bun.spawn([config.ffmpegBin, ...args], { stdout: "pipe", stderr: "pipe" })
  job.child = proc
  const stderrTail: string[] = []
  await Promise.all([
    readLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
      // Note: ffmpeg reports both out_time_us and out_time_ms in microseconds.
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line)
      if (match && duration && duration > 0) {
        const seconds = Number(match[1]) / 1_000_000
        onProgress(Math.min(0.995, seconds / duration))
      }
    }),
    readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
      if (line.trim()) pushTail(stderrTail, line)
    }),
  ])
  const code = await proc.exited
  job.child = null
  if (job.cancel) return
  if (code !== 0) {
    throw new Error(stderrTail.at(-1)?.trim() || `Audio conversion failed (ffmpeg exit code ${code})`)
  }
  if (!existsSync(output)) throw new Error("Conversion finished but the output file is missing")
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
    }
    if (buffer.length > 65536) buffer = buffer.slice(-8192)
  }
  if (buffer.trim()) onLine(buffer)
}

function pushTail(lines: string[], line: string): void {
  if (!line.trim()) return
  lines.push(line)
  if (lines.length > 40) lines.shift()
}

function ytError(stderr: string): string | null {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean)
  const errorLine = [...lines].reverse().find((line) => /^ERROR:/i.test(line))
  const line = errorLine ?? lines.at(-1)
  if (!line) return null
  return line.replace(/^ERROR:\s*/i, "").slice(0, 500)
}
