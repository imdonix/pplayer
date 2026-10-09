import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  author: text("author").notNull().default(""),
  durationSec: integer("duration_sec"),
  thumbnailPath: text("thumbnail_path"),
  thumbnailUrl: text("thumbnail_url"),
  /** pending | fetching | downloading | converting | ready | error */
  status: text("status").notNull().default("pending"),
  stage: text("stage"),
  /** 0..1, null while indeterminate */
  progress: real("progress"),
  error: text("error"),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  positionSec: real("position_sec").notNull().default(0),
  /** When the episode was last played to the end (null = never finished, or replayed since). */
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export type EpisodeRow = typeof episodes.$inferSelect
export type NewEpisode = typeof episodes.$inferInsert
export type EpisodeStatus = "pending" | "fetching" | "downloading" | "converting" | "ready" | "error"
