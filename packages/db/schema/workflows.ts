import { sql } from 'drizzle-orm'
import {
  boolean,
  decimal,
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
import { copilotReviewSessions } from './copilot'
import { user, workspace } from './core'
import { apiKey } from './workspaces'

export const workflowFolder = pgTable(
  'workflow_folder',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'), // Self-reference will be handled by foreign key constraint
    color: text('color').default('#6B7280'),
    isExpanded: boolean('is_expanded').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('workflow_folder_user_idx').on(table.userId),
    workspaceParentIdx: index('workflow_folder_workspace_parent_idx').on(
      table.workspaceId,
      table.parentId
    ),
    parentSortIdx: index('workflow_folder_parent_sort_idx').on(table.parentId, table.sortOrder),
  })
)

export const workflow = pgTable(
  'workflow',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => workflowFolder.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#3972F6'),
    lastSynced: timestamp('last_synced').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isDeployed: boolean('is_deployed').notNull().default(false),
    deployedState: json('deployed_state'),
    deployedAt: timestamp('deployed_at'),
    pinnedApiKeyId: text('pinned_api_key_id').references(() => apiKey.id, { onDelete: 'set null' }),
    collaborators: json('collaborators').notNull().default('[]'),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    variables: json('variables').default('{}'),
    isPublished: boolean('is_published').notNull().default(false),
    marketplaceData: json('marketplace_data'),
  },
  (table) => ({
    userIdIdx: index('workflow_user_id_idx').on(table.userId),
    workspaceIdIdx: index('workflow_workspace_id_idx').on(table.workspaceId),
    userWorkspaceIdx: index('workflow_user_workspace_idx').on(table.userId, table.workspaceId),
  })
)

export const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // 'starter', 'agent', 'api', 'function'
    name: text('name').notNull(),

    positionX: decimal('position_x').notNull(),
    positionY: decimal('position_y').notNull(),

    enabled: boolean('enabled').notNull().default(true),
    horizontalHandles: boolean('horizontal_handles').notNull().default(true),
    isWide: boolean('is_wide').notNull().default(false),
    advancedMode: boolean('advanced_mode').notNull().default(false),
    triggerMode: boolean('trigger_mode').notNull().default(false),
    height: decimal('height').notNull().default('0'),

    subBlocks: jsonb('sub_blocks').notNull().default('{}'),
    outputs: jsonb('outputs').notNull().default('{}'),
    data: jsonb('data').default('{}'),
    layout: jsonb('layout').notNull().default('{}'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),
    workflowTypeIdx: index('workflow_blocks_workflow_type_idx').on(table.workflowId, table.type),
  })
)

export const workflowEdges = pgTable(
  'workflow_edges',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    sourceBlockId: text('source_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    targetBlockId: text('target_block_id')
      .notNull()
      .references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_edges_workflow_id_idx').on(table.workflowId),
    workflowSourceIdx: index('workflow_edges_workflow_source_idx').on(
      table.workflowId,
      table.sourceBlockId
    ),
    workflowTargetIdx: index('workflow_edges_workflow_target_idx').on(
      table.workflowId,
      table.targetBlockId
    ),
  })
)

export const workflowSubflows = pgTable(
  'workflow_subflows',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // 'loop' or 'parallel'
    config: jsonb('config').notNull().default('{}'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_subflows_workflow_id_idx').on(table.workflowId),
    workflowTypeIdx: index('workflow_subflows_workflow_type_idx').on(table.workflowId, table.type),
  })
)

export const workflowExecutionSnapshots = pgTable(
  'workflow_execution_snapshots',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    stateHash: text('state_hash').notNull(),
    stateData: jsonb('state_data').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_snapshots_workflow_id_idx').on(table.workflowId),
    stateHashIdx: index('workflow_snapshots_hash_idx').on(table.stateHash),
    workflowHashUnique: uniqueIndex('workflow_snapshots_workflow_hash_idx').on(
      table.workflowId,
      table.stateHash
    ),
    createdAtIdx: index('workflow_snapshots_created_at_idx').on(table.createdAt),
  })
)

