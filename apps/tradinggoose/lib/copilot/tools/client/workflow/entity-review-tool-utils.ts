'use client'

import {
  type BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  type ClientToolExecutionContext,
  type DynamicTextFormatter,
} from '@/lib/copilot/tools/client/base-tool'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import {
  getRegisteredEntitySession,
  type RegisteredEntitySession,
} from '@/lib/yjs/entity-session-registry'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export function resolveWorkspaceIdFromExecutionContext(
  executionContext: ClientToolExecutionContext
): string {
  if (executionContext.workspaceId) {
    return executionContext.workspaceId
  }

  if (executionContext.workflowId) {
    const workflow = useWorkflowRegistry.getState().workflows[executionContext.workflowId]
    if (workflow?.workspaceId) {
      return workflow.workspaceId
    }
  }

  throw new Error('No active workspace found')
}

export function requireActiveEntitySession(
  executionContext: ClientToolExecutionContext,
  expectedKind: Exclude<ReviewEntityKind, 'workflow'>
): RegisteredEntitySession {
  if (!executionContext.reviewSessionId) {
    throw new Error('No active review session found')
  }

  const session = getRegisteredEntitySession(executionContext.reviewSessionId)
  if (!session) {
    throw new Error('No active entity session found')
  }

  if (session.descriptor.entityKind !== expectedKind) {
    throw new Error(
      `Active review target kind mismatch: expected ${expectedKind}, got ${session.descriptor.entityKind}`
    )
  }

  if (
    executionContext.entityId &&
    session.descriptor.entityId &&
    executionContext.entityId !== session.descriptor.entityId
  ) {
    throw new Error('Active entity session does not match the requested entity')
  }

  if (
    executionContext.draftSessionId &&
    session.descriptor.draftSessionId &&
    executionContext.draftSessionId !== session.descriptor.draftSessionId
  ) {
    throw new Error('Active entity session does not match the requested draft')
  }

  return session
}

export function unsupportedDeleteError(): never {
  throw new Error('Delete is not supported in review mode')
}

/**
 * Creates a getDynamicText function for entity management tools (custom tool, skill, MCP).
 *
 * @param entityNoun - Singular display name, e.g. "custom tool"
 * @param entityNounPlural - Plural display name for list operations, e.g. "custom tools"
 * @param nameExtractor - Extracts the entity name from tool params
 * @param addVerbs - Override the add-operation verbs (default: Create/Created/Creating)
 */
