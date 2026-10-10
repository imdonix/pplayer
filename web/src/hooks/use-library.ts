import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiError, withToken } from "@/lib/api"
import {
  confirmPending,
  dropPending,
  listPending,
  markPendingSynced,
  queuePosition,
  reconcilePending,
  withPending,
} from "@/lib/progress"
import type { Episode, ServerEvent } from "@/lib/types"

const LIBRARY_STORAGE = "pplayer:library"

/** Last known library, so the app still works when the server is unreachable. */
function loadCachedEpisodes(): Episode[] {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Episode[]) : []
  } catch {
    return []
  }
}

/**
 * Keeps the episode library in sync: initial fetch, live updates over SSE,
 * and polling fallback when the event stream is unavailable.
 */
export function useLibrary(onUnauthorized: () => void) {
  const [episodes, setEpisodes] = useState<Episode[]>(loadCachedEpisodes)
  const [connected, setConnected] = useState(false)
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  // Remember the library so a reload while offline still shows the episodes
  // (and the ones saved on the device can be played from IndexedDB).
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_STORAGE, JSON.stringify(episodes))
    } catch {
      // Storage full or unavailable — the live API still works.
    }
  }, [episodes])

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) unauthorizedRef.current()
  }, [])

  const flushingRef = useRef(false)

  /**
   * Push any positions queued while offline. A successful PATCH only marks the
   * entry as accepted; it is dropped once a server read confirms it, so a
   * refresh that raced the request can never wipe the local progress.
   */
  const flushPending = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      for (;;) {
        const entries = listPending().filter((entry) => entry.serverUpdatedAt == null)
        if (entries.length === 0) break
        let failed = false
        let progressed = false
        for (const entry of entries) {
          try {
            const episode = await api<Episode>(`/api/episodes/${entry.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                positionSec: entry.positionSec,
                ...(entry.completed === null ? {} : { completed: entry.completed }),
              }),
            })
            markPendingSynced(entry.id, entry.updatedAt, episode.updatedAt)
            progressed = true
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
              unauthorizedRef.current()
              return
            }
            // The episode is gone server-side; there is nothing left to save.
            if (error instanceof ApiError && error.status === 404) {
              dropPending(entry.id)
              progressed = true
              continue
            }
            // Offline or transient: keep it for the next attempt.
            failed = true
          }
        }
        // New positions may have been queued while we were pushing.
        if (failed || !progressed) break
      }
    } finally {
      flushingRef.current = false
    }
  }, [])

  /** Merge a full server list with locally queued positions. */
  const applyServerEpisodes = useCallback((incoming: Episode[]) => {
    const pending = new Map(reconcilePending(incoming).map((entry) => [entry.id, entry]))
    setEpisodes(
      pending.size === 0
        ? incoming
        : incoming.map((episode) => {
            const entry = pending.get(episode.id)
            return entry ? withPending(episode, entry) : episode
          }),
    )
  }, [])

  /** Merge a single server update (SSE) with any queued position for it. */
  const applyServerEpisode = useCallback((incoming: Episode) => {
    const entry = confirmPending(incoming)
    const merged = entry ? withPending(incoming, entry) : incoming
    setEpisodes((previous) => {
      const index = previous.findIndex((episode) => episode.id === incoming.id)
      if (index === -1) return [merged, ...previous]
      const next = [...previous]
      next[index] = merged
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await api<Episode[]>("/api/episodes")
      applyServerEpisodes(list)
      // A reachable server also means we can push anything still queued.
      void flushPending()
    } catch (error) {
      handleError(error)
    }
  }, [applyServerEpisodes, flushPending, handleError])

  useEffect(() => {
    void refresh()

    let source: EventSource | null = null
    let reconnectTimer: number | undefined
    let disposed = false

    const handleMessage = (message: MessageEvent) => {
      try {
        const payload = JSON.parse(message.data) as ServerEvent
        if (payload.type === "snapshot") {
          applyServerEpisodes(payload.episodes)
        } else if (payload.type === "episode") {
          applyServerEpisode(payload.episode)
        } else if (payload.type === "deleted") {
          setEpisodes((previous) => previous.filter((episode) => episode.id !== payload.id))
        }
      } catch {
        // Ignore malformed events.
      }
    }

    const connect = () => {
      if (disposed) return
      source = new EventSource(withToken("/api/events"))
      source.onopen = () => {
        setConnected(true)
        void flushPending()
      }
      source.onmessage = handleMessage
      source.onerror = () => {
        setConnected(false)
        // Transient drops reconnect on their own, but a fatal error (e.g. a
        // 502 while the server restarts) closes the stream for good — recreate
        // it so live updates come back without a page reload.
        if (source && source.readyState === EventSource.CLOSED) {
          source.close()
          source = null
          window.clearTimeout(reconnectTimer)
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [refresh, applyServerEpisodes, applyServerEpisode, flushPending])

  // Push queued positions on mount and whenever the connection comes back.
  useEffect(() => {
    void flushPending()
  }, [flushPending])

  useEffect(() => {
    if (connected) void flushPending()
  }, [connected, flushPending])

  useEffect(() => {
    const onOnline = () => void flushPending()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [flushPending])

  // Poll while the stream is down (server restarting, phone just woke up, ...).
  useEffect(() => {
    if (connected) return
    const timer = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(timer)
  }, [connected, refresh])

  // Catch up immediately when the app becomes visible again.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh()
        void flushPending()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [refresh, flushPending])

  const addEpisode = useCallback(async (url: string) => {
    const episode = await api<Episode>("/api/episodes", {
      method: "POST",
      body: JSON.stringify({ url }),
    })
    setEpisodes((previous) =>
      previous.some((item) => item.id === episode.id) ? previous : [episode, ...previous],
    )
    return episode
  }, [])

  const deleteEpisode = useCallback(async (id: string) => {
    await api(`/api/episodes/${id}`, { method: "DELETE" })
    dropPending(id)
    setEpisodes((previous) => previous.filter((episode) => episode.id !== id))
  }, [])

  const retryEpisode = useCallback(async (id: string) => {
    const episode = await api<Episode>(`/api/episodes/${id}/retry`, { method: "POST" })
    setEpisodes((previous) => previous.map((item) => (item.id === id ? episode : item)))
  }, [])

  const savePosition = useCallback((id: string, positionSec: number, completed?: boolean) => {
    // Keep the local list in step immediately: starting an episode again marks
    // it unfinished, finishing it (position 0 + completed) files it under
    // "Watched" without waiting for the next server refresh.
    setEpisodes((previous) =>
      previous.map((item) => {
        if (item.id !== id) return item
        const next: Episode = { ...item, positionSec, updatedAt: Date.now() }
        if (completed === true) next.completedAt = Date.now()
        else if (completed === false || positionSec > 5) next.completedAt = null
        return next
      }),
    )
    // Queue the change (survives offline + app restarts) and try to push it now.
    queuePosition(id, positionSec, completed === undefined ? null : completed)
    void flushPending()
  }, [flushPending])

  return { episodes, connected, refresh, addEpisode, deleteEpisode, retryEpisode, savePosition }
}
