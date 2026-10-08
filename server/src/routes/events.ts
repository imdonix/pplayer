import { desc } from "drizzle-orm"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { db } from "../db/index.ts"
import { episodes } from "../db/schema.ts"
import { subscribe, subscriberCount, type ServerEvent } from "../lib/bus.ts"
import { log } from "../lib/log.ts"
import { toDto } from "../lib/types.ts"

export const eventsRoute = new Hono()

/**
 * Server-sent events: an initial snapshot, then one "episode" event whenever
 * an episode changes (download/conversion progress, new episodes, deletes).
 */
eventsRoute.get("/", (c) => {
  return streamSSE(c, async (stream) => {
    const send = (event: ServerEvent) => {
      void stream.writeSSE({ event: "message", data: JSON.stringify(event) }).catch(() => {})
    }
    const unsubscribe = subscribe(send)
    stream.onAbort(unsubscribe)
    log.debug(`[sse] client connected (${subscriberCount()} open)`)

    try {
      const rows = db.select().from(episodes).orderBy(desc(episodes.createdAt)).all()
      send({ type: "snapshot", episodes: rows.map(toDto) })

      while (!stream.closed) {
        await stream.sleep(20000)
        if (stream.closed) break
        await stream.writeSSE({ event: "ping", data: "{}" })
      }
    } catch {
      // Client disconnected.
    } finally {
      unsubscribe()
      log.debug(`[sse] client disconnected (${subscriberCount()} open)`)
    }
  })
})
