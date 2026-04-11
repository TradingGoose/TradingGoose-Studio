import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  decimal,
  json,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
})

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: json('metadata'),
  orgUsageLimit: decimal('org_usage_limit'),
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0), // Storage tracking for organization-scoped usage
  lastActive: timestamp('last_active').notNull().defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace = pgTable(
  'workspace',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    billingOwnerType: text('billing_owner_type')
      .$type<'user' | 'organization'>()
      .notNull()
      .default('user'),
    billingOwnerUserId: text('billing_owner_user_id').references(() => user.id, {
      onDelete: 'no action',
    }),
    billingOwnerOrganizationId: text('billing_owner_organization_id').references(
      () => organization.id,
      { onDelete: 'no action' }
    ),
    allowPersonalApiKeys: boolean('allow_personal_api_keys').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    billingOwnerCheck: check(
      'workspace_billing_owner_check',
      sql`(
        ${table.billingOwnerType} = 'user'
        AND ${table.billingOwnerUserId} IS NOT NULL
        AND ${table.billingOwnerOrganizationId} IS NULL
      ) OR (
        ${table.billingOwnerType} = 'organization'
        AND ${table.billingOwnerUserId} IS NULL
        AND ${table.billingOwnerOrganizationId} IS NOT NULL
      )`
    ),
  })
)
