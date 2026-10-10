import { createHash } from "node:crypto"
import { config } from "../config.ts"
import type { SponsorSegment } from "./types.ts"

/**
 * Fetch community-marked sponsor segments for a YouTube video from the
 * official SponsorBlock API. Returns an empty list when the video has none or
 * the API answers 404; throws on other errors so the caller can log and move on.
 *
 * The API is queried with a short SHA-256 prefix of the video id (its privacy
 * scheme), so the response can contain several videos and is filtered here.
 */
export async function fetchSponsorSegments(videoId: string): Promise<SponsorSegment[]> {
  const prefix = createHash("sha256").update(videoId).digest("hex").slice(0, 4)
  const params = new URLSearchParams({
    categories: JSON.stringify(config.sponsorBlockCategories),
  })
  const url = `${config.sponsorBlockApi}/api/skipSegments/${prefix}?${params}`

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "pplayer/0.1.0 (+https://github.com/imdonix/pplayer)",
    },
    // Never let a slow SponsorBlock response stall the download.
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`SponsorBlock API returned ${response.status}`)

  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) return []

  // A hash prefix matches many videos; keep only the one we asked about.
  const match = (data as Array<Record<string, unknown>>).find((entry) => entry?.videoID === videoId)
  const raw = match?.segments
  if (!Array.isArray(raw)) return []

  const segments: SponsorSegment[] = []
  for (const item of raw as Array<Record<string, unknown>>) {
    // "skip" is the auto-skippable action; "mute" and "full" behave differently.
    const actionType = item?.actionType
    if (typeof actionType === "string" && actionType !== "skip") continue

    const range = item?.segment
    if (!Array.isArray(range) || range.length < 2) continue
    const start = Number(range[0])
    const end = Number(range[1])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

    segments.push({
      start,
      end,
      category: typeof item?.category === "string" ? item.category : "sponsor",
    })
  }

  segments.sort((a, b) => a.start - b.start)
  return segments
}