export function createEntityDynamicText(opts: {
  entityNoun: string
  entityNounPlural: string
  nameExtractor: (params: Record<string, any>) => string | undefined
  addVerbs?: { present: string; past: string; gerund: string }
}): DynamicTextFormatter {
  const { entityNoun, entityNounPlural, nameExtractor } = opts
  const addVerbs = opts.addVerbs ?? { present: 'Create', past: 'Created', gerund: 'Creating' }

  const verbMap: Record<string, { present: string; past: string; gerund: string }> = {
    add: addVerbs,
    edit: { present: 'Edit', past: 'Edited', gerund: 'Editing' },
    list: { present: 'List', past: 'Listed', gerund: 'Listing' },
    delete: { present: 'Delete', past: 'Deleted', gerund: 'Deleting' },
  }

  return (params, state) => {
    const operation = params?.operation as string | undefined
    if (!operation || !verbMap[operation]) return undefined

    const verbs = verbMap[operation]
    const name = nameExtractor(params)

    const nameText =
      operation === 'list'
        ? ` ${entityNounPlural}`
        : name && state !== ClientToolCallState.pending
          ? ` ${name}`
          : ` ${entityNoun}`

    switch (state) {
      case ClientToolCallState.success:
        return `${verbs.past}${nameText}`
      case ClientToolCallState.executing:
      case ClientToolCallState.generating:
        return `${verbs.gerund}${nameText}`
      case ClientToolCallState.pending:
        return `${verbs.present}${nameText}?`
      case ClientToolCallState.error:
        return `Failed to ${verbs.present.toLowerCase()}${nameText}`
      case ClientToolCallState.aborted:
        return `Aborted ${verbs.gerund.toLowerCase()}${nameText}`
      case ClientToolCallState.rejected:
        return `Skipped ${verbs.gerund.toLowerCase()}${nameText}`
    }
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Generic entity-tool orchestration
// ---------------------------------------------------------------------------

/** Args shape shared by all entity management tools. */
export interface EntityToolArgs {
  operation: 'add' | 'edit' | 'list'
}

/** Entity-specific handlers provided to the factory. */
export interface EntityToolHandlers<TArgs extends EntityToolArgs> {
  /** Entity display name used in error messages, e.g. "custom tool" */
  entityLabel: string
  /** Logger name, e.g. "ManageCustomToolClientTool" */
  loggerName: string
  /**
   * Extra fields to include in the executeOperation log entry.
   * Receives the parsed args.
   */
  getLogDetails?: (args: TArgs) => Record<string, any>
  /** Handle the 'list' operation. */
  list: (workspaceId: string) => Promise<void>
  /** Handle the 'add' operation. */
  add: (args: TArgs) => Promise<void>
  /** Handle the 'edit' operation. */
  edit: (args: TArgs) => Promise<void>
}

export interface EntityToolOrchestration<TArgs extends EntityToolArgs> {
  /** Read the args from the copilot store (fallback when currentArgs is not set). */
  getArgsFromStore: (toolCallId: string) => TArgs | undefined
  /**
   * Return interrupt displays only for mutating operations (add/edit).
   * `currentArgs` is the value cached in `execute()`.
   */
  getInterruptDisplays: (
    currentArgs: TArgs | undefined,
    toolCallId: string,
    metadata: BaseClientToolMetadata
  ) => BaseClientToolMetadata['interrupt'] | undefined
  /**
   * The shared handleAccept orchestration: sets executing state, dispatches
   * to the correct handler, and catches errors.
   */
  handleAccept: (
    tool: BaseClientTool,
    args: TArgs | undefined,
    executionContext: ClientToolExecutionContext
  ) => Promise<void>
  /**
   * The shared executeOperation dispatcher (list/add/edit/default).
   * Resolves the workspace, logs, and delegates to the entity-specific handler.
   */
  executeOperation: (
    args: TArgs | undefined,
    executionContext: ClientToolExecutionContext
  ) => Promise<void>
}

/**
 * Creates the shared orchestration methods used by every entity management tool.
 *
 * Each tool supplies only its entity-specific handlers (list, add, edit) and gets
 * back the identical boilerplate that was previously duplicated across
 * manage-custom-tool, manage-skill, manage-mcp-tool, and manage-indicator.
 */
export function createEntityToolExecutor<TArgs extends EntityToolArgs>(
  handlers: EntityToolHandlers<TArgs>
): EntityToolOrchestration<TArgs> {
  const logger = createLogger(handlers.loggerName)

  function getArgsFromStore(toolCallId: string): TArgs | undefined {
    try {
      const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
      const toolCall = toolCallsById[toolCallId]
      return (toolCall as any)?.params as TArgs | undefined
    } catch {
      return undefined
    }
  }

  function getInterruptDisplays(
    currentArgs: TArgs | undefined,
    toolCallId: string,
    metadata: BaseClientToolMetadata
  ): BaseClientToolMetadata['interrupt'] | undefined {
    const args = currentArgs || getArgsFromStore(toolCallId)
    if (args?.operation && args.operation !== 'list') {
      return metadata.interrupt
    }
    return undefined
  }

  async function executeOperation(
    args: TArgs | undefined,
    executionContext: ClientToolExecutionContext
  ): Promise<void> {
    if (!args?.operation) {
      throw new Error('Operation is required')
    }

    const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)

    const logDetails: Record<string, any> = {
      operation: args.operation,
      workspaceId,
      reviewSessionId: executionContext.reviewSessionId,
      ...(handlers.getLogDetails?.(args) ?? {}),
    }

    logger.info(`Executing ${handlers.entityLabel} operation: ${args.operation}`, logDetails)

    switch (args.operation) {
      case 'list':
        await handlers.list(workspaceId)
        break
      case 'add':
        await handlers.add(args)
        break
      case 'edit':
        await handlers.edit(args)
        break
      default:
        unsupportedDeleteError()
    }
  }

  async function handleAccept(
    tool: BaseClientTool,
    args: TArgs | undefined,
    executionContext: ClientToolExecutionContext
  ): Promise<void> {
    try {
      tool.setState(ClientToolCallState.executing)
      await executeOperation(args, executionContext)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      tool.setState(ClientToolCallState.error)
      await tool.markToolComplete(
        500,
        e?.message || `Failed to manage ${handlers.entityLabel}`
      )
    }
  }

  return { getArgsFromStore, getInterruptDisplays, handleAccept, executeOperation }
}
