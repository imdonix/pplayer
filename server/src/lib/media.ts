import type { Context } from "hono"
import { resolve } from "node:path"
import { config } from "../config.ts"

const MIME: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

export function mimeForFile(filePath: string): string {
  const dot = filePath.lastIndexOf(".")
  if (dot === -1) return "application/octet-stream"
  return MIME[filePath.slice(dot).toLowerCase()] ?? "application/octet-stream"
}

/** Resolve a path stored in the DB against the data dir, guarding against traversal. */
export function dataFile(relativePath: string): string {
  const absolute = resolve(config.dataDir, relativePath)
  if (absolute !== config.dataDir && !absolute.startsWith(config.dataDir + "/")) {
    throw new Error("Invalid data path")
  }
  return absolute
}

/**
 * Stream a file with HTTP Range support (needed for seeking in <audio> and for
 * iOS Safari, which always sends Range requests).
 */
export async function serveFile(c: Context, filePath: string, cache = "private, max-age=3600"): Promise<Response> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return c.json({ error: "File not found" }, 404)

  const size = file.size
  const headers: Record<string, string> = {
    "Content-Type": mimeForFile(filePath),
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
  }

  const rangeHeader = c.req.header("range")
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
    }
    const [, startRaw = "", endRaw = ""] = match
    let start: number
    let end: number
    if (startRaw === "" && endRaw !== "") {
      // Suffix range: the last N bytes.
      start = Math.max(0, size - Number(endRaw))
      end = size - 1
    } else {
      start = startRaw === "" ? 0 : Number(startRaw)
      end = endRaw === "" ? size - 1 : Number(endRaw)
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
    }
    end = Math.min(end, size - 1)
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`
    headers["Content-Length"] = String(end - start + 1)
    if (c.req.method === "HEAD") return new Response(null, { status: 206, headers })
    return new Response(file.slice(start, end + 1).stream(), { status: 206, headers })
  }

  headers["Content-Length"] = String(size)
  if (c.req.method === "HEAD") return new Response(null, { status: 200, headers })
  return new Response(file.stream(), { status: 200, headers })
}
