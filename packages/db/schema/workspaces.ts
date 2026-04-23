import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user, workspace } from './core'

export const environment = pgTable('environment', {
  id: text('id').primaryKey(), // Use the user id as the key
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One environment per user
  variables: json('variables').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workspaceEnvironment = pgTable(
  'workspace_environment',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    variables: json('variables').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_environment_workspace_unique').on(table.workspaceId),
  })
)

export const environmentVariables = pgTable(
  'environment_variables',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('environment_variables_user_id_idx').on(table.userId),
    workspaceIdIdx: index('environment_variables_workspace_id_idx').on(table.workspaceId),
    userKeyUnique: uniqueIndex('environment_variables_user_key_unique').on(table.userId, table.key),
    workspaceKeyUnique: uniqueIndex('environment_variables_workspace_key_unique').on(
      table.workspaceId,
      table.key
    ),
    scopeCheck: check(
      'environment_variables_scope_check',
      sql`(user_id IS NOT NULL AND workspace_id IS NULL) OR (user_id IS NULL AND workspace_id IS NOT NULL)`
    ),
  })
)

export const apiKey = pgTable(
  'api_key',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }), // Only set for workspace keys
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }), // Who created the workspace key
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    type: text('type').notNull().default('personal'), // 'personal' or 'workspace'
    lastUsed: timestamp('last_used'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    // Ensure workspace keys have a workspace_id and personal keys don't
    workspaceTypeCheck: check(
      'workspace_type_check',
      sql`(type = 'workspace' AND workspace_id IS NOT NULL) OR (type = 'personal' AND workspace_id IS NULL)`
    ),
  })
)

export const customTools = pgTable(
  'custom_tools',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    schema: json('schema').notNull(),
    code: text('code').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('custom_tools_workspace_id_idx').on(table.workspaceId),
    workspaceTitleUnique: uniqueIndex('custom_tools_workspace_title_unique').on(
      table.workspaceId,
      table.title
    ),
  })
)

export const skill = pgTable(
  'skill',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('skill_workspace_id_idx').on(table.workspaceId),
    workspaceNameUnique: uniqueIndex('skill_workspace_name_unique').on(
      table.workspaceId,
      table.name
    ),
  })
)

export const pineIndicators = pgTable(
  'custom_indicators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull().default('New Indicator'),
    color: text('color').notNull().default('#3972F6'),
    pineCode: text('pine_code').notNull().default(''),
    inputMeta: json('input_meta'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('custom_indicators_workspace_id_idx').on(table.workspaceId),
  })
)

export const watchlistTable = pgTable(
  'watchlist_table',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => watchlistTable.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    settings: jsonb('settings').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceUserIdx: index('watchlist_table_workspace_user_idx').on(
      table.workspaceId,
      table.userId
    ),
    workspaceUserParentIdx: index('watchlist_table_workspace_user_parent_idx').on(
      table.workspaceId,
      table.userId,
      table.parentId
    ),
    parentSortIdx: index('watchlist_table_parent_sort_idx').on(table.parentId, table.sortOrder),
    workspaceUserNameUnique: uniqueIndex('watchlist_table_workspace_user_name_unique')
      .on(table.workspaceId, table.userId, table.name)
      .where(sql`${table.parentId} is null`),
  })
)

export const watchlistItem = pgTable(
  'watchlist_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlistTable.id, { onDelete: 'cascade' }),
    containerId: uuid('container_id').references(() => watchlistTable.id, { onDelete: 'cascade' }),
    listing: jsonb('listing').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    watchlistIdx: index('watchlist_item_watchlist_idx').on(table.watchlistId),
    watchlistContainerSortIdx: index('watchlist_item_watchlist_container_sort_idx').on(
      table.watchlistId,
      table.containerId,
      table.sortOrder
    ),
    containerSortIdx: index('watchlist_item_container_sort_idx').on(
      table.containerId,
      table.sortOrder
    ),
    watchlistListingIdentityUnique: uniqueIndex(
      'watchlist_item_watchlist_listing_identity_unique'
    ).on(
      table.watchlistId,
      sql`coalesce(${table.listing}->>'listing_type', '')`,
      sql`coalesce(${table.listing}->>'listing_id', '')`,
      sql`coalesce(${table.listing}->>'base_id', '')`,
      sql`coalesce(${table.listing}->>'quote_id', '')`
    ),
  })
)

