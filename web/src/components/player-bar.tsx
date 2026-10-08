import { FastForward, HardDrive, LoaderCircle, Pause, Play, Rewind, Wifi, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer } from "@/hooks/use-player"
import { withToken } from "@/lib/api"
import { formatTime } from "@/lib/format"

export function PlayerBar() {
  const player = usePlayer()
  const episode = player.episode
  if (!episode) return null

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5">
        <div className="flex items-center gap-3">
          {episode.thumbnail ? (
            <img
              src={withToken(episode.thumbnail)}
              alt=""
              className="size-10 shrink-0 rounded-md bg-muted object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{episode.title || "Untitled"}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              {player.source === "offline" ? (
                <>
                  <HardDrive className="size-3" /> Offline copy
                </>
              ) : (
                <>
                  <Wifi className="size-3" /> Streaming
                </>
              )}
              {episode.author ? ` · ${episode.author}` : ""}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={player.close} aria-label="Close player">
            <X />
          </Button>
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {formatTime(player.currentTime)}
          </span>
          <input
            type="range"
            className="player-range flex-1"
            min={0}
            max={Math.max(player.duration, 1)}
            step={1}
            value={Math.min(player.currentTime, player.duration || 0)}
            style={{ "--progress": `${progress}%` } as React.CSSProperties}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="Seek"
          />
          <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTime(player.duration || episode.durationSec)}
          </span>
        </div>

        <div className="relative mt-1 flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="mr-4"
            onClick={() => player.skip(-15)}
            aria-label="Back 15 seconds"
          >
            <Rewind />
          </Button>
          <Button
            size="icon"
            className="size-11 rounded-full"
            onClick={player.toggle}
            aria-label={player.playing ? "Pause" : "Play"}
          >
            {player.loading ? (
              <LoaderCircle className="animate-spin" />
            ) : player.playing ? (
              <Pause />
            ) : (
              <Play className="translate-x-[1px]" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-4"
            onClick={() => player.skip(30)}
            aria-label="Forward 30 seconds"
          >
            <FastForward />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 w-12 tabular-nums text-xs text-muted-foreground"
            onClick={player.cycleRate}
            aria-label="Playback speed"
          >
            {player.rate}×
          </Button>
        </div>

        {player.error && (
          <p className="mt-1 text-center text-xs text-destructive">{player.error}</p>
        )}
      </div>
    </div>
  )
}
