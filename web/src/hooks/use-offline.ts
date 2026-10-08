import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { withToken } from "@/lib/api"
import { listOffline, removeOffline, requestPersistence, saveOffline, type OfflineMeta } from "@/lib/offline"
import type { Episode } from "@/lib/types"

/** Manages "downloaded to this device" episodes stored in IndexedDB. */
export function useOffline() {
  const [offline, setOffline] = useState<Record<string, OfflineMeta>>({})
  /** episode id -> download progress (null = indeterminate) while saving */
  const [busy, setBusy] = useState<Record<string, number | null>>({})

  const refresh = useCallback(async () => {
    try {
      const metas = await listOffline()
      setOffline(Object.fromEntries(metas.map((meta) => [meta.id, meta])))
    } catch {
      // IndexedDB unavailable (private mode, ...) - offline saving is disabled.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async (episode: Episode) => {
    if (!episode.mediaUrl) return
    setBusy((previous) => ({ ...previous, [episode.id]: 0 }))
    try {
      await requestPersistence()
      const meta = await saveOffline(
        episode.id,
        episode.title || "Untitled",
        withToken(episode.mediaUrl),
        (progress) => setBusy((previous) => ({ ...previous, [episode.id]: progress })),
      )
      setOffline((previous) => ({ ...previous, [episode.id]: meta }))
      toast.success("Saved for offline listening")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save episode offline")
    } finally {
      setBusy((previous) => {
        const next = { ...previous }
        delete next[episode.id]
        return next
      })
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    try {
      await removeOffline(id)
      setOffline((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      toast("Offline copy removed")
    } catch {
      toast.error("Could not remove the offline copy")
    }
  }, [])

  const removeAll = useCallback(async () => {
    for (const id of Object.keys(offline)) {
      await removeOffline(id).catch(() => {})
    }
    setOffline({})
    toast("All offline downloads removed")
  }, [offline])

  return { offline, busy, save, remove, removeAll, refresh }
}
