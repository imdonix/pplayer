import { AudioLines, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api"

export function LoginScreen({ onSuccess }: { onSuccess: (key: string) => void }) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = key.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ key: value }) })
      onSuccess(value)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Wrong API key. Check the API_KEY of your server."
          : err instanceof Error
            ? err.message
            : "Could not sign in",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="mb-6 flex flex-col items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-b from-violet-500 to-violet-700 shadow-lg">
          <AudioLines className="size-8 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">pplayer</h1>
          <p className="text-sm text-muted-foreground">Your personal podcast library</p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Sign in</CardTitle>
          <CardDescription>Enter the API key configured on your server.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !key.trim()}>
              {busy && <LoaderCircle className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        The key lives in your server's <code>API_KEY</code> environment variable, or in{" "}
        <code>data/api-key.txt</code> if none was set.
      </p>
    </div>
  )
}