export const workflowExecutionLogs = pgTable(
  'workflow_execution_logs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    stateSnapshotId: text('state_snapshot_id')
      .notNull()
      .references(() => workflowExecutionSnapshots.id),

    level: text('level').notNull(), // 'info', 'error'
    trigger: text('trigger').notNull(), // 'api', 'webhook', 'schedule', 'manual', 'chat'

    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    totalDurationMs: integer('total_duration_ms'),

    executionData: jsonb('execution_data').notNull().default('{}'),
    cost: jsonb('cost'),
    files: jsonb('files'), // File metadata for execution files
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_execution_logs_workflow_id_idx').on(table.workflowId),
    executionIdIdx: index('workflow_execution_logs_execution_id_idx').on(table.executionId),
    stateSnapshotIdIdx: index('workflow_execution_logs_state_snapshot_id_idx').on(
      table.stateSnapshotId
    ),
    triggerIdx: index('workflow_execution_logs_trigger_idx').on(table.trigger),
    levelIdx: index('workflow_execution_logs_level_idx').on(table.level),
    startedAtIdx: index('workflow_execution_logs_started_at_idx').on(table.startedAt),
    executionIdUnique: uniqueIndex('workflow_execution_logs_execution_id_unique').on(
      table.executionId
    ),
    // Composite index for the new join-based query pattern
    workflowStartedAtIdx: index('workflow_execution_logs_workflow_started_at_idx').on(
      table.workflowId,
      table.startedAt
    ),
  })
)

export const workflowSchedule = pgTable(
  'workflow_schedule',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    blockId: text('block_id').references(() => workflowBlocks.id, { onDelete: 'cascade' }),
    cronExpression: text('cron_expression'),
    nextRunAt: timestamp('next_run_at'),
    lastRanAt: timestamp('last_ran_at'),
    triggerType: text('trigger_type').notNull(), // "manual", "webhook", "schedule"
    timezone: text('timezone').notNull().default('UTC'),
    failedCount: integer('failed_count').notNull().default(0), // Track consecutive failures
    status: text('status').notNull().default('active'), // 'active' or 'disabled'
    lastFailedAt: timestamp('last_failed_at'), // When the schedule last failed
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      workflowBlockUnique: uniqueIndex('workflow_schedule_workflow_block_unique').on(
        table.workflowId,
        table.blockId
      ),
    }
  }
)

export const webhook = pgTable(
  'webhook',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    blockId: text('block_id').references(() => workflowBlocks.id, { onDelete: 'cascade' }), // ID of the webhook trigger block (nullable for legacy starter block webhooks)
    path: text('path').notNull(),
    provider: text('provider'), // e.g., "whatsapp", "github", etc.
    providerConfig: json('provider_config'), // Store provider-specific configuration
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure webhook paths are unique
      pathIdx: uniqueIndex('path_idx').on(table.path),
    }
  }
)

export const workflowLogWebhook = pgTable(
  'workflow_log_webhook',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret'),
    includeFinalOutput: boolean('include_final_output').notNull().default(false),
    includeTraceSpans: boolean('include_trace_spans').notNull().default(false),
    includeRateLimits: boolean('include_rate_limits').notNull().default(false),
    includeUsageData: boolean('include_usage_data').notNull().default(false),
    levelFilter: text('level_filter')
      .array()
      .notNull()
      .default(sql`ARRAY['info', 'error']::text[]`),
    triggerFilter: text('trigger_filter')
      .array()
      .notNull()
      .default(sql`ARRAY['api', 'webhook', 'schedule', 'manual', 'chat']::text[]`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_log_webhook_workflow_id_idx').on(table.workflowId),
    activeIdx: index('workflow_log_webhook_active_idx').on(table.active),
  })
)

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'in_progress',
  'success',
  'failed',
])

