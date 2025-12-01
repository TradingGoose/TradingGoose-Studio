import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { env } from 'bun'
import * as schema from './schema'

const connectionString = env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required for copilot key store')
}

const client = postgres(connectionString, {
  prepare: false,
  idle_timeout: 10,
  connect_timeout: 20,
  max: 5,
})

export const db = drizzle(client, { schema })

// Create table if not exists (lightweight guard; migrations recommended)
await db.execute(`
  CREATE TABLE IF NOT EXISTS copilot_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_suffix TEXT,
    created_at TIMESTAMPTZ NOT NULL
  );
`)
