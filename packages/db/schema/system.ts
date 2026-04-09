import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from './core'

export const registrationModeEnum = pgEnum('registration_mode', ['open', 'waitlist', 'disabled'])

export const waitlistStatusEnum = pgEnum('waitlist_status', [
  'pending',
  'approved',
  'rejected',
  'signed_up',
])

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

export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey(),
  registrationMode: registrationModeEnum('registration_mode').notNull().default('open'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

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

export const waitlist = pgTable(
  'waitlist',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    status: waitlistStatusEnum('status').notNull().default('pending'),
    approvedAt: timestamp('approved_at'),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    rejectedAt: timestamp('rejected_at'),
    rejectedByUserId: text('rejected_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    signedUpAt: timestamp('signed_up_at'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('waitlist_email_idx').on(table.email),
    statusIdx: index('waitlist_status_idx').on(table.status),
    userIdIdx: index('waitlist_user_id_idx').on(table.userId),
  })
)
