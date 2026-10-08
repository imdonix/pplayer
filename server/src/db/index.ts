import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { resolve } from "node:path"
import { config } from "../config.ts"
import * as schema from "./schema.ts"

const sqlite = new Database(resolve(config.dataDir, "pplayer.db"), { create: true })
sqlite.exec("PRAGMA journal_mode = WAL;")

export const db = drizzle(sqlite, { schema })

/**
 * Idempotent schema setup. The drizzle schema in ./schema.ts is the source of
 * truth; this DDL mirrors it so the app can boot on a fresh data directory
 * without a migration tool.
 */
export function initDb(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      duration_sec INTEGER,
      thumbnail_path TEXT,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      progress REAL,
      error TEXT,
      file_path TEXT,
      file_size INTEGER,
      position_sec REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS episodes_created_at_idx ON episodes (created_at DESC);
  `)
}
