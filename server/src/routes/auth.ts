import { Hono } from "hono"
import { getConnInfo } from "hono/bun"
import { apiKey, safeEqual } from "../config.ts"
import { log } from "../lib/log.ts"

export const authRoute = new Hono()

authRoute.post("/login", async (c) => {
  const body = await c.req.json<{ key?: unknown }>().catch(() => null)
  const key = typeof body?.key === "string" ? body.key : ""
  if (!key || !safeEqual(key, apiKey)) {
    let remote = "unknown"
    try {
      remote = getConnInfo(c).remote.address ?? "unknown"
    } catch {
      // Conn info is unavailable in some setups.
    }
    log.warn(`login failed (wrong API key) from ${remote}`)
    return c.json({ error: "Invalid API key" }, 401)
  }
  log.info("login successful")
  return c.json({ ok: true })
})
