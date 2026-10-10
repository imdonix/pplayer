import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { withToken } from "@/lib/api"
import { getOfflineBlob } from "@/lib/offline"
import type { Episode, SponsorSegment } from "@/lib/types"

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
const RATE_STORAGE = "pplayer:rate"
const AUTOSKIP_STORAGE = "pplayer:sponsorblock"
const POSITION_SAVE_INTERVAL = 10_000

type SourceKind = "stream" | "offline"

interface PlayerContextValue {
  episode: Episode | null
  playing: boolean
  loading: boolean
  currentTime: number
  duration: number
  rate: number
  source: SourceKind | null
  error: string | null
  /** Sponsor ranges for the current episode. */
  segments: SponsorSegment[]
  /** Whether sponsor ranges are skipped automatically. */
  autoSkip: boolean
  play: (episode: Episode, options?: { restart?: boolean }) => void
  toggle: () => void
  seek: (seconds: number) => void
  skip: (delta: number) => void
  cycleRate: () => void
  toggleAutoSkip: () => void
  close: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext)
  if (!context) throw new Error("usePlayer must be used inside <PlayerProvider>")
  return context
}

function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  try {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state
  } catch {
    // Best effort only.
  }
}

function updateMediaSessionPosition(audio: HTMLAudioElement): void {
  if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
      playbackRate: audio.playbackRate,
    })
  } catch {
    // Some browsers throw for transient states.
  }
}

