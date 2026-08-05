import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  decimal,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
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
    workspaceId: text('workspace_id').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    folderId: text('folder_id').references(() => workflowFolder.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#3972F6'),
    lastSynced: timestamp('last_synced').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isDeployed: boolean('is_deployed').notNull().default(false),
    deployedState: json('deployed_state'),
    deployedAt: timestamp('deployed_at'),
    pinnedApiKeyId: text('pinned_api_key_id').references(() => apiKey.id, {
      onDelete: 'set null',
    }),
    collaborators: json('collaborators').notNull().default('[]'),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at'),
    variables: json('variables').default('{}'),
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
    workflowId: text('workflow_id').references(() => workflow.id, {
      onDelete: 'set null',
    }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    stateHash: text('state_hash').notNull(),
    stateData: jsonb('state_data').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_snapshots_workflow_id_idx').on(table.workflowId),
    stateHashIdx: index('workflow_snapshots_hash_idx').on(table.stateHash),
    workspaceIdIdx: index('workflow_snapshots_workspace_id_idx').on(table.workspaceId),
    workflowHashUnique: uniqueIndex('workflow_snapshots_workflow_hash_idx').on(
      table.workflowId,
      table.workspaceId,
      table.stateHash
    ),
    createdAtIdx: index('workflow_snapshots_created_at_idx').on(table.createdAt),
  })
)

export const workflowExecutionLogs = pgTable(
  'workflow_execution_logs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, {
      onDelete: 'set null',
    }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    stateSnapshotId: text('state_snapshot_id')
      .notNull()
      .references(() => workflowExecutionSnapshots.id),
    workflowSummary: jsonb('workflow_summary').notNull(),

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
    workspaceIdIdx: index('workflow_execution_logs_workspace_id_idx').on(table.workspaceId),
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
    workspaceStartedAtIdx: index('workflow_execution_logs_workspace_started_at_idx').on(
      table.workspaceId,
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
    blockId: text('block_id').references(() => workflowBlocks.id, {
      onDelete: 'cascade',
    }),
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
    blockId: text('block_id').references(() => workflowBlocks.id, {
      onDelete: 'cascade',
    }), // ID of the webhook trigger block (nullable for legacy starter block webhooks)
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
  'cancelled',
])

export const pendingExecutionStatusEnum = pgEnum('pending_execution_status', [
  'pending',
  'processing',
])

export const workflowExecutionPolicyStateEnum = pgEnum('workflow_execution_policy_state', [
  'uncaptured',
  'bounded',
  'unlimited',
])

export const workflowExecutionTerminalStateEnum = pgEnum('workflow_execution_terminal_state', [
  'running',
  'termination_pending',
  'terminal',
])

export const workflowExecutionAttemptStateEnum = pgEnum('workflow_execution_attempt_state', [
  'processing',
  'canceled',
  'completed',
  'failed',
])

export const workflowExecutionParticipantStateEnum = pgEnum(
  'workflow_execution_participant_state',
  ['active', 'waiting_child', 'canceled', 'completed', 'failed']
)

export const workflowExecutionOperationStateEnum = pgEnum('workflow_execution_operation_state', [
  'registered',
  'running',
  'cancel_requested',
  'canceled',
  'completed',
  'failed',
])

export const workflowExecutionOperationCapabilityEnum = pgEnum(
  'workflow_execution_operation_capability',
  ['local', 'native_cancel_status', 'status_only', 'uncancelable']
)

export const workflowExecutionOutboxStateEnum = pgEnum('workflow_execution_outbox_state', [
  'pending',
  'claimed',
  'completed',
])

export const orderSubmissionSourceEnum = pgEnum('order_submission_source', [
  'manual',
  'copilot',
  'workflow',
])

export const workflowLogWebhookDelivery = pgTable(
  'workflow_log_webhook_delivery',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id').references(() => workflowLogWebhook.id, {
      onDelete: 'set null',
    }),
    workflowId: text('workflow_id').references(() => workflow.id, {
      onDelete: 'set null',
    }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    workflowSummary: jsonb('workflow_summary').notNull(),
    subscriptionSnapshot: jsonb('subscription_snapshot').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    failureReason: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdIdx: index('workflow_log_webhook_delivery_subscription_id_idx').on(
      table.subscriptionId
    ),
    executionIdIdx: index('workflow_log_webhook_delivery_execution_id_idx').on(table.executionId),
    workspaceIdIdx: index('workflow_log_webhook_delivery_workspace_id_idx').on(table.workspaceId),
    statusIdx: index('workflow_log_webhook_delivery_status_idx').on(table.status),
    nextAttemptIdx: index('workflow_log_webhook_delivery_next_attempt_idx').on(table.nextAttemptAt),
  })
)

