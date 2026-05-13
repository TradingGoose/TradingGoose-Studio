import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization, user, workspace } from './core'

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    userIdIdx: index('session_user_id_idx').on(table.userId),
    tokenIdx: index('session_token_idx').on(table.token),
  })
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
  })
)

export const credentialTypeEnum = pgEnum('credential_type', [
  'oauth',
  'env_workspace',
  'env_personal',
  'service_account',
])

export const credential = pgTable(
  'credential',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    type: credentialTypeEnum('type').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    providerId: text('provider_id'),
    accountId: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
    envKey: text('env_key'),
    envOwnerUserId: text('env_owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    encryptedServiceAccountKey: text('encrypted_service_account_key'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('credential_workspace_id_idx').on(table.workspaceId),
    typeIdx: index('credential_type_idx').on(table.type),
    providerIdIdx: index('credential_provider_id_idx').on(table.providerId),
    accountIdIdx: index('credential_account_id_idx').on(table.accountId),
    envOwnerUserIdIdx: index('credential_env_owner_user_id_idx').on(table.envOwnerUserId),
    workspaceAccountUnique: uniqueIndex('credential_workspace_account_unique')
      .on(table.workspaceId, table.accountId)
      .where(sql`account_id IS NOT NULL`),
    workspaceEnvUnique: uniqueIndex('credential_workspace_env_unique')
      .on(table.workspaceId, table.type, table.envKey)
      .where(sql`type = 'env_workspace'`),
    workspacePersonalEnvUnique: uniqueIndex('credential_workspace_personal_env_unique')
      .on(table.workspaceId, table.type, table.envKey, table.envOwnerUserId)
      .where(sql`type = 'env_personal'`),
    oauthSourceConstraint: check(
      'credential_oauth_source_check',
      sql`(type <> 'oauth') OR (account_id IS NOT NULL AND provider_id IS NOT NULL)`
    ),
    workspaceEnvSourceConstraint: check(
      'credential_workspace_env_source_check',
      sql`(type <> 'env_workspace') OR (env_key IS NOT NULL AND env_owner_user_id IS NULL)`
    ),
    personalEnvSourceConstraint: check(
      'credential_personal_env_source_check',
      sql`(type <> 'env_personal') OR (env_key IS NOT NULL AND env_owner_user_id IS NOT NULL)`
    ),
  })
)

export const credentialMemberRoleEnum = pgEnum('credential_member_role', ['admin', 'member'])
export const credentialMemberStatusEnum = pgEnum('credential_member_status', [
  'active',
  'pending',
  'revoked',
])

export const credentialMember = pgTable(
  'credential_member',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => credential.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: credentialMemberRoleEnum('role').notNull().default('member'),
    status: credentialMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at'),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('credential_member_user_id_idx').on(table.userId),
    roleIdx: index('credential_member_role_idx').on(table.role),
    statusIdx: index('credential_member_status_idx').on(table.status),
    uniqueMembership: uniqueIndex('credential_member_unique').on(table.credentialId, table.userId),
  })
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => ({
    identifierIdx: index('verification_identifier_idx').on(table.identifier),
  })
)

export const settings = pgTable('settings', {
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One settings record per user

  theme: text('theme').notNull().default('system'),
  telemetryEnabled: boolean('telemetry_enabled').notNull().default(true),
  emailPreferences: json('email_preferences').notNull().default('{}'),
  billingUsageNotificationsEnabled: boolean('billing_usage_notifications_enabled')
    .notNull()
    .default(true),

  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
