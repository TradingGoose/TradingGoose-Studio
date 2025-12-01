import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'
import type { Config } from 'drizzle-kit'

// Load env from parent .env (apps/copilot/.env)
loadEnv({ path: resolve(__dirname, '../.env') })

export default {
  schema: './schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
} satisfies Config
