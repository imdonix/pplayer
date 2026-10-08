# pplayer

A self-hosted podcast player and downloader. Paste a YouTube link, the server downloads
the audio with **yt-dlp**, converts it to **M4A (AAC)** with **ffmpeg**, and adds it to
your personal library. Stream it in the browser or save it to your device for offline
listening.

Built as an installable **PWA** — works great on iPhone (Add to Home Screen) and on the
desktop.

## Features

- **YouTube → podcast**: paste a link, watch live progress for metadata fetch, download
  and ffmpeg conversion.
- **Library**: all downloaded episodes with thumbnails, duration and status.
- **Player**: seek, ±15/30 s skip, playback speed, resume where you left off,
  lock-screen controls (Media Session).
- **Offline listening**: "Save for offline" stores the audio in the browser's IndexedDB,
  so episodes play without a connection. Ideal for iPhone home-screen installs.
- **Live updates**: progress is pushed to the UI over SSE (no polling).
- **Single API key auth** — one account, one key, done.
- **One Docker image** (frontend + backend + yt-dlp + ffmpeg) with a SQLite database
  and a single data volume.

## Quick start (Docker)

```bash
# 1. Set your API key
echo "API_KEY=$(openssl rand -hex 16)" > .env

# 2. Build and run
docker compose up -d --build

# 3. Open http://localhost:3000 and sign in with the key from .env
```

Data (SQLite DB, audio files, thumbnails) lives in the `pplayer-data` volume.

If port 3000 is already taken, pick another host port:

```bash
HOST_PORT=8080 docker compose up -d
```

Without compose:

```bash
docker build -t pplayer .
docker run -d --name pplayer -p 3000:3000 \
  -e API_KEY=$(openssl rand -hex 16) \
  -v pplayer-data:/data \
  pplayer
```

If you don't set `API_KEY`, the server generates one on first start, stores it in
`/data/api-key.txt` and prints it to the logs (`docker logs pplayer`).

## Installing on iPhone (PWA)

