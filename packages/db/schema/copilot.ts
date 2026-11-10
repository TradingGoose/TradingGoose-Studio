import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// Canonical ownership of existing Copilot credentials; no key/hash/pepper conversion.
export const copilotKeys = pgTable(
  'copilot_keys',
  {
    id: text('id').primaryKey(),
    publicId: text('public_id').notNull(),
    userId: text('user_id').notNull(),
    secretHash: text('secret_hash').notNull(),
    suffix: text('suffix'),
    name: text('name'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { mode: 'string' }),
    revokedAt: timestamp('revoked_at', { mode: 'string' }),
    expiresAt: timestamp('expires_at', { mode: 'string' }),
  },
  (table) => ({
    publicIdUidx: uniqueIndex('copilot_keys_public_id_uidx').on(table.publicId),
    userIdIdx: index('copilot_keys_user_id_idx').on(table.userId),
    statusIdx: index('copilot_keys_status_idx').on(table.status),
  })
)