export const workflowLogWebhookDelivery = pgTable(
  'workflow_log_webhook_delivery',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => workflowLogWebhook.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdIdx: index('workflow_log_webhook_delivery_subscription_id_idx').on(
      table.subscriptionId
    ),
    executionIdIdx: index('workflow_log_webhook_delivery_execution_id_idx').on(table.executionId),
    statusIdx: index('workflow_log_webhook_delivery_status_idx').on(table.status),
    nextAttemptIdx: index('workflow_log_webhook_delivery_next_attempt_idx').on(table.nextAttemptAt),
  })
)

export const marketplace = pgTable('marketplace', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflow.id, { onDelete: 'cascade' }),
  state: json('state').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  authorId: text('author_id')
    .notNull()
    .references(() => user.id),
  authorName: text('author_name').notNull(),
  views: integer('views').notNull().default(0),
  category: text('category'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const memory = pgTable(
  'memory',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // Identifier for the memory within its context
    type: text('type').notNull(), // 'agent' or 'raw'
    data: json('data').notNull(), // Stores either agent message data or raw data
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => {
    return {
      // Add index on key for faster lookups
      keyIdx: index('memory_key_idx').on(table.key),

      // Add index on workflowId for faster filtering
      workflowIdx: index('memory_workflow_idx').on(table.workflowId),

      // Compound unique index to ensure keys are unique per workflow
      uniqueKeyPerWorkflowIdx: uniqueIndex('memory_workflow_key_idx').on(
        table.workflowId,
        table.key
      ),
    }
  }
)

export const orderHistoryTable = pgTable(
  'orderHistoryTable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    environment: text('environment'),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    workflowExecutionId: text('workflow_execution_id'),
    listingIdentity: jsonb('listing_identity'),
    request: jsonb('request').notNull(),
    response: jsonb('response').notNull(),
    normalizedOrder: jsonb('normalized_order'),
  },
  (table) => ({
    providerIdx: index('order_history_provider_idx').on(table.provider),
    workflowIdx: index('order_history_workflow_idx').on(table.workflowId),
    workflowExecutionIdx: index('order_history_execution_idx').on(table.workflowExecutionId),
    recordedAtIdx: index('order_history_recorded_at_idx').on(table.recordedAt),
    workflowRecordedIdx: index('order_history_workflow_recorded_idx').on(
      table.workflowId,
      table.recordedAt
    ),
  })
)

// Tracks immutable deployment versions for each workflow
export const workflowDeploymentVersion = pgTable(
  'workflow_deployment_version',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name'),
    state: json('state').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_deployment_version_workflow_id_idx').on(table.workflowId),
    workflowVersionUnique: uniqueIndex('workflow_deployment_version_workflow_version_unique').on(
      table.workflowId,
      table.version
    ),
    workflowActiveIdx: index('workflow_deployment_version_workflow_active_idx').on(
      table.workflowId,
      table.isActive
    ),
    createdAtIdx: index('workflow_deployment_version_created_at_idx').on(table.createdAt),
  })
)

export const chat = pgTable(
  'chat',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    triggerBlockId: text('trigger_block_id'),
    deploymentVersionId: text('deployment_version_id').references(
      () => workflowDeploymentVersion.id,
      { onDelete: 'set null' }
    ),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    customizations: json('customizations').default('{}'), // For UI customization options

    // Authentication options
    authType: text('auth_type').notNull().default('public'), // 'public', 'password', 'email', 'sso'
    password: text('password'), // Stored hashed, populated when authType is 'password'
    allowedEmails: json('allowed_emails').default('[]'), // Array of allowed emails or domains when authType is 'email' or 'sso'

    // Output configuration
    outputConfigs: json('output_configs').default('[]'), // Array of {blockId, path} objects

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      // Ensure identifiers are unique
      identifierIdx: uniqueIndex('identifier_idx').on(table.identifier),
      workflowTriggerUnique: uniqueIndex('chat_workflow_trigger_unique').on(
        table.workflowId,
        table.triggerBlockId
      ),
      deploymentVersionIdx: index('chat_deployment_version_idx').on(table.deploymentVersionId),
    }
  }
)

