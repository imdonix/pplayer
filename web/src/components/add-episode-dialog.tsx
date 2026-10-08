import { LoaderCircle, Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { isWorking, type Episode } from "@/lib/types"

function ActiveJob({ episode }: { episode: Episode }) {
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <p className="truncate text-sm font-medium">{episode.title || "Fetching video info…"}</p>
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

export function AddEpisodeDialog({
  open,
  onOpenChange,
  episodes,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  episodes: Episode[]
  onAdd: (url: string) => Promise<unknown>
}) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = url.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(value)
      setUrl("")
      toast.success("Download started")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the episode")
    } finally {
      setBusy(false)
    }
  }

  const active = episodes.filter(isWorking)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add episode</DialogTitle>
          <DialogDescription>
            Paste a YouTube link. The server downloads it, converts it to audio and adds it to your
            library.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            inputMode="url"
            autoComplete="off"
            autoFocus
            className="flex-1"
          />
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Add
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {active.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              In progress
            </p>
            {active.map((episode) => (
              <ActiveJob key={episode.id} episode={episode} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