export const pendingExecution = pgTable(
  'pending_execution',
  {
    id: text('id').primaryKey(),
    billingScopeId: text('billing_scope_id').notNull(),
    billingScopeType: text('billing_scope_type').notNull(),
    executionType: text('execution_type').notNull(),
    orderingKey: text('ordering_key'),
    source: text('source').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').references(() => workflow.id, {
      onDelete: 'cascade',
    }),
    workspaceId: text('workspace_id').references(() => workspace.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').notNull(),
    status: pendingExecutionStatusEnum('status').notNull().default('pending'),
    nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
    processingStartedAt: timestamp('processing_started_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    billingScopeIdx: index('pending_execution_billing_scope_idx').on(
      table.billingScopeId,
      table.status,
      table.nextAttemptAt,
      table.createdAt
    ),
    workflowIdx: index('pending_execution_workflow_idx').on(table.workflowId),
    orderingKeyIdx: index('pending_execution_ordering_key_idx').on(
      table.billingScopeId,
      table.orderingKey,
      table.status,
      table.createdAt
    ),
    sourceIdx: index('pending_execution_source_idx').on(table.source),
    statusIdx: index('pending_execution_status_idx').on(table.status),
  })
)

export const workflowExecutionTerminal = pgTable(
  'workflow_execution_terminal',
  {
    rootExecutionId: text('root_execution_id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    policyState: workflowExecutionPolicyStateEnum('policy_state').notNull().default('uncaptured'),
    state: workflowExecutionTerminalStateEnum('state').notNull().default('running'),
    dispatchOpen: boolean('dispatch_open').notNull().default(true),
    appliedTierId: text('applied_tier_id'),
    appliedTierName: text('applied_tier_name'),
    limitSeconds: decimal('limit_seconds'),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
      precision: 6,
    }),
    terminationRequestedAt: timestamp('termination_requested_at', {
      withTimezone: true,
      precision: 6,
    }),
    deadlineCandidateAt: timestamp('deadline_candidate_at', {
      withTimezone: true,
      precision: 6,
    }),
    cancellationCandidateAt: timestamp('cancellation_candidate_at', {
      withTimezone: true,
      precision: 6,
    }),
    infrastructureCandidateAt: timestamp('infrastructure_candidate_at', {
      withTimezone: true,
      precision: 6,
    }),
    infrastructureDiagnostics: jsonb('infrastructure_diagnostics'),
    lateApplicationResult: jsonb('late_application_result'),
    barrierVersion: integer('barrier_version').notNull().default(0),
    winningCause: text('winning_cause'),
    result: jsonb('result'),
    resultVersion: integer('result_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    stateIdx: index('workflow_execution_terminal_state_idx').on(table.state),
    workspaceIdx: index('workflow_execution_terminal_workspace_idx').on(table.workspaceId),
    policyShape: check(
      'workflow_execution_terminal_policy_shape_check',
      sql`(
        (${table.policyState} = 'uncaptured' and ${table.appliedTierId} is null and ${table.appliedTierName} is null and ${table.processingStartedAt} is null and ${table.limitSeconds} is null)
        or (${table.policyState} = 'unlimited' and ${table.appliedTierId} is not null and ${table.appliedTierName} is not null and ${table.processingStartedAt} is not null and ${table.limitSeconds} is null)
        or (${table.policyState} = 'bounded' and ${table.appliedTierId} is not null and ${table.appliedTierName} is not null and ${table.processingStartedAt} is not null and ${table.limitSeconds} > 0 and ${table.limitSeconds} < 'Infinity'::numeric)
      )`
    ),
    lifecycleShape: check(
      'workflow_execution_terminal_lifecycle_shape_check',
      sql`(
        (${table.state} = 'running' and ${table.dispatchOpen} and ${table.result} is null)
        or (${table.state} = 'termination_pending' and not ${table.dispatchOpen} and ${table.result} is null)
        or (${table.state} = 'terminal' and not ${table.dispatchOpen} and ${table.result} is not null and ${table.winningCause} in ('application', 'deadline', 'cancellation', 'infrastructure') and ${table.resultVersion} > 0)
      ) and ${table.barrierVersion} >= 0 and ${table.resultVersion} >= 0
        and (${table.deadlineCandidateAt} is null or ${table.policyState} = 'bounded')`
    ),
  })
)

