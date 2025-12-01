import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const copilotKeys = pgTable('copilot_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  keyHash: text('key_hash').notNull(),
  keySuffix: text('key_suffix'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
})
