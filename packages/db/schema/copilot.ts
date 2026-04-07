import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './core'

export const copilotReviewSessions = pgTable(
  'copilot_review_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id'),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id'),
    draftSessionId: text('draft_session_id'),
    channelId: text('channel_id'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title'),
    model: text('model').notNull(),
    conversationId: text('conversation_id'),
    previewYaml: text('preview_yaml'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('copilot_review_sessions_user_id_idx').on(table.userId),
    userEntityIdx: index('copilot_review_sessions_user_entity_idx').on(
      table.userId,
      table.entityKind,
      table.entityId
    ),
    workspaceEntityIdx: index('copilot_review_sessions_workspace_entity_idx').on(
      table.workspaceId,
      table.entityKind,
      table.entityId
    ),
    workspaceDraftIdx: index('copilot_review_sessions_workspace_draft_idx').on(
      table.workspaceId,
      table.entityKind,
      table.draftSessionId
    ),
    userWorkspaceChannelIdx: index('copilot_review_sessions_user_workspace_channel_idx')
      .on(table.userId, sql`coalesce(${table.workspaceId}, 'global')`, table.channelId)
      .where(sql`${table.channelId} IS NOT NULL AND ${table.entityKind} = 'copilot'`),
    savedEntitySessionIdx: uniqueIndex('copilot_review_sessions_saved_entity_unique')
      .on(table.workspaceId, table.entityKind, table.entityId)
      .where(
        sql`${table.channelId} IS NULL AND ${table.entityKind} <> 'workflow' AND ${table.entityId} IS NOT NULL`
      ),
    draftEntitySessionIdx: uniqueIndex('copilot_review_sessions_draft_entity_unique')
      .on(table.userId, table.workspaceId, table.entityKind, table.draftSessionId)
      .where(
        sql`${table.channelId} IS NULL AND ${table.entityKind} <> 'workflow' AND ${table.entityId} IS NULL AND ${table.draftSessionId} IS NOT NULL`
      ),
    createdAtIdx: index('copilot_review_sessions_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('copilot_review_sessions_updated_at_idx').on(table.updatedAt),
  })
)

export const copilotReviewTurns = pgTable(
  'copilot_review_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => copilotReviewSessions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull().default('completed'),
    userMessageItemId: text('user_message_item_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    sessionIdIdx: index('copilot_review_turns_session_id_idx').on(table.sessionId),
    sessionStatusIdx: index('copilot_review_turns_session_status_idx').on(
      table.sessionId,
      table.status
    ),
    sessionSequenceIdx: uniqueIndex('copilot_review_turns_session_sequence_unique').on(
      table.sessionId,
      table.sequence
    ),
  })
)

export const copilotReviewItems = pgTable(
  'copilot_review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => copilotReviewSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').references(() => copilotReviewTurns.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    itemId: text('item_id').notNull(),
    kind: text('kind').notNull().default('message'),
    messageRole: text('message_role').notNull(),
    content: text('content').notNull().default(''),
    timestamp: text('timestamp').notNull(),
    toolCalls: jsonb('tool_calls').notNull().default(sql`'[]'::jsonb`),
    contentBlocks: jsonb('content_blocks').notNull().default(sql`'[]'::jsonb`),
    contexts: jsonb('contexts').notNull().default(sql`'[]'::jsonb`),
    fileAttachments: jsonb('file_attachments').notNull().default(sql`'[]'::jsonb`),
    citations: jsonb('citations').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index('copilot_review_items_session_id_idx').on(table.sessionId),
    turnIdIdx: index('copilot_review_items_turn_id_idx').on(table.turnId),
    kindIdx: index('copilot_review_items_kind_idx').on(table.kind),
    sessionSequenceIdx: uniqueIndex('copilot_review_items_session_sequence_unique').on(
      table.sessionId,
      table.sequence
    ),
    sessionItemIdIdx: uniqueIndex('copilot_review_items_session_item_unique').on(
      table.sessionId,
      table.itemId
    ),
  })
)

export const copilotFeedback = pgTable(
  'copilot_feedback',
  {
    feedbackId: uuid('feedback_id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => copilotReviewSessions.id, { onDelete: 'cascade' }),
    userQuery: text('user_query').notNull(),
    agentResponse: text('agent_response').notNull(),
    isPositive: boolean('is_positive').notNull(),
    feedback: text('feedback'), // Optional feedback text
    workflowYaml: text('workflow_yaml'), // Optional workflow YAML if edit/build workflow was triggered
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // Access patterns
    userIdIdx: index('copilot_feedback_user_id_idx').on(table.userId),
    chatIdIdx: index('copilot_feedback_chat_id_idx').on(table.chatId),
    userChatIdx: index('copilot_feedback_user_chat_idx').on(table.userId, table.chatId),

    // Query patterns
    isPositiveIdx: index('copilot_feedback_is_positive_idx').on(table.isPositive),

    // Ordering indexes
    createdAtIdx: index('copilot_feedback_created_at_idx').on(table.createdAt),
  })
)
