import { HardDrive, LogOut, Megaphone } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { usePlayer } from "@/hooks/use-player"
import { formatBytes } from "@/lib/format"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
  onSignOut,
  offlineCount,
  offlineSize,
  onRemoveAllOffline,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSignOut: () => void
  offlineCount: number
  offlineSize: number
  onRemoveAllOffline: () => Promise<void>
}) {
  const [usage, setUsage] = useState<number | null>(null)
  const [quota, setQuota] = useState<number | null>(null)
  const [removing, setRemoving] = useState(false)
  const player = usePlayer()

  useEffect(() => {
    if (!open) return
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        setUsage(estimate.usage ?? null)
        setQuota(estimate.quota ?? null)
      })
      .catch(() => {})
  }, [open, offlineCount])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>pplayer — personal podcast player</DialogDescription>
        </DialogHeader>

        <Section title="Offline storage">
          <div className="rounded-md border p-3 text-sm">
            <p className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              {offlineCount === 0
                ? "No episodes saved on this device"
                : `${offlineCount} episode${offlineCount === 1 ? "" : "s"} saved on this device (${formatBytes(offlineSize)})`}
            </p>
            {usage != null && quota != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                Browser storage: {formatBytes(usage)} of {formatBytes(quota)} used
              </p>
            )}
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={offlineCount === 0 || removing}
            onClick={async () => {
              if (!window.confirm("Remove all offline downloads from this device?")) return
              setRemoving(true)
              try {
                await onRemoveAllOffline()
              } finally {
                setRemoving(false)
              }
            }}
          >
            Remove all offline downloads
          </Button>
        </Section>

        <Section title="SponsorBlock">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span className="flex items-center gap-2">
              <Megaphone className="size-4 text-muted-foreground" />
              Auto-skip sponsor segments
            </span>
            <Button variant={player.autoSkip ? "default" : "outline"} size="sm" onClick={player.toggleAutoSkip}>
              {player.autoSkip ? "On" : "Off"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sponsor, self-promotion and interaction ranges (from the community SponsorBlock
            database) are fetched with each episode, shown as green bars and skipped automatically.
          </p>
        </Section>

        <Section title="Account">
          <Button variant="outline" size="sm" onClick={onSignOut}>
            <LogOut /> Sign out
          </Button>
        </Section>

        <Section title="About">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Downloads happen on your server with yt-dlp and ffmpeg. Audio is converted to M4A (AAC)
            and streamed to this app. Episodes you save for offline are stored on this device and
            play without a connection.
          </p>
        </Section>
      </DialogContent>
    </Dialog>
  )
}
