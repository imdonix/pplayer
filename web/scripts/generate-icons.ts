/**
 * Generates the PWA icons (PNG) without any external dependencies.
 * Run with: bun run icons
 */
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

type RGBA = [number, number, number, number]
type Point = [number, number]

const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../public/icons")

function crc32(data: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, Buffer.from(data), crc])
}

function encodePng(width: number, height: number, pixels: RGBA[]): Buffer {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels[y * width + x]
      const offset = y * stride + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ])
}

function insideRoundedRect(x: number, y: number, size: number, radius: number): boolean {
  if (radius <= 0) return x >= 0 && y >= 0 && x <= size && y <= size
  const dx = Math.max(radius - x, x - (size - radius), 0)
  const dy = Math.max(radius - y, y - (size - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}

function insideTriangle(x: number, y: number, a: Point, b: Point, c: Point): boolean {
  const side = (p1: Point, p2: Point, p3: Point) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  const d1 = side([x, y], a, b)
  const d2 = side([x, y], b, c)
  const d3 = side([x, y], c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function makeIcon(size: number, options: { rounded: boolean; scale: number }): Buffer {
  const pixels: RGBA[] = new Array(size * size)
  const radius = options.rounded ? size * 0.22 : 0
  const center = size / 2
  const scale = options.scale
  const a: Point = [center - 0.3 * size * scale, center - 0.38 * size * scale]
  const b: Point = [center - 0.3 * size * scale, center + 0.38 * size * scale]
  const c: Point = [center + 0.4 * size * scale, center]
  const samples = 3

  for (let y = 0; y < size; y++) {
    const t = y / size
    const bgR = lerp(139, 109, t)
    const bgG = lerp(92, 40, t)
    const bgB = lerp(246, 217, t)
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let triHits = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          if (insideRoundedRect(px, py, size, radius)) bgHits++
          if (insideTriangle(px, py, a, b, c)) triHits++
        }
      }
      if (bgHits === 0) {
        pixels[y * size + x] = [0, 0, 0, 0]
        continue
      }
      const total = samples * samples
      const bgCoverage = bgHits / total
      const triCoverage = triHits / total
      pixels[y * size + x] = [
        Math.round(lerp(bgR, 255, triCoverage)),
        Math.round(lerp(bgG, 255, triCoverage)),
        Math.round(lerp(bgB, 255, triCoverage)),
        Math.round(255 * bgCoverage),
      ]
    }
  }

  return encodePng(size, size, pixels)
}

mkdirSync(outDir, { recursive: true })

const icons: Array<[string, Buffer]> = [
  ["icon-192.png", makeIcon(192, { rounded: true, scale: 1 })],
  ["icon-512.png", makeIcon(512, { rounded: true, scale: 1 })],
  ["icon-maskable-512.png", makeIcon(512, { rounded: false, scale: 0.72 })],
  ["apple-touch-icon.png", makeIcon(180, { rounded: false, scale: 0.85 })],
]

for (const [name, buffer] of icons) {
  writeFileSync(resolve(outDir, name), buffer)
  console.log(`wrote ${name} (${buffer.length} bytes)`)
}