export function PlayerProvider({
  children,
  episodes,
  onSavePosition,
}: {
  children: ReactNode
  episodes: Episode[]
  onSavePosition: (id: string, seconds: number, completed?: boolean) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const episodeRef = useRef<Episode | null>(null)
  const sourceRef = useRef<SourceKind | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const pendingSeekRef = useRef(0)
  const lastSavedRef = useRef(0)
  const lastTimeRef = useRef(0)
  const savePositionRef = useRef(onSavePosition)
  savePositionRef.current = onSavePosition

  const [episode, setEpisode] = useState<Episode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [source, setSource] = useState<SourceKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rate, setRate] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RATE_STORAGE))
    return RATES.includes(stored) ? stored : 1
  })
  const rateRef = useRef(rate)
  rateRef.current = rate

  const [autoSkip, setAutoSkip] = useState<boolean>(
    () => localStorage.getItem(AUTOSKIP_STORAGE) !== "false",
  )
  const autoSkipRef = useRef(autoSkip)
  autoSkipRef.current = autoSkip

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  // iOS: declare a playback audio session so audio keeps playing with the
  // screen locked (Web Audio Session API, Safari 16.4+). The default ("auto")
  // mostly works, but this makes the intent explicit.
  useEffect(() => {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (!session) return
    try {
      session.type = "playback"
    } catch {
      // Not supported.
    }
  }, [])

  // Create the <audio> element once and wire all its events.
  useEffect(() => {
    const audio = new Audio()
    audio.preload = "metadata"
    audioRef.current = audio

    const saveCurrentPosition = () => {
      const current = episodeRef.current
      // Skip the transient position 0 fired when a new source is loaded.
      if (current && audio.currentTime > 0) {
        savePositionRef.current(current.id, Math.round(audio.currentTime))
      }
    }

    /** Play the copy stored on this device (used as fallback when streaming fails). */
    const playOfflineCopy = (expectedId: string) => {
      getOfflineBlob(expectedId)
        .catch(() => null)
        .then((blob) => {
          if (!blob || episodeRef.current?.id !== expectedId) {
            setLoading(false)
            setPlaying(false)
            setError("Could not play this episode")
            return
          }
          revokeObjectUrl()
          objectUrlRef.current = URL.createObjectURL(blob)
          sourceRef.current = "offline"
          setSource("offline")
          audio.src = objectUrlRef.current
          audio.playbackRate = rateRef.current
          if (pendingSeekRef.current > 0) {
            audio.currentTime = pendingSeekRef.current
            pendingSeekRef.current = 0
          }
          lastTimeRef.current = audio.currentTime
          void audio.play().catch(() => {
            setLoading(false)
            setError("Could not play this episode")
          })
        })
    }

    const onPlay = () => {
      setPlaying(true)
      setMediaSessionPlaybackState("playing")
    }
    const onPause = () => {
      setPlaying(false)
      setMediaSessionPlaybackState("paused")
      saveCurrentPosition()
    }
    const onTimeUpdate = () => {
      const time = audio.currentTime
      const previous = lastTimeRef.current
      lastTimeRef.current = time
      setCurrentTime(time)
      if (!audio.paused && Date.now() - lastSavedRef.current > POSITION_SAVE_INTERVAL) {
        lastSavedRef.current = Date.now()
        saveCurrentPosition()
      }
      updateMediaSessionPosition(audio)

      // SponsorBlock auto-skip: jump over a segment the moment playback
      // crosses its start. Requiring a small forward delta means seeking into
      // the middle of a segment (or resuming inside it) does not skip.
      if (autoSkipRef.current) {
        const segments = episodeRef.current?.sponsorSegments
        const delta = time - previous
        if (segments && segments.length > 0 && delta > 0 && delta < 2) {
          const segment = segments.find((item) => previous <= item.start && time >= item.start && time < item.end)
          if (segment) {
            const limit =
              Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : segment.end
            audio.currentTime = Math.min(segment.end, limit)
            lastTimeRef.current = audio.currentTime
            setCurrentTime(audio.currentTime)
          }
        }
      }
    }
    const onDurationChange = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onWaiting = () => setLoading(true)
    const onPlaying = () => setLoading(false)
    const onCanPlay = () => {
      setLoading(false)
      if (pendingSeekRef.current > 0) {
        audio.currentTime = pendingSeekRef.current
        pendingSeekRef.current = 0
      }
      lastTimeRef.current = audio.currentTime
    }
    const onEnded = () => {
      setPlaying(false)
      setMediaSessionPlaybackState("paused")
      const current = episodeRef.current
      if (current) savePositionRef.current(current.id, 0, true)
      audio.currentTime = 0
      setCurrentTime(0)
    }
    const onError = () => {
      const current = episodeRef.current
      if (!current) return

      // A broken offline copy should not block playback: fall back to streaming.
      if (sourceRef.current === "offline" && current.mediaUrl) {
        sourceRef.current = "stream"
        setSource("stream")
        revokeObjectUrl()
        audio.src = withToken(current.mediaUrl)
        void audio.play().catch(() => {
          setLoading(false)
          setError("Could not play this episode")
        })
        return
      }

      // Streaming failed (no connection?): try the copy stored on this device.
      if (sourceRef.current === "stream") {
        playOfflineCopy(current.id)
        return
      }

      setLoading(false)
      setPlaying(false)
      setError("Could not play this episode")
    }

    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("waiting", onWaiting)
    audio.addEventListener("playing", onPlaying)
    audio.addEventListener("canplay", onCanPlay)
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("error", onError)

    return () => {
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("waiting", onWaiting)
      audio.removeEventListener("playing", onPlaying)
      audio.removeEventListener("canplay", onCanPlay)
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("error", onError)
      audioRef.current = null
    }
  }, [revokeObjectUrl])

  // Keep the playing episode's sponsor segments fresh when they are fetched
  // after playback started (e.g. a manual refresh from the library).
  useEffect(() => {
    const current = episodeRef.current
    if (!current) return
    const latest = episodes.find((item) => item.id === current.id)
    if (!latest) return
    const before = current.sponsorSegments ?? []
    const after = latest.sponsorSegments ?? []
    const changed =
      before.length !== after.length ||
      before.some((seg, index) => seg.start !== after[index]?.start || seg.end !== after[index]?.end)
    if (changed) {
      episodeRef.current = { ...current, sponsorSegments: latest.sponsorSegments }
      setEpisode(episodeRef.current)
    }
  }, [episodes])

  const play = useCallback(
    (next: Episode, options?: { restart?: boolean }) => {
      const audio = audioRef.current
      if (!audio || !next.mediaUrl) return

      const current = episodeRef.current
      if (current?.id === next.id && audio.src && !options?.restart) {
        if (audio.paused) void audio.play().catch(() => setError("Could not play this episode"))
        return
      }

      // Persist the position of the episode we are leaving.
      if (current && current.id !== next.id) {
        savePositionRef.current(current.id, Math.round(audio.currentTime))
      }

      episodeRef.current = next
      setEpisode(next)
      setError(null)
      setLoading(true)
      setCurrentTime(next.positionSec > 5 ? next.positionSec : 0)
      setDuration(next.durationSec ?? 0)
      pendingSeekRef.current =
        next.positionSec > 5 && (!next.durationSec || next.positionSec < next.durationSec - 10)
          ? next.positionSec
          : 0
      lastTimeRef.current = pendingSeekRef.current

      // Start streaming synchronously: iOS only allows audio to begin in the
      // same task as the user's tap, and an await (e.g. the IndexedDB lookup
      // below) would lose that allowance.
      sourceRef.current = "stream"
      setSource("stream")
      audio.src = withToken(next.mediaUrl)
      audio.playbackRate = rateRef.current
      void audio.play().catch(() => {
        // The "error" event decides whether we fall back to the offline copy.
      })

      // If this episode is stored on the device, switch to the local copy
      // (no data usage, works without a connection).
      getOfflineBlob(next.id)
        .catch(() => null)
        .then((blob) => {
          if (!blob || episodeRef.current?.id !== next.id || sourceRef.current === "offline") return
          const position = audio.currentTime
          const wasPlaying = !audio.paused
          revokeObjectUrl()
          objectUrlRef.current = URL.createObjectURL(blob)
          sourceRef.current = "offline"
          setSource("offline")
          audio.src = objectUrlRef.current
          audio.playbackRate = rateRef.current
          if (position > 0) audio.currentTime = position
          if (pendingSeekRef.current > 0) {
            audio.currentTime = pendingSeekRef.current
            pendingSeekRef.current = 0
          }
          lastTimeRef.current = audio.currentTime
          if (wasPlaying) void audio.play().catch(() => {})
          else setLoading(false)
        })
    },
    [revokeObjectUrl],
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setError("Could not play this episode"))
    else audio.pause()
  }, [])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(seconds)) return
    const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : seconds
    audio.currentTime = Math.max(0, Math.min(seconds, limit))
    lastTimeRef.current = audio.currentTime
    setCurrentTime(audio.currentTime)
  }, [])

  const skip = useCallback(
    (delta: number) => {
      const audio = audioRef.current
      if (!audio) return
      seek(audio.currentTime + delta)
    },
    [seek],
  )

  const cycleRate = useCallback(() => {
    setRate((previous) => {
      const next = RATES[(RATES.indexOf(previous) + 1) % RATES.length]
      localStorage.setItem(RATE_STORAGE, String(next))
      if (audioRef.current) audioRef.current.playbackRate = next
      return next
    })
  }, [])

  const toggleAutoSkip = useCallback(() => {
    setAutoSkip((previous) => {
      const next = !previous
      localStorage.setItem(AUTOSKIP_STORAGE, String(next))
      return next
    })
  }, [])

  const close = useCallback(() => {
    const audio = audioRef.current
    const current = episodeRef.current
    if (audio) {
      if (current && audio.currentTime > 0) {
        savePositionRef.current(current.id, Math.round(audio.currentTime))
      }
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }
    revokeObjectUrl()
    episodeRef.current = null
    sourceRef.current = null
    setEpisode(null)
    setPlaying(false)
    setLoading(false)
    setCurrentTime(0)
    setDuration(0)
    setSource(null)
    setError(null)
    setMediaSessionPlaybackState("none")
  }, [revokeObjectUrl])

  // Lock-screen / control-center metadata (works on iOS home-screen apps).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return
    try {
      if (episode) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: episode.title || "Untitled",
          artist: episode.author || "pplayer",
          album: "pplayer",
          artwork: episode.thumbnail
            ? [{ src: withToken(episode.thumbnail), sizes: "512x512", type: "image/jpeg" }]
            : [],
        })
        navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play())
        navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause())
        navigator.mediaSession.setActionHandler("seekbackward", (details) =>
          skip(-(details.seekOffset ?? 15)),
        )
        navigator.mediaSession.setActionHandler("seekforward", (details) =>
          skip(details.seekOffset ?? 30),
        )
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (typeof details.seekTime === "number") seek(details.seekTime)
        })
      } else {
        navigator.mediaSession.metadata = null
      }
    } catch {
      // Media session is best-effort.
    }

    return () => {
      try {
        if (!episode) {
          navigator.mediaSession.metadata = null
        }
      } catch {
        // ignore
      }
    }
  }, [episode, seek, skip])

  const value = useMemo<PlayerContextValue>(
    () => ({
      episode,
      playing,
      loading,
      currentTime,
      duration,
      rate,
      source,
      error,
      segments: episode?.sponsorSegments ?? [],
      autoSkip,
      play,
      toggle,
      seek,
      skip,
      cycleRate,
      toggleAutoSkip,
      close,
    }),
    [episode, playing, loading, currentTime, duration, rate, source, error, autoSkip, play, toggle, seek, skip, cycleRate, toggleAutoSkip, close],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}