export const workflowExecutionDeadline = pgTable(
  'workflow_execution_deadline',
  {
    rootExecutionId: text('root_execution_id')
      .primaryKey()
      .references(() => workflowExecutionTerminal.rootExecutionId, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    triggerType: text('trigger_type').notNull(),
    appliedTierId: text('applied_tier_id').notNull(),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
      precision: 6,
    }).notNull(),
    limitSeconds: decimal('limit_seconds').notNull(),
    limitMicroseconds: decimal('limit_microseconds').notNull(),
    countedMicroseconds: decimal('counted_microseconds').notNull().default('0'),
    lastAccountedAt: timestamp('last_accounted_at', {
      withTimezone: true,
      precision: 6,
    }).notNull(),
    nextReconcileAt: timestamp('next_reconcile_at', {
      withTimezone: true,
      precision: 6,
    }),
    scheduleVersion: integer('schedule_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    dueIdx: index('workflow_execution_deadline_due_idx').on(table.nextReconcileAt),
    ledgerShape: check(
      'workflow_execution_deadline_ledger_shape_check',
      sql`${table.limitSeconds} > 0
        and ${table.limitSeconds} < 'Infinity'::numeric
        and ${table.limitMicroseconds} > 0
        and scale(${table.limitMicroseconds}) = 0
        and ${table.countedMicroseconds} >= 0
        and scale(${table.countedMicroseconds}) = 0
        and ${table.countedMicroseconds} <= ${table.limitMicroseconds}
        and ${table.scheduleVersion} >= 0`
    ),
  })
)

export const workflowExecutionAttempt = pgTable(
  'workflow_execution_attempt',
  {
    id: text('id').primaryKey(),
    rootExecutionId: text('root_execution_id')
      .notNull()
      .references(() => workflowExecutionTerminal.rootExecutionId, { onDelete: 'cascade' }),
    pendingExecutionId: text('pending_execution_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    drainRunId: text('drain_run_id'),
    state: workflowExecutionAttemptStateEnum('state').notNull().default('processing'),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
      precision: 6,
    }).notNull(),
    processingCompletedAt: timestamp('processing_completed_at', {
      withTimezone: true,
      precision: 6,
    }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    rootIdx: index('workflow_execution_attempt_root_idx').on(table.rootExecutionId),
    pendingAttemptUnique: uniqueIndex('workflow_execution_attempt_pending_number_unique').on(
      table.pendingExecutionId,
      table.attemptNumber
    ),
    openIdx: index('workflow_execution_attempt_open_idx').on(table.processingCompletedAt),
    lifecycleShape: check(
      'workflow_execution_attempt_lifecycle_shape_check',
      sql`${table.attemptNumber} > 0 and (
        (${table.state} = 'processing' and ${table.processingCompletedAt} is null)
        or (${table.state} in ('canceled', 'completed', 'failed') and ${table.processingCompletedAt} is not null and ${table.processingCompletedAt} >= ${table.processingStartedAt})
      )`
    ),
  })
)

export const workflowExecutionParticipant = pgTable(
  'workflow_execution_participant',
  {
    id: text('id').primaryKey(),
    rootExecutionId: text('root_execution_id')
      .notNull()
      .references(() => workflowExecutionTerminal.rootExecutionId, { onDelete: 'cascade' }),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => workflowExecutionAttempt.id, { onDelete: 'cascade' }),
    pendingExecutionId: text('pending_execution_id').notNull(),
    state: workflowExecutionParticipantStateEnum('state').notNull().default('active'),
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
      precision: 6,
    }).notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', {
      withTimezone: true,
      precision: 6,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    rootIdx: index('workflow_execution_participant_root_idx').on(table.rootExecutionId),
    leaseIdx: index('workflow_execution_participant_lease_idx').on(table.leaseExpiresAt),
    leaseOrder: check(
      'workflow_execution_participant_lease_order_check',
      sql`${table.leaseExpiresAt} >= ${table.lastHeartbeatAt}`
    ),
  })
)

