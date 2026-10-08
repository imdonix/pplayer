const KEY_STORAGE = "pplayer:key"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function getStoredKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ""
  } catch {
    return ""
  }
}

export function storeKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key)
}

export function clearKey(): void {
  localStorage.removeItem(KEY_STORAGE)
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getStoredKey()
  const headers = new Headers(init.headers)
  if (key) headers.set("Authorization", `Bearer ${key}`)
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Append the API key as a query param (for <audio> / <img> / EventSource which cannot set headers). */
export function withToken(path: string): string {
  const key = getStoredKey()
  if (!key) return path
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(key)}`
}
