import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "../db/index.ts"
import { episodes } from "../db/schema.ts"
import { dataFile, serveFile } from "../lib/media.ts"

export const mediaRoute = new Hono()

mediaRoute.on(["GET", "HEAD"], "/media/:id", async (c) => {
  const row = db.select().from(episodes).where(eq(episodes.id, c.req.param("id"))).get()
  if (!row || row.status !== "ready" || !row.filePath) {
    return c.json({ error: "Audio is not available" }, 404)
  }
  return serveFile(c, dataFile(row.filePath))
})

mediaRoute.on(["GET", "HEAD"], "/thumbnails/:id", async (c) => {
  const row = db.select().from(episodes).where(eq(episodes.id, c.req.param("id"))).get()
  if (!row || !row.thumbnailPath) {
    return c.json({ error: "Thumbnail is not available" }, 404)
  }
  return serveFile(c, dataFile(row.thumbnailPath), "private, max-age=86400")
})
