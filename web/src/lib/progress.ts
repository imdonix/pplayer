import type { Episode } from "@/lib/types"

/**
 * Playback positions that still have to reach the server. They are queued
 * locally (localStorage, so they survive closing the app) while offline and
 * pushed as soon as the connection is back.
 */
const PENDING_STORAGE = "pplayer:pending-positions"

export interface PendingPosition {
  id: string
  positionSec: number
  /** true = finished, false = (re)started, null = a plain progress tick. */
  completed: boolean | null
  /** Client timestamp of the most recent local change (newest wins). */
  updatedAt: number
  /** Server `updatedAt` echoed by the last accepted PATCH, if any. */
  serverUpdatedAt?: number
}

function read(): PendingPosition[] {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as PendingPosition[]) : []
  } catch {
    return []
  }
}

function write(entries: PendingPosition[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(PENDING_STORAGE)
    else localStorage.setItem(PENDING_STORAGE, JSON.stringify(entries))
  } catch {
    // Storage unavailable (private mode, full, ...) - the live PATCH still works.
  }
}

export function listPending(): PendingPosition[] {
  return read()
}

/** Remember the latest position for an episode until the server has it. */
export function queuePosition(id: string, positionSec: number, completed: boolean | null): void {
  const entries = read().filter((entry) => entry.id !== id)
  entries.push({ id, positionSec, completed, updatedAt: Date.now() })
  write(entries)
}

export function dropPending(id: string): void {
  const entries = read()
  const next = entries.filter((entry) => entry.id !== id)
  if (next.length !== entries.length) write(next)
}

/**
 * Mark a queued position as accepted by the server. The entry is kept until a
 * server read confirms it, so a refresh that raced the PATCH cannot wipe it.
 * Ignored when a newer change was queued while the push was in flight.
 */
export function markPendingSynced(id: string, clientUpdatedAt: number, serverUpdatedAt: number): void {
  const entries = read()
  const index = entries.findIndex((entry) => entry.id === id)
  if (index === -1 || entries[index].updatedAt !== clientUpdatedAt) return
  entries[index] = { ...entries[index], serverUpdatedAt }
  write(entries)
}

/**
 * Reconcile the queue against a full server list: drop positions the server
 * has confirmed (its timestamp caught up) and episodes that no longer exist.
 * Returns the entries that are still pending.
 */
export function reconcilePending(incoming: Episode[]): PendingPosition[] {
  const byId = new Map(incoming.map((episode) => [episode.id, episode]))
  const entries = read()
  const next = entries.filter((entry) => {
    const server = byId.get(entry.id)
    if (!server) return false
    if (entry.serverUpdatedAt != null && server.updatedAt >= entry.serverUpdatedAt) return false
    return true
  })
  if (next.length !== entries.length) write(next)
  return next
}

/** Confirm a single episode without touching unrelated pending entries. */
export function confirmPending(incoming: Episode): PendingPosition | null {
  const entries = read()
  const index = entries.findIndex((entry) => entry.id === incoming.id)
  if (index === -1) return null
  const entry = entries[index]
  if (entry.serverUpdatedAt != null && incoming.updatedAt >= entry.serverUpdatedAt) {
    entries.splice(index, 1)
    write(entries)
    return null
  }
  return entry
}

/** Overlay a queued position on top of server data for display. */
export function withPending(episode: Episode, entry: PendingPosition): Episode {
  const next: Episode = { ...episode, positionSec: entry.positionSec }
  if (entry.completed === true) next.completedAt = entry.updatedAt
  else if (entry.completed === false || entry.positionSec > 5) next.completedAt = null
  return next
}
