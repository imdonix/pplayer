import {
  ArrowDownToLine,
  AudioLines,
  Check,
  CircleAlert,
  EllipsisVertical,
  HardDrive,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Trash,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { usePlayer } from "@/hooks/use-player"
import { withToken } from "@/lib/api"
import { formatBytes, formatDate, formatTime } from "@/lib/format"
import type { OfflineMeta } from "@/lib/offline"
import { isWorking, type Episode } from "@/lib/types"
import { cn } from "@/lib/utils"

const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function Thumbnail({ episode, className }: { episode: Episode; className?: string }) {
  const localSrc = episode.thumbnail ? withToken(episode.thumbnail) : null
  const [src, setSrc] = useState<string | null>(localSrc ?? episode.thumbnailRemote)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setSrc(episode.thumbnail ? withToken(episode.thumbnail) : episode.thumbnailRemote)
    setBroken(false)
  }, [episode.thumbnail, episode.thumbnailRemote])

  if (!src || broken) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-muted text-muted-foreground",
          className,
        )}
      >
        <AudioLines className="size-6" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn("rounded-lg bg-muted object-cover", className)}
      onError={() => {
        if (episode.thumbnailRemote && src !== episode.thumbnailRemote) {
          setSrc(episode.thumbnailRemote)
        } else {
          setBroken(true)
        }
      }}
    />
  )
}

/**
 * Spotify-style offline toggle: download arrow -> progress ring while saving ->
 * green check with a pop animation once the episode is on the device.
 */
function DownloadToggle({
  episode,
  offline,
  busy,
  onSave,
  onRemove,
}: {
  episode: Episode
  offline: OfflineMeta | null
  busy: number | null | undefined
  onSave: () => void
  onRemove: () => void
}) {
  const saving = busy !== undefined
  const downloaded = offline != null
  const recentlySaved = downloaded && Date.now() - offline.savedAt < 6000

  if (saving) {
    const indeterminate = busy == null || busy < 0
    const percent = indeterminate ? null : Math.round(Math.min(1, Math.max(0, busy)) * 100)
    return (
      <button
        type="button"
        disabled
        aria-label={
          percent == null ? "Downloading for offline" : `Downloading for offline (${percent}%)`
        }
        title={percent == null ? "Downloading…" : `Downloading… ${percent}%`}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full border bg-secondary text-secondary-foreground"
      >
        <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            className="stroke-primary/20"
          />
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn(
              "stroke-primary transition-[stroke-dashoffset] duration-300",
              indeterminate && "animate-spin",
            )}
            strokeDasharray={indeterminate ? "25 75" : String(RING_CIRCUMFERENCE)}
            strokeDashoffset={
              indeterminate ? 0 : RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, busy)))
            }
          />
        </svg>
        <ArrowDownToLine className="size-4 text-muted-foreground" />
      </button>
    )
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className={cn(
        "size-9 rounded-full transition-colors",
        downloaded && "bg-emerald-600 text-white hover:bg-emerald-600/90",
        recentlySaved && "animate-pop",
      )}
      onClick={downloaded ? onRemove : onSave}
      disabled={!episode.mediaUrl}
      aria-pressed={downloaded}
      aria-label={downloaded ? "Downloaded for offline — remove" : "Download for offline"}
      title={downloaded ? "Downloaded for offline — tap to remove" : "Download for offline"}
    >
      <span className="relative flex size-4 items-center justify-center">
        <ArrowDownToLine
          className={cn(
            "absolute transition-all duration-300",
            downloaded ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
          )}
        />
        <Check
          className={cn(
            "absolute transition-all duration-300",
            downloaded ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0",
          )}
        />
      </span>
    </Button>
  )
}

function StatusArea({ episode, offline }: { episode: Episode; offline: OfflineMeta | null }) {
  if (isWorking(episode)) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" />
          <span>{episode.stage ?? "Working…"}</span>
          {episode.progress != null && (
            <span className="ml-auto tabular-nums">{Math.round(episode.progress * 100)}%</span>
          )}
        </div>
        <Progress value={episode.progress == null ? null : Math.round(episode.progress * 100)} />
      </div>
    )
  }

  if (episode.status === "error") {
    return (
      <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="line-clamp-2">{episode.error ?? "Something went wrong"}</span>
      </div>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {offline && (
        <Badge variant="secondary" className="gap-1">
          <HardDrive />
          Offline
        </Badge>
      )}
      {episode.positionSec > 5 && <span>Resume at {formatTime(episode.positionSec)}</span>}
      {episode.fileSize != null && (
        <span className="ml-auto">{formatBytes(episode.fileSize)}</span>
      )}
    </div>
  )
}

export function EpisodeCard({
  episode,
  offline,
  offlineBusy,
  onSaveOffline,
  onRemoveOffline,
  onDelete,
  onRetry,
}: {
  episode: Episode
  offline: OfflineMeta | null
  offlineBusy: number | null | undefined
  onSaveOffline: (episode: Episode) => void
  onRemoveOffline: (id: string) => void
  onDelete: (episode: Episode) => void
  onRetry: (episode: Episode) => void
}) {
  const player = usePlayer()
  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const playable = episode.status === "ready" && !!episode.mediaUrl

  const handlePlay = () => {
    if (!playable) return
    if (isCurrent) player.toggle()
    else player.play(episode)
  }

  return (
    <Card className={cn("gap-0 px-3 py-3", isCurrent && "border-primary/50")}>
      <div className="flex gap-3">
        <button type="button" onClick={handlePlay} className="shrink-0" aria-label="Play">
          <Thumbnail episode={episode} className="size-20" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={handlePlay}
              disabled={!playable}
              className="min-w-0 flex-1 text-left disabled:cursor-default"
            >
              <p className="line-clamp-2 text-sm font-medium leading-snug">
                {episode.title || episode.url}
              </p>
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {playable && (
                <DownloadToggle
                  episode={episode}
                  offline={offline}
                  busy={offlineBusy}
                  onSave={() => onSaveOffline(episode)}
                  onRemove={() => onRemoveOffline(episode.id)}
                />
              )}

              <Button
                size="icon"
                variant={isCurrent ? "default" : "secondary"}
                className="size-9 rounded-full"
                disabled={!playable}
                onClick={handlePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isCurrent && player.loading ? (
                  <LoaderCircle className="animate-spin" />
                ) : isPlaying ? (
                  <Pause />
                ) : (
                  <Play className="translate-x-[1px]" />
                )}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground"
                    aria-label="More options"
                  >
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {playable && (
                    <DropdownMenuItem onSelect={() => player.play(episode, { restart: true })}>
                      <Play /> Play from start
                    </DropdownMenuItem>
                  )}
                  {episode.status === "error" && (
                    <DropdownMenuItem onSelect={() => onRetry(episode)}>
                      <RefreshCw /> Retry download
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(episode)}>
                    <Trash /> Delete episode
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {episode.author ? `${episode.author} · ` : ""}
            {formatTime(episode.durationSec)} · {formatDate(episode.createdAt)}
          </p>

          <StatusArea episode={episode} offline={offline} />
        </div>
      </div>
    </Card>
  )
}
