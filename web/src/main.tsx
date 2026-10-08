import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { registerSW } from "virtual:pwa-register"
import App from "./App"
import "./index.css"

/** True while audio is playing (the player keeps mediaSession in sync). */
function isPlaying(): boolean {
  return navigator.mediaSession?.playbackState === "playing"
}

/** Reload to run the new version, but never cut off audio mid-episode. */
function reloadWhenIdle(): void {
  if (!isPlaying()) {
    window.location.reload()
    return
  }
  const timer = window.setInterval(() => {
    if (!isPlaying()) {
      window.clearInterval(timer)
      window.location.reload()
    }
  }, 10_000)
}

// Keep the installed PWA fresh.
//
// iOS keeps a suspended home-screen app running the old frontend for days, and
// browsers only look for a new service worker on a real page load. So we also
// check whenever the app returns to the foreground (and periodically while it
// stays open). In autoUpdate mode the plugin activates the new worker itself
// and calls onNeedReload when the page should switch to the new version.
registerSW({
  immediate: true,
  onNeedReload: reloadWhenIdle,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const checkForUpdate = () => {
      void registration.update().catch(() => {})
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate()
    })
    window.addEventListener("focus", checkForUpdate)
    window.setInterval(checkForUpdate, 15 * 60 * 1000)
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster position="top-center" theme="dark" richColors />
  </StrictMode>,
)
