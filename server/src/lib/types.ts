import type { EpisodeRow, EpisodeStatus } from "../db/schema.ts"

/** A community-marked non-content range (SponsorBlock). */
export interface SponsorSegment {
  /** Seconds from the start of the episode. */
  start: number
  /** Seconds from the start of the episode. */
  end: number
  /** SponsorBlock category, e.g. "sponsor" or "selfpromo". */
  category: string
}

export interface EpisodeDto {
  id: string
  url: string
  title: string
  author: string
  durationSec: number | null
  status: EpisodeStatus
  stage: string | null
  progress: number | null
  error: string | null
  fileSize: number | null
  positionSec: number
  /** When the episode was finished, or null while it is unfinished. */
  completedAt: number | null
  createdAt: number
  updatedAt: number
  /** Local thumbnail path (authenticated), if the thumbnail was cached on the server. */
  thumbnail: string | null
  /** Original remote thumbnail URL, if any. */
  thumbnailRemote: string | null
  /** Streaming/download URL for the converted audio, when the episode is ready. */
  mediaUrl: string | null
  /** Sponsor/sponsor-like ranges skipped by the player, if any were found. */
  sponsorSegments: SponsorSegment[] | null
}

export const WORKING_STATUSES: EpisodeStatus[] = ["pending", "fetching", "downloading", "converting"]

function parseSegments(raw: string | null): SponsorSegment[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const segments: SponsorSegment[] = []
    for (const item of parsed as Array<Partial<SponsorSegment>>) {
      const start = Number(item?.start)
      const end = Number(item?.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      segments.push({ start, end, category: typeof item?.category === "string" ? item.category : "sponsor" })
    }
    return segments
  } catch {
    return null
  }
}

export function toDto(row: EpisodeRow): EpisodeDto {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    author: row.author,
    durationSec: row.durationSec,
    status: row.status as EpisodeStatus,
    stage: row.stage,
    progress: row.progress,
    error: row.error,
    fileSize: row.fileSize,
    positionSec: row.positionSec,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    thumbnail: row.thumbnailPath ? `/api/thumbnails/${row.id}` : null,
    thumbnailRemote: row.thumbnailUrl,
    mediaUrl: row.status === "ready" ? `/api/media/${row.id}` : null,
    sponsorSegments: parseSegments(row.sponsorSegments),
  }
}
