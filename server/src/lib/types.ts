import type { EpisodeRow, EpisodeStatus } from "../db/schema.ts"

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
  createdAt: number
  updatedAt: number
  /** Local thumbnail path (authenticated), if the thumbnail was cached on the server. */
  thumbnail: string | null
  /** Original remote thumbnail URL, if any. */
  thumbnailRemote: string | null
  /** Streaming/download URL for the converted audio, when the episode is ready. */
  mediaUrl: string | null
}

export const WORKING_STATUSES: EpisodeStatus[] = ["pending", "fetching", "downloading", "converting"]

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    thumbnail: row.thumbnailPath ? `/api/thumbnails/${row.id}` : null,
    thumbnailRemote: row.thumbnailUrl,
    mediaUrl: row.status === "ready" ? `/api/media/${row.id}` : null,
  }
}
