import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from './core'

export const systemAdmin = pgTable(
  'system_admin',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex('system_admin_user_id_unique').on(table.userId),
  })
)

export const systemIntegrationDefinition = pgTable(
  'system_integration_definition',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnyPgColumn => systemIntegrationDefinition.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    isEnabled: boolean('is_enabled'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    parentIdIdx: index('system_integration_definition_parent_id_idx').on(table.parentId),
    parentCheck: check(
      'system_integration_definition_parent_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`
    ),
    availabilityCheck: check(
      'system_integration_definition_availability_check',
      sql`(${table.parentId} is null and ${table.isEnabled} is null) or (${table.parentId} is not null and ${table.isEnabled} is not null)`
    ),
  })
)

export const systemIntegrationSecret = pgTable(
  'system_integration_secret',
  {
    id: text('id').primaryKey(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => systemIntegrationDefinition.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    definitionIdIdx: index('system_integration_secret_definition_id_idx').on(table.definitionId),
    definitionKeyUnique: uniqueIndex('system_integration_secret_definition_key_unique').on(
      table.definitionId,
      table.key
    ),
  })
)
