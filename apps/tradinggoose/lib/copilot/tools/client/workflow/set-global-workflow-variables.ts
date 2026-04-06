import { Loader2, Settings2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getRegisteredWorkflowSession,
  getVariablesForWorkflow,
} from '@/lib/yjs/workflow-session-registry'
import { setVariables } from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

interface OperationItem {
  operation: 'add' | 'edit' | 'delete'
  name: string
  type?: 'plain' | 'number' | 'boolean' | 'array' | 'object'
  value?: string
}

interface SetGlobalVarsArgs {
  operations: OperationItem[]
  workflowId?: string
}

export class SetGlobalWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = 'set_global_workflow_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      SetGlobalWorkflowVariablesClientTool.id,
      SetGlobalWorkflowVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set workflow variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set workflow variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting workflow variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow variables updated', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set workflow variables', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted setting variables', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped setting variables', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
  }

  async handleAccept(args?: SetGlobalVarsArgs): Promise<void> {
    const logger = createLogger('SetGlobalWorkflowVariablesClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const payload: SetGlobalVarsArgs = { ...(args || { operations: [] }) }
      if (!payload.workflowId) {
        payload.workflowId = executionContext.workflowId
      }
      if (!payload.workflowId) {
        throw new Error('No active workflow found')
      }

      const currentVarsRecord = getVariablesForWorkflow(payload.workflowId)
      if (!currentVarsRecord) {
        throw new Error('No active Yjs session for this workflow')
      }

      // Helper to convert string -> typed value
      function coerceValue(
        value: string | undefined,
        type?: 'plain' | 'number' | 'boolean' | 'array' | 'object'
      ) {
        if (value === undefined) return value
        const t = type || 'plain'
        try {
          if (t === 'number') {
            const n = Number(value)
            if (Number.isNaN(n)) return value
            return n
          }
          if (t === 'boolean') {
            const v = String(value).trim().toLowerCase()
            if (v === 'true') return true
            if (v === 'false') return false
            return value
          }
          if (t === 'array' || t === 'object') {
            const parsed = JSON.parse(value)
            if (t === 'array' && Array.isArray(parsed)) return parsed
            if (t === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              return parsed
            return value
          }
        } catch {}
        return value
      }

      // Build mutable map by variable name
      const byName: Record<string, any> = {}
      Object.values(currentVarsRecord).forEach((v: any) => {
        if (v && typeof v === 'object' && v.id && v.name) byName[String(v.name)] = v
      })

      // Apply operations in order
      for (const op of payload.operations || []) {
        const key = String(op.name)
        const nextType = (op.type as any) || byName[key]?.type || 'plain'
        if (op.operation === 'delete') {
          delete byName[key]
          continue
        }
        const typedValue = coerceValue(op.value, nextType)
        if (op.operation === 'add') {
          byName[key] = {
            id: crypto.randomUUID(),
            workflowId: payload.workflowId,
            name: key,
            type: nextType,
            value: typedValue,
          }
          continue
        }
        if (op.operation === 'edit') {
          if (!byName[key]) {
            byName[key] = {
              id: crypto.randomUUID(),
              workflowId: payload.workflowId,
              name: key,
              type: nextType,
              value: typedValue,
            }
          } else {
            byName[key] = {
              ...byName[key],
              type: nextType,
              ...(op.value !== undefined ? { value: typedValue } : {}),
            }
          }
        }
      }

      // Apply the updated variables directly to the Yjs doc as a transaction.
      // This is the sole write path - no API call. The canonical save route
      // persists Yjs state to the database when the user saves.
      const updatedRecord: Record<string, any> = {}
      for (const variable of Object.values(byName)) {
        updatedRecord[variable.id] = variable
      }
      const session = getRegisteredWorkflowSession(payload.workflowId)!
      setVariables(session.doc, updatedRecord, YJS_ORIGINS.COPILOT_TOOL)

      logger.info('Applied variable operations to Yjs doc', {
        workflowId: payload.workflowId,
        operationCount: payload.operations?.length ?? 0,
      })

      await this.markToolComplete(200, 'Workflow variables updated', { variables: byName })
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e)
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, message || 'Failed to set workflow variables')
    }
  }

  async execute(args?: SetGlobalVarsArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
