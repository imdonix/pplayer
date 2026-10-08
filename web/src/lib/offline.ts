import { del, get, keys, set } from "idb-keyval"

const AUDIO_PREFIX = "pplayer:audio:"
const META_PREFIX = "pplayer:meta:"

const audioKey = (id: string) => `${AUDIO_PREFIX}${id}`
const metaKey = (id: string) => `${META_PREFIX}${id}`

export interface OfflineMeta {
  id: string
  title: string
  size: number
  savedAt: number
}

/** Ask the browser to keep this origin's storage (important on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    // ignore
  }
  return false
}

export async function listOffline(): Promise<OfflineMeta[]> {
  const allKeys = await keys()
  const metaKeys = allKeys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(META_PREFIX),
  )
  const metas: OfflineMeta[] = []
  for (const key of metaKeys) {
    const meta = await get<OfflineMeta>(key)
    if (meta) metas.push(meta)
  }
  return metas.sort((a, b) => b.savedAt - a.savedAt)
}

export async function getOfflineMeta(id: string): Promise<OfflineMeta | null> {
  return (await get<OfflineMeta>(metaKey(id))) ?? null
}

export async function getOfflineBlob(id: string): Promise<Blob | null> {
  return (await get<Blob>(audioKey(id))) ?? null
}

export async function removeOffline(id: string): Promise<void> {
  await del(audioKey(id))
  await del(metaKey(id))
}

/**
 * Download the converted audio and store it in IndexedDB for offline playback.
 * Reports progress 0..1 (null when the server does not send Content-Length).
 */
export async function saveOffline(
  id: string,
  title: string,
  url: string,
  onProgress: (progress: number | null) => void,
): Promise<OfflineMeta> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`)
  }
  const total = Number(response.headers.get("Content-Length") ?? 0)
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(total > 0 ? Math.min(1, received / total) : null)
  }

  const blob = new Blob(chunks, { type: "audio/mp4" })
  await set(audioKey(id), blob)
  const meta: OfflineMeta = { id, title, size: blob.size, savedAt: Date.now() }
  await set(metaKey(id), meta)
  return meta
}