export const layoutMap = pgTable(
  'layout_map',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sort_order: integer('sort_order').notNull().default(0),
    layout: jsonb('layout').notNull().default('{}'),
    color_pair: jsonb('color_pair').notNull().default('{}'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('layout_map_workspace_idx').on(table.workspaceId),
    userIdx: index('layout_map_user_idx').on(table.userId),
    workspaceUserIdx: index('layout_map_workspace_user_idx').on(table.workspaceId, table.userId),
    workspaceUserActiveIdx: index('layout_map_workspace_user_active_idx').on(
      table.workspaceId,
      table.userId,
      table.isActive
    ),
  })
)

export const monitorView = pgTable(
  'monitor_view',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sort_order: integer('sort_order').notNull().default(0),
    config: jsonb('config').notNull().default('{}'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('monitor_view_workspace_idx').on(table.workspaceId),
    userIdx: index('monitor_view_user_idx').on(table.userId),
    workspaceUserIdx: index('monitor_view_workspace_user_idx').on(table.workspaceId, table.userId),
    workspaceUserActiveIdx: index('monitor_view_workspace_user_active_idx').on(
      table.workspaceId,
      table.userId,
      table.isActive
    ),
    workspaceUserSortIdx: index('monitor_view_workspace_user_sort_idx').on(
      table.workspaceId,
      table.userId,
      table.sort_order
    ),
  })
)

export const workspaceFile = pgTable(
  'workspace_file',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    size: integer('size').notNull(),
    type: text('type').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdIdx: index('workspace_file_workspace_id_idx').on(table.workspaceId),
    keyIdx: index('workspace_file_key_idx').on(table.key),
  })
)

export const permissionTypeEnum = pgEnum('permission_type', ['admin', 'write', 'read'])

export const workspaceInvitationStatusEnum = pgEnum('workspace_invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
])

export type WorkspaceInvitationStatus = (typeof workspaceInvitationStatusEnum.enumValues)[number]

export const workspaceInvitation = pgTable('workspace_invitation', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  status: workspaceInvitationStatusEnum('status').notNull().default('pending'),
  token: text('token').notNull().unique(),
  permissions: permissionTypeEnum('permissions').notNull().default('admin'),
  orgInvitationId: text('org_invitation_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const permissions = pgTable(
  'permissions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(), // 'workspace', 'workflow', 'organization', etc.
    entityId: text('entity_id').notNull(), // ID of the workspace, workflow, etc.
    permissionType: permissionTypeEnum('permission_type').notNull(), // Use enum instead of text
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - get all permissions for a user
    userIdIdx: index('permissions_user_id_idx').on(table.userId),

    // Entity-based queries - get all users with permissions on an entity
    entityIdx: index('permissions_entity_idx').on(table.entityType, table.entityId),

    // User + entity type queries - get user's permissions for all workspaces
    userEntityTypeIdx: index('permissions_user_entity_type_idx').on(table.userId, table.entityType),

    // Specific permission checks - does user have specific permission on entity
    userEntityPermissionIdx: index('permissions_user_entity_permission_idx').on(
      table.userId,
      table.entityType,
      table.permissionType
    ),

    // User + specific entity queries - get user's permissions for specific entity
    userEntityIdx: index('permissions_user_entity_idx').on(
      table.userId,
      table.entityType,
      table.entityId
    ),

    // Uniqueness constraint - prevent duplicate permission rows (one permission per user/entity)
    uniquePermissionConstraint: uniqueIndex('permissions_unique_constraint').on(
      table.userId,
      table.entityType,
      table.entityId
    ),
  })
)

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),

    // Track who created the server, but workspace owns it
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    description: text('description'),

    transport: text('transport').notNull(),
    url: text('url'),

    headers: json('headers').default('{}'),
    command: text('command'),
    args: jsonb('args').default('[]'),
    env: jsonb('env').default('{}'),
    timeout: integer('timeout').default(30000),
    retries: integer('retries').default(3),

    enabled: boolean('enabled').notNull().default(true),
    lastConnected: timestamp('last_connected'),
    connectionStatus: text('connection_status').default('disconnected'),
    lastError: text('last_error'),

    toolCount: integer('tool_count').default(0),
    lastToolsRefresh: timestamp('last_tools_refresh'),
    totalRequests: integer('total_requests').default(0),
    lastUsed: timestamp('last_used'),

    deletedAt: timestamp('deleted_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access pattern - active servers by workspace
    workspaceEnabledIdx: index('mcp_servers_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled
    ),

    // Soft delete pattern - workspace + not deleted
    workspaceDeletedIdx: index('mcp_servers_workspace_deleted_idx').on(
      table.workspaceId,
      table.deletedAt
    ),
  })
)