export const workflowCheckpoints = pgTable(
  'workflow_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotReviewSessions.id, { onDelete: 'cascade' }),
    messageId: text('message_id'), // ID of the user message that triggered this checkpoint
    workflowState: json('workflow_state').notNull(), // JSON workflow state
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('workflow_checkpoints_user_id_idx').on(table.userId),
    workflowIdIdx: index('workflow_checkpoints_workflow_id_idx').on(table.workflowId),
    chatIdIdx: index('workflow_checkpoints_chat_id_idx').on(table.chatId),
    messageIdIdx: index('workflow_checkpoints_message_id_idx').on(table.messageId),

    // Combined indexes for common queries
    userWorkflowIdx: index('workflow_checkpoints_user_workflow_idx').on(
      table.userId,
      table.workflowId
    ),
    workflowChatIdx: index('workflow_checkpoints_workflow_chat_idx').on(
      table.workflowId,
      table.chatId
    ),

    // Ordering indexes
    createdAtIdx: index('workflow_checkpoints_created_at_idx').on(table.createdAt),
    chatCreatedAtIdx: index('workflow_checkpoints_chat_created_at_idx').on(
      table.chatId,
      table.createdAt
    ),
  })
)

export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    author: text('author').notNull(),
    views: integer('views').notNull().default(0),
    stars: integer('stars').notNull().default(0),
    color: text('color').notNull().default('#3972F6'),
    icon: text('icon').notNull().default('FileText'), // Lucide icon name as string
    category: text('category').notNull(),
    state: jsonb('state').notNull(), // Using jsonb for better performance
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    workflowIdIdx: index('templates_workflow_id_idx').on(table.workflowId),
    userIdIdx: index('templates_user_id_idx').on(table.userId),
    categoryIdx: index('templates_category_idx').on(table.category),

    // Sorting indexes for popular/trending templates
    viewsIdx: index('templates_views_idx').on(table.views),
    starsIdx: index('templates_stars_idx').on(table.stars),

    // Composite indexes for common queries
    categoryViewsIdx: index('templates_category_views_idx').on(table.category, table.views),
    categoryStarsIdx: index('templates_category_stars_idx').on(table.category, table.stars),
    userCategoryIdx: index('templates_user_category_idx').on(table.userId, table.category),

    // Temporal indexes
    createdAtIdx: index('templates_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('templates_updated_at_idx').on(table.updatedAt),
  })
)

export const templateStars = pgTable(
  'template_stars',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    starredAt: timestamp('starred_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary access patterns
    userIdIdx: index('template_stars_user_id_idx').on(table.userId),
    templateIdIdx: index('template_stars_template_id_idx').on(table.templateId),

    // Composite indexes for common queries
    userTemplateIdx: index('template_stars_user_template_idx').on(table.userId, table.templateId),
    templateUserIdx: index('template_stars_template_user_idx').on(table.templateId, table.userId),

    // Temporal indexes for analytics
    starredAtIdx: index('template_stars_starred_at_idx').on(table.starredAt),
    templateStarredAtIdx: index('template_stars_template_starred_at_idx').on(
      table.templateId,
      table.starredAt
    ),

    // Uniqueness constraint - prevent duplicate stars
    uniqueUserTemplateConstraint: uniqueIndex('template_stars_user_template_unique').on(
      table.userId,
      table.templateId
    ),
  })
)

// Idempotency keys for preventing duplicate processing across all webhooks and triggers
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: text('key').notNull(),
    namespace: text('namespace').notNull().default('default'),
    result: json('result').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Primary key is combination of key and namespace
    keyNamespacePk: uniqueIndex('idempotency_key_namespace_unique').on(table.key, table.namespace),

    // Index for cleanup operations by creation time
    createdAtIdx: index('idempotency_key_created_at_idx').on(table.createdAt),

    // Index for namespace-based queries
    namespaceIdx: index('idempotency_key_namespace_idx').on(table.namespace),
  })
)