export const workflowExecutionOperation = pgTable(
  'workflow_execution_operation',
  {
    id: text('id').primaryKey(),
    rootExecutionId: text('root_execution_id')
      .notNull()
      .references(() => workflowExecutionTerminal.rootExecutionId, { onDelete: 'cascade' }),
    executionId: text('execution_id').notNull(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => workflowExecutionAttempt.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => workflowExecutionParticipant.id, {
      onDelete: 'set null',
    }),
    blockId: text('block_id'),
    handlerType: text('handler_type').notNull(),
    adapterKind: text('adapter_kind').notNull(),
    capability: workflowExecutionOperationCapabilityEnum('capability').notNull(),
    state: workflowExecutionOperationStateEnum('state').notNull().default('registered'),
    remoteOperationId: text('remote_operation_id'),
    observation: jsonb('observation'),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true, precision: 6 }),
    nextReconcileAt: timestamp('next_reconcile_at', { withTimezone: true, precision: 6 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, precision: 6 }),
    fencingToken: text('fencing_token'),
    terminalAt: timestamp('terminal_at', { withTimezone: true, precision: 6 }),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    rootStateIdx: index('workflow_execution_operation_root_state_idx').on(
      table.rootExecutionId,
      table.state
    ),
    leaseIdx: index('workflow_execution_operation_lease_idx').on(table.leaseExpiresAt),
    lifecycleShape: check(
      'workflow_execution_operation_lifecycle_shape_check',
      sql`(
        (${table.state} in ('registered', 'running', 'cancel_requested') and ${table.terminalAt} is null)
        or (${table.state} in ('canceled', 'completed', 'failed') and ${table.terminalAt} is not null)
      ) and ((${table.leaseExpiresAt} is null) = (${table.fencingToken} is null))`
    ),
  })
)

export const workflowExecutionOutbox = pgTable(
  'workflow_execution_outbox',
  {
    rootExecutionId: text('root_execution_id')
      .notNull()
      .references(() => workflowExecutionTerminal.rootExecutionId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    state: workflowExecutionOutboxStateEnum('state').notNull().default('pending'),
    availableAt: timestamp('available_at', { withTimezone: true, precision: 6 })
      .notNull()
      .defaultNow(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true, precision: 6 }),
    fencingToken: text('fencing_token'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, precision: 6 }),
  },
  (table) => ({
    pk: primaryKey({
      name: 'workflow_execution_outbox_pkey',
      columns: [table.rootExecutionId, table.kind, table.version],
    }),
    stateIdx: index('workflow_execution_outbox_state_idx').on(
      table.state,
      table.availableAt,
      table.claimExpiresAt
    ),
    lifecycleShape: check(
      'workflow_execution_outbox_lifecycle_shape_check',
      sql`${table.version} >= 0 and ${table.attemptCount} >= 0 and (
        (${table.state} = 'pending' and ${table.claimExpiresAt} is null and ${table.fencingToken} is null and ${table.completedAt} is null)
        or (${table.state} = 'claimed' and ${table.claimExpiresAt} is not null and ${table.fencingToken} is not null and ${table.completedAt} is null)
        or (${table.state} = 'completed' and ${table.claimExpiresAt} is null and ${table.completedAt} is not null)
      )`
    ),
  })
)

export const memory = pgTable(
  'memory',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflow.id, {
      onDelete: 'cascade',
    }),
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
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    environment: text('environment'),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
    submissionSource: orderSubmissionSourceEnum('submission_source').notNull(),
    logId: text('log_id').references(() => workflowExecutionLogs.id, {
      onDelete: 'set null',
    }),
    listingIdentity: jsonb('listing_identity'),
    request: jsonb('request').notNull(),
    response: jsonb('response').notNull(),
    normalizedOrder: jsonb('normalized_order'),
  },
  (table) => ({
    providerIdx: index('order_history_provider_idx').on(table.provider),
    workspaceIdx: index('order_history_workspace_idx').on(table.workspaceId),
    logIdx: index('order_history_log_idx').on(table.logId),
    recordedAtIdx: index('order_history_recorded_at_idx').on(table.recordedAt),
    workspaceRecordedIdx: index('order_history_workspace_recorded_idx').on(
      table.workspaceId,
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
