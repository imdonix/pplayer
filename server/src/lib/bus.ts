import type { EpisodeDto } from "./types.ts"

export type ServerEvent =
  | { type: "snapshot"; episodes: EpisodeDto[] }
  | { type: "episode"; episode: EpisodeDto }
  | { type: "deleted"; id: string }

type Subscriber = (event: ServerEvent) => void

const subscribers = new Set<Subscriber>()

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function subscriberCount(): number {
  return subscribers.size
}

export function broadcast(event: ServerEvent): void {
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event)
    } catch {
      subscribers.delete(subscriber)
    }
  }
}
