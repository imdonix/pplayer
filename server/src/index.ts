import { eq, inArray } from "drizzle-orm"
import { existsSync } from "node:fs"
import { serveStatic } from "hono/bun"
import { Hono } from "hono"
import { apiKey, config, safeEqual } from "./config.ts"
import { db, initDb } from "./db/index.ts"
import { episodes } from "./db/schema.ts"
import { enqueue } from "./lib/jobs.ts"
import { log } from "./lib/log.ts"
import { authRoute } from "./routes/auth.ts"
import { episodesRoute } from "./routes/episodes.ts"
import { eventsRoute } from "./routes/events.ts"
import { mediaRoute } from "./routes/media.ts"

initDb()

const app = new Hono()

// Request log. Noisy endpoints (media ranges, thumbnails, SSE) log at debug
// level; everything else logs at info/warn/error with status and duration.
app.use("*", async (c, next) => {
  const started = performance.now()
  await next()
  const path = c.req.path
  if (!path.startsWith("/api/")) return

  const line = `${c.req.method} ${path} ${c.res.status} ${Math.round(performance.now() - started)}ms`
  const noisy =
    path.startsWith("/api/media") ||
    path.startsWith("/api/thumbnails") ||
    path.startsWith("/api/events") ||
    c.req.method === "PATCH" // playback position saves

  if (noisy) log.debug(line)
  else if (c.res.status >= 500) log.error(line)
  else if (c.res.status >= 400) log.warn(line)
  else log.info(line)
})

// Single API-key auth for everything under /api except health and login.
// Media requests may pass the key as a `token` query param because <audio>
// elements and EventSource cannot send Authorization headers.
app.use("/api/*", async (c, next) => {
  const path = c.req.path
  if (path === "/api/health" || path === "/api/auth/login") return next()

  const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? ""
  const token = bearer || c.req.query("token") || ""
  if (!token || !safeEqual(token, apiKey)) return c.json({ error: "Unauthorized" }, 401)
  return next()
})

app.get("/api/health", (c) => c.json({ ok: true, name: "pplayer" }))
app.route("/api/auth", authRoute)
app.route("/api/episodes", episodesRoute)
app.route("/api/events", eventsRoute)
app.route("/api", mediaRoute)

// Unknown API routes must not fall through to the SPA.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))

app.onError((err, c) => {
  log.error(`unhandled error on ${c.req.method} ${c.req.path}:`, err)
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500)
})

// Serve the built SPA (if present).
if (existsSync(config.webDir)) {
  app.use("*", serveStatic({ root: config.webDir }))
  // SPA fallback: unknown paths get index.html.
  app.get("*", serveStatic({ root: config.webDir, rewriteRequestPath: () => "index.html" }))
} else {
  app.get("*", (c) =>
    c.text(
      "pplayer API is running, but the web UI has not been built yet.\n" +
        "Build it with `bun run build` inside web/, or use the Vite dev server during development.",
    ),
  )
}

/** Log the versions of the external tools so problems are visible in `docker logs`. */
async function logToolVersions(): Promise<void> {
  const tools: Array<{ name: string; bin: string; args: string[] }> = [
    { name: "yt-dlp", bin: config.ytDlpBin, args: ["--version"] },
    { name: "ffmpeg", bin: config.ffmpegBin, args: ["-version"] },
  ]
  for (const tool of tools) {
    try {
      const proc = Bun.spawn([tool.bin, ...tool.args], { stdout: "pipe", stderr: "ignore" })
      const firstLine = (await new Response(proc.stdout).text()).split("\n")[0]?.trim() ?? ""
      const code = await proc.exited
      if (code !== 0) throw new Error(`exit code ${code}`)
      log.info(`  ${tool.name}: ${firstLine.replace(/ Copyright.*$/, "")} (${tool.bin})`)
    } catch {
      const variable = tool.name === "yt-dlp" ? "YTDLP_BIN" : "FFMPEG_BIN"
      log.error(`  ${tool.name}: NOT FOUND ("${tool.bin}") — downloads will fail. Install it or set ${variable}.`)
    }
  }
}

log.info("pplayer starting")
log.info(`  data dir: ${config.dataDir}`)
log.info(`  web dir : ${config.webDir}${existsSync(config.webDir) ? "" : " (not built — API only)"}`)
log.info(`  log level: ${log.level}`)
await logToolVersions()

// Resume jobs that were interrupted by a restart.
const interrupted = db
  .select()
  .from(episodes)
  .where(inArray(episodes.status, ["pending", "fetching", "downloading", "converting"]))
  .all()
for (const row of interrupted) {
  log.warn(`[${row.id}] interrupted by restart — requeueing ("${row.title || row.url}")`)
  db.update(episodes)
    .set({ status: "pending", stage: "Queued", progress: null, updatedAt: Date.now() })
    .where(eq(episodes.id, row.id))
    .run()
  enqueue(row.id)
}

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // SSE connections stay open; the default 10s idle timeout would kill them.
  idleTimeout: 255,
})

log.info(`listening on http://localhost:${server.port}`)
