export type EpisodeStatus = "pending" | "fetching" | "downloading" | "converting" | "ready" | "error"

/** A community-marked non-content range (SponsorBlock). */
export interface SponsorSegment {
  start: number
  end: number
  category: string
}

export interface Episode {
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
  /** When the episode was last played to the end; null while unfinished. */
  completedAt: number | null
  createdAt: number
  updatedAt: number
  thumbnail: string | null
  thumbnailRemote: string | null
  mediaUrl: string | null
  /** Sponsor ranges the player can skip (null = none found / older cache). */
  sponsorSegments?: SponsorSegment[] | null
}

export type ServerEvent =
  | { type: "snapshot"; episodes: Episode[] }
  | { type: "episode"; episode: Episode }
  | { type: "deleted"; id: string }

export const WORKING_STATUSES: EpisodeStatus[] = ["pending", "fetching", "downloading", "converting"]

export function isWorking(episode: Episode): boolean {
  return WORKING_STATUSES.includes(episode.status)
}
