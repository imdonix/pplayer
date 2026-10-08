import { AudioLines, Plus, Settings, WifiOff } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { AddEpisodeDialog } from "@/components/add-episode-dialog"
import { EpisodeCard } from "@/components/episode-card"
import { LoginScreen } from "@/components/login-screen"
import { PlayerBar } from "@/components/player-bar"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useLibrary } from "@/hooks/use-library"
import { useOffline } from "@/hooks/use-offline"
import { PlayerProvider } from "@/hooks/use-player"
import { clearKey, getStoredKey, storeKey } from "@/lib/api"
import type { Episode } from "@/lib/types"

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="items-center gap-3 border-dashed py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <AudioLines className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Your library is empty</p>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">
          Paste a YouTube link to download it as a podcast episode.
        </p>
      </div>
      <Button onClick={onAdd}>
        <Plus /> Add episode
      </Button>
    </Card>
  )
}

function Library({ onSignOut }: { onSignOut: () => void }) {
  const { episodes, connected, addEpisode, deleteEpisode, retryEpisode, savePosition } =
    useLibrary(onSignOut)
  const offline = useOffline()
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const offlineCount = Object.keys(offline.offline).length
  const offlineSize = useMemo(
    () => Object.values(offline.offline).reduce((total, meta) => total + meta.size, 0),
    [offline.offline],
  )

  // Episodes saved on this device always show up, even if the server list is
  // unavailable (offline) or no longer knows about them.
  const visibleEpisodes = useMemo(() => {
    const known = new Set(episodes.map((episode) => episode.id))
    const extras: Episode[] = Object.values(offline.offline)
      .filter((meta) => !known.has(meta.id))
      .map((meta) => ({
        id: meta.id,
        url: "",
        title: meta.title,
        author: "",
        durationSec: null,
        status: "ready",
        stage: null,
        progress: 1,
        error: null,
        fileSize: meta.size,
        positionSec: 0,
        createdAt: meta.savedAt,
        updatedAt: meta.savedAt,
        thumbnail: null,
        thumbnailRemote: null,
        mediaUrl: `/api/media/${meta.id}`,
      }))
    return extras.length === 0 ? episodes : [...episodes, ...extras]
  }, [episodes, offline.offline])

  const handleDelete = useCallback(
    async (episode: Episode) => {
      if (!window.confirm(`Delete "${episode.title || "this episode"}"?`)) return
      try {
        await deleteEpisode(episode.id)
        if (offline.offline[episode.id]) await offline.remove(episode.id)
      } catch {
        toast.error("Could not delete the episode")
      }
    },
    [deleteEpisode, offline],
  )

  const handleRetry = useCallback(
    async (episode: Episode) => {
      try {
        await retryEpisode(episode.id)
        toast.success("Retrying download")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not retry")
      }
    },
    [retryEpisode],
  )

  return (
    <PlayerProvider onSavePosition={savePosition}>
      <div className="min-h-dvh pb-44">
        <header className="sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-2 px-4">
            <AudioLines className="size-5 text-primary" />
            <span className="font-semibold tracking-tight">pplayer</span>
            {!connected && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Live updates disconnected">
                <WifiOff className="size-3.5" />
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
              >
                <Settings />
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus /> Add
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4">
          {visibleEpisodes.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} />
          ) : (
            visibleEpisodes.map((episode) => (
              <EpisodeCard
                key={episode.id}
                episode={episode}
                offline={offline.offline[episode.id] ?? null}
                offlineBusy={offline.busy[episode.id]}
                onSaveOffline={(target) => void offline.save(target)}
                onRemoveOffline={(id) => void offline.remove(id)}
                onDelete={(target) => void handleDelete(target)}
                onRetry={(target) => void handleRetry(target)}
              />
            ))
          )}
        </main>

        <AddEpisodeDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          episodes={visibleEpisodes}
          onAdd={addEpisode}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSignOut={onSignOut}
          offlineCount={offlineCount}
          offlineSize={offlineSize}
          onRemoveAllOffline={offline.removeAll}
        />
      </div>
      <PlayerBar />
    </PlayerProvider>
  )
}

export default function App() {
  const [key, setKey] = useState(() => getStoredKey())

  const handleSignOut = useCallback(() => {
    clearKey()
    setKey("")
  }, [])

  if (!key) {
    return (
      <LoginScreen
        onSuccess={(value) => {
          storeKey(value)
          setKey(value)
        }}
      />
    )
  }

  return <Library onSignOut={handleSignOut} />
}
