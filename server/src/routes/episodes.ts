import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { config, dirs } from "../config.ts"
import { db } from "../db/index.ts"
import { episodes } from "../db/schema.ts"
import { broadcast } from "../lib/bus.ts"
import { cancelJob, enqueue, getEpisodeDto } from "../lib/jobs.ts"
import { log } from "../lib/log.ts"
import { toDto } from "../lib/types.ts"

export const episodesRoute = new Hono()

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^(www|m)\./, "").toLowerCase()
    return host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com" || host === "youtube-nocookie.com"
  } catch {
    return false
  }
}

episodesRoute.get("/", (c) => {
  const rows = db.select().from(episodes).orderBy(desc(episodes.createdAt)).all()
  return c.json(rows.map(toDto))
})

episodesRoute.post("/", async (c) => {
  const body = await c.req.json<{ url?: unknown }>().catch(() => null)
  let url = typeof body?.url === "string" ? body.url.trim() : ""
  if (!url) return c.json({ error: "A YouTube URL is required" }, 400)
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!isYouTubeUrl(url)) return c.json({ error: "That does not look like a YouTube URL" }, 400)

  const now = Date.now()
  const id = randomUUID().replaceAll("-", "").slice(0, 16)
  db.insert(episodes).values({ id, url, status: "pending", stage: "Queued", createdAt: now, updatedAt: now }).run()
  log.info(`[${id}] added: ${url}`)
  const dto = getEpisodeDto(id)
  if (!dto) return c.json({ error: "Could not create the episode" }, 500)
  broadcast({ type: "episode", episode: dto })
  enqueue(id)
  return c.json(dto, 201)
})

episodesRoute.get("/:id", (c) => {
  const dto = getEpisodeDto(c.req.param("id"))
  if (!dto) return c.json({ error: "Episode not found" }, 404)
  return c.json(dto)
})

/** Store the playback position so the client can resume later. */
episodesRoute.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ positionSec?: unknown }>().catch(() => null)
  const position =
    typeof body?.positionSec === "number" && Number.isFinite(body.positionSec)
      ? Math.max(0, body.positionSec)
      : null
  if (position === null) return c.json({ error: "positionSec must be a number" }, 400)

  log.debug(`[${id}] position saved at ${Math.round(position)}s`)
  const row = db
    .update(episodes)
    .set({ positionSec: position, updatedAt: Date.now() })
    .where(eq(episodes.id, id))
    .returning()
    .get()
  if (!row) return c.json({ error: "Episode not found" }, 404)
  return c.json(toDto(row))
})

episodesRoute.post("/:id/retry", (c) => {
  const id = c.req.param("id")
  const row = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!row) return c.json({ error: "Episode not found" }, 404)
  if (row.status === "ready") return c.json({ error: "Episode is already downloaded" }, 400)

  log.info(`[${id}] retry requested`)
  cancelJob(id)
  const updated = db
    .update(episodes)
    .set({ status: "pending", stage: "Queued", progress: null, error: null, updatedAt: Date.now() })
    .where(eq(episodes.id, id))
    .returning()
    .get()
  if (!updated) return c.json({ error: "Episode not found" }, 404)
  broadcast({ type: "episode", episode: toDto(updated) })
  enqueue(id)
  return c.json(toDto(updated))
})

episodesRoute.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const row = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!row) return c.json({ error: "Episode not found" }, 404)

  log.info(`[${id}] deleted: "${row.title || row.url}"`)
  cancelJob(id)
  db.delete(episodes).where(eq(episodes.id, id)).run()
  broadcast({ type: "deleted", id })

  await rm(resolve(dirs.media, id), { recursive: true, force: true }).catch(() => {})
  if (row.thumbnailPath) await rm(resolve(config.dataDir, row.thumbnailPath), { force: true }).catch(() => {})
  return c.json({ ok: true })
})
