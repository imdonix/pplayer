import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiError, withToken } from "@/lib/api"
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

  const refresh = useCallback(async () => {
    try {
      const list = await api<Episode[]>("/api/episodes")
      setEpisodes(list)
    } catch (error) {
      handleError(error)
    }
  }, [handleError])

  useEffect(() => {
    void refresh()

    const source = new EventSource(withToken("/api/events"))
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as ServerEvent
        if (payload.type === "snapshot") {
          setEpisodes(payload.episodes)
        } else if (payload.type === "episode") {
          setEpisodes((previous) => {
            const index = previous.findIndex((episode) => episode.id === payload.episode.id)
            if (index === -1) return [payload.episode, ...previous]
            const next = [...previous]
            next[index] = payload.episode
            return next
          })
        } else if (payload.type === "deleted") {
          setEpisodes((previous) => previous.filter((episode) => episode.id !== payload.id))
        }
      } catch {
        // Ignore malformed events.
      }
    }

    return () => source.close()
  }, [refresh])

  // Poll while the stream is down (server restarted, phone woke up, ...).
  useEffect(() => {
    if (connected) return
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [connected, refresh])

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
    setEpisodes((previous) => previous.filter((episode) => episode.id !== id))
  }, [])

  const retryEpisode = useCallback(async (id: string) => {
    const episode = await api<Episode>(`/api/episodes/${id}/retry`, { method: "POST" })
    setEpisodes((previous) => previous.map((item) => (item.id === id ? episode : item)))
  }, [])

  const savePosition = useCallback((id: string, positionSec: number) => {
    api(`/api/episodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ positionSec }),
    }).catch(() => {})
  }, [])

  return { episodes, connected, refresh, addEpisode, deleteEpisode, retryEpisode, savePosition }
}
