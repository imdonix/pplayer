import {
  AudioLines,
  CircleAlert,
  EllipsisVertical,
  HardDrive,
  HardDriveDownload,
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

function savingLabel(busy: number | null | undefined): string {
  if (busy == null || busy < 0) return "Downloading…"
  return `Downloading… ${Math.round(Math.min(1, Math.max(0, busy)) * 100)}%`
}

/**
 * Read-only download state for the card: muted when the episode only streams,
 * a progress badge while it is being saved to this device, green once it is
 * on the device. The actual save/remove actions live in the ⋮ menu so a tap
 * next to Play can never delete the local copy by accident.
 */
function DownloadBadge({
  offline,
  busy,
}: {
  offline: OfflineMeta | null
  busy: number | null | undefined
}) {
  if (busy !== undefined) {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <LoaderCircle className="animate-spin" />
        {savingLabel(busy)}
      </Badge>
    )
  }

  if (offline) {
    const recentlySaved = Date.now() - offline.savedAt < 6000
    return (
      <Badge
        variant="secondary"
        className={cn(
          "gap-1 bg-emerald-600/15 font-normal text-emerald-700 dark:text-emerald-400",
          recentlySaved && "animate-pop",
        )}
      >
        <HardDrive />
        Downloaded
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="gap-1 bg-muted/60 font-normal text-muted-foreground/70">
      <HardDrive />
      Not downloaded
    </Badge>
  )
}

function StatusArea({
  episode,
  offline,
  busy,
}: {
  episode: Episode
  offline: OfflineMeta | null
  busy: number | null | undefined
}) {
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
      <DownloadBadge offline={offline} busy={busy} />
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
  const saving = offlineBusy !== undefined

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
                  {playable &&
                    (saving ? (
                      <DropdownMenuItem disabled>
                        <LoaderCircle className="animate-spin" /> {savingLabel(offlineBusy)}
                      </DropdownMenuItem>
                    ) : offline ? (
                      <DropdownMenuItem onSelect={() => onRemoveOffline(episode.id)}>
                        <HardDrive /> Remove download
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => onSaveOffline(episode)}>
                        <HardDriveDownload /> Download for offline
                      </DropdownMenuItem>
                    ))}
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

          <StatusArea episode={episode} offline={offline} busy={offlineBusy} />
        </div>
      </div>
    </Card>
  )
}
