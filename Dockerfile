# syntax=docker/dockerfile:1

# ---------- Stage 1: build the web app ----------
FROM oven/bun:1 AS web-build
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# ---------- Stage 2: production server dependencies ----------
FROM oven/bun:1 AS server-deps
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

# ---------- Stage 3: runtime ----------
FROM oven/bun:1-slim AS runtime

# ffmpeg converts the downloaded audio; curl is used for the health check.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp standalone binary (self-contained, no Python needed).
RUN ARCH="$(dpkg --print-architecture)" \
 && case "$ARCH" in \
      arm64) YTDLP=yt-dlp_linux_aarch64 ;; \
      armhf) YTDLP=yt-dlp_linux_armv7l ;; \
      *)     YTDLP=yt-dlp_linux ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YTDLP" -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version

WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web-build /web/dist ./web/dist

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    LOG_LEVEL=info

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["bun", "src/index.ts"]