1. Make the app reachable over **HTTPS** (iOS only allows service workers / installable
   PWAs on secure origins — `localhost` excluded):
   - easiest: put it behind [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve),
     a reverse proxy with a real certificate (Caddy, nginx + Let's Encrypt), or a
     Cloudflare Tunnel.
2. Open the app in **Safari**, sign in.
3. Share → **Add to Home Screen** → open it from the home screen.
4. Tap **Save for offline** on episodes you want on the device. Audio is stored locally
   and plays with no connection.

> Note: iOS may evict website storage, but storage of an installed (home-screen) PWA is
> persistent. The app calls `navigator.storage.persist()` when you save an episode.

## Development

Requirements: [Bun](https://bun.sh), `yt-dlp` and `ffmpeg` on your `PATH`
(`brew install yt-dlp ffmpeg` / `apt install yt-dlp ffmpeg`).

```bash
bun install --cwd server
bun install --cwd web

# terminal 1 — API server on :3000 (API key: set API_KEY or check server/data/api-key.txt)
bun run dev:server

# terminal 2 — Vite dev server on :5173 (proxies /api to :3000)
bun run dev:web
```

Open http://localhost:5173.

Production-style local run: `bun run build` (builds `web/dist`), then `bun run start`
(serves API + built frontend on :3000).

## Configuration

| Variable          | Default                  | Description                                             |
| ----------------- | ------------------------ | ------------------------------------------------------- |
| `PORT`            | `3000`                   | HTTP port                                               |
| `API_KEY`         | generated → `api-key.txt`| Single account key used to sign in                      |
| `DATA_DIR`        | `server/data`            | SQLite DB, media and thumbnails                         |
| `WEB_DIR`         | `web/dist`               | Built frontend to serve (optional)                      |
| `YTDLP_BIN`       | `yt-dlp`                 | yt-dlp binary path                                      |
| `FFMPEG_BIN`      | `ffmpeg`                 | ffmpeg binary path                                      |
| `YTDLP_COOKIES`   | —                        | Path to a Netscape `cookies.txt` for YouTube bot checks |
| `LOG_LEVEL`       | `info`                   | `debug`, `info`, `warn` or `error`                      |

## Logs

```bash
docker compose logs -f pplayer
```

The server logs what it is doing, so you can follow a download from start to finish:

```
[2026-10-08 14:23:01] INFO  pplayer starting
[2026-10-08 14:23:01] INFO    data dir: /data
[2026-10-08 14:23:01] INFO    yt-dlp: 2026.08.19 (/usr/local/bin/yt-dlp)
[2026-10-08 14:23:01] INFO    ffmpeg: ffmpeg version 7.1.5-0+deb13u1 (/usr/bin/ffmpeg)
[2026-10-08 14:23:01] INFO  listening on http://localhost:3000
[2026-10-08 14:23:40] INFO  POST /api/episodes 201 12ms
[2026-10-08 14:23:40] INFO  [3f9c1a2b0d4e5f60] added: https://www.youtube.com/watch?v=...
[2026-10-08 14:23:41] INFO  [3f9c1a2b0d4e5f60] processing https://www.youtube.com/watch?v=...
[2026-10-08 14:23:42] INFO  [3f9c1a2b0d4e5f60] video: "My episode" by Some Channel (64 min)
[2026-10-08 14:23:42] INFO  [3f9c1a2b0d4e5f60] downloading audio with yt-dlp…
[2026-10-08 14:23:55] INFO  [3f9c1a2b0d4e5f60] downloaded 61.2 MB in 13.1s (source.m4a)
[2026-10-08 14:23:55] INFO  [3f9c1a2b0d4e5f60] ffmpeg: remuxing (stream copy)
[2026-10-08 14:23:56] INFO  [3f9c1a2b0d4e5f60] converted in 1.2s
[2026-10-08 14:23:56] INFO  [3f9c1a2b0d4e5f60] ready: "My episode" (61.2 MB)
```

Set `LOG_LEVEL=debug` for more detail: every request (including media range requests,
thumbnails and SSE connect/disconnect), thumbnail caching and playback position saves.
`LOG_LEVEL=warn` quiets it down to problems only.

### YouTube bot checks

YouTube sometimes asks servers to "confirm you're not a bot". The Docker image always
installs the latest yt-dlp, which usually helps. If you still get errors:

1. Export cookies from a logged-in browser with a `cookies.txt` extension.
2. Mount them and set `YTDLP_COOKIES`:

```yaml
environment:
  YTDLP_COOKIES: /cookies.txt
volumes:
  - ./cookies.txt:/cookies.txt:ro
```

To update yt-dlp without rebuilding the image, mount a newer binary over
`/usr/local/bin/yt-dlp`.

## Project layout

```
server/            Bun + Hono API
  src/config.ts    env + data dirs + API key
  src/db/          drizzle schema + bun:sqlite connection
  src/lib/jobs.ts  download queue: yt-dlp → ffmpeg with progress
  src/lib/media.ts HTTP range streaming
  src/routes/      auth, episodes, media, SSE events
web/               React 19 + Vite + Tailwind v4 + shadcn-style UI
  src/hooks/       library state (SSE), player, offline storage
  src/lib/offline.ts  IndexedDB audio storage
  vite.config.ts   PWA manifest + service worker (vite-plugin-pwa)
Dockerfile         single image (multi-stage)
```

## API (all routes need the key)

Send the key as `Authorization: Bearer <key>`; media/SSE URLs may use `?token=<key>`
(audio elements and EventSource can't set headers).

| Method   | Route                      | Purpose                                  |
| -------- | -------------------------- | ---------------------------------------- |
| `POST`   | `/api/auth/login`          | Validate the key                         |
| `GET`    | `/api/episodes`            | List episodes                            |
| `POST`   | `/api/episodes`            | Add `{ "url": "https://youtu.be/…" }`    |
| `PATCH`  | `/api/episodes/:id`        | Save `{ "positionSec": 123 }`            |
| `POST`   | `/api/episodes/:id/retry`  | Retry a failed download                  |
| `DELETE` | `/api/episodes/:id`        | Delete episode + files                   |
| `GET`    | `/api/media/:id`           | Stream audio (HTTP Range)                |
| `GET`    | `/api/thumbnails/:id`      | Episode thumbnail                        |
| `GET`    | `/api/events?token=…`      | SSE: snapshot + live progress            |
| `GET`    | `/api/health`              | Health check (no auth)                   |
