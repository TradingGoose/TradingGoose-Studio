import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import {
  isTerminalWorkflowExecutionEvent,
  type WorkflowExecutionEvent,
} from '@/lib/workflows/execution-events'
import {
  cancelQueuedWorkflowExecution,
  observeQueuedWorkflowExecution,
  type QueuedWorkflowExecutionHandle,
  queueWorkflowExecution,
} from '@/lib/workflows/queued-execution-client'
import { resolveWorkflowRunTrigger, TriggerUtils } from '@/lib/workflows/triggers'
import { getVariablesSnapshot } from '@/lib/yjs/workflow-session'
import { useWorkflowSession } from '@/lib/yjs/workflow-session-host'
import type { ExecutionResult } from '@/executor/types'
import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { buildExecutableWorkflowData } from '@/stores/workflows/workflow/utils'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('useWorkflowExecution')
const WORKFLOW_EXECUTION_FAILURE_MESSAGE = 'Workflow execution failed'
type WorkflowExecutionTriggerType = 'chat' | 'manual'
type WorkflowExecutionRequest = {
  input?: unknown
  triggerType?: WorkflowExecutionTriggerType
  triggerBlockId?: string
  selectedOutputs?: string[]
  onAdmitted?: () => void
  onEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>
}

type ActiveWorkflowExecution = {
  owner: symbol
  controller: AbortController
  userId: string
  workflowId: string
  taskId?: string
  cancelRequested?: boolean
}

type ManualRunFeedback =
  | { state: 'idle' | 'running' | 'success' }
  | { state: 'error'; message: string }

type ManualFeedbackPresenter = {
  owner: symbol
  workflowId: string
}

let activeExecution: ActiveWorkflowExecution | null = null
let manualFeedbackPresenter: ManualFeedbackPresenter | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const executionStorageKey = (userId: string, workflowId: string) =>
  `workflow-execution:${userId}:${workflowId}`

export function useWorkflowExecution() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const { workflowId: activeWorkflowId, workspaceId } = useWorkflowRoute()
  const { canEdit, doc, error, isLoading, readWorkflowSnapshot } = useWorkflowSession()
  const { isExecuting, setIsExecuting, setIsDebugging, setPendingBlocks, setActiveBlocks } =
    useExecutionStore()
  const ownerRef = useRef(Symbol('workflow-execution-owner'))
  const [manualRunResult, setManualRunResult] = useState<ExecutionResult | 'running' | null>(null)
  const isWorkflowSessionReady = canEdit && Boolean(doc) && !isLoading && !error
  const isWorkflowSessionReadyRef = useRef(isWorkflowSessionReady)
  isWorkflowSessionReadyRef.current = isWorkflowSessionReady

  const applyExecutionEvent = useCallback(
    (event: WorkflowExecutionEvent) => {
      useConsoleStore.getState().ingestWorkflowExecutionEvent(event)

      if (event.type === 'block:started') {
        const activeBlockIds = new Set(useExecutionStore.getState().activeBlockIds)
        activeBlockIds.add(event.data.blockId)
        setActiveBlocks(activeBlockIds)
        return
      }

      if (event.type === 'block:completed' || event.type === 'block:error') {
        const activeBlockIds = new Set(useExecutionStore.getState().activeBlockIds)
        activeBlockIds.delete(event.data.blockId)
        setActiveBlocks(activeBlockIds)
        return
      }

      if (isTerminalWorkflowExecutionEvent(event)) {
        setActiveBlocks(new Set())
      }
    },
    [setActiveBlocks]
  )

  const resetExecutionState = useCallback(() => {
    setIsExecuting(false)
    setIsDebugging(false)
    setPendingBlocks([])
    setActiveBlocks(new Set())
  }, [setActiveBlocks, setIsDebugging, setIsExecuting, setPendingBlocks])

  useEffect(() => {
    const owner = ownerRef.current
    return () => {
      if (
        activeExecution?.owner === owner &&
        activeExecution.userId === userId &&
        activeExecution.workflowId === activeWorkflowId
      ) {
        activeExecution.controller.abort()
        activeExecution = null
        resetExecutionState()
      }
      if (manualFeedbackPresenter?.owner === owner) manualFeedbackPresenter = null
    }
  }, [activeWorkflowId, resetExecutionState, userId])

  const runExecution = useCallback(
    async (
      executionId: string,
      request: WorkflowExecutionRequest,
      admit: (
        execution: ActiveWorkflowExecution
      ) => Promise<QueuedWorkflowExecutionHandle | undefined>
    ) => {
      if (!userId || !activeWorkflowId || activeExecution) return
      const owner = ownerRef.current
      const controller = new AbortController()
      const execution: ActiveWorkflowExecution = {
        owner,
        controller,
        userId,
        workflowId: activeWorkflowId,
      }
      activeExecution = execution
      const manual = request.triggerType !== 'chat'
      manualFeedbackPresenter = manual ? { owner, workflowId: activeWorkflowId } : null
      if (manual) setManualRunResult('running')
      setIsExecuting(true)
      setIsDebugging(false)
      setPendingBlocks([])
      const key = executionStorageKey(userId, activeWorkflowId)
      let saved: string | undefined
      let settled = false
      let result: ExecutionResult
      try {
        const handle = await admit(execution)
        if (!handle) {
          if (manual && !controller.signal.aborted) setManualRunResult(null)
          return
        }
        execution.taskId = handle.taskId
        saved = JSON.stringify(handle)
        sessionStorage.setItem(key, saved)
        if (execution.cancelRequested)
          void cancelQueuedWorkflowExecution(handle.taskId).catch((error) => {
            logger.error('Failed to cancel workflow execution', error)
          })
        result = await observeQueuedWorkflowExecution(handle, {
          signal: controller.signal,
          callbacks: {
            onEvent: async (event) => {
              if (controller.signal.aborted) return
              applyExecutionEvent(event)
              await request.onEvent?.(event)
            },
          },
        })
        settled = true
      } catch (error) {
        result = {
          success: false,
          output: {},
          error: error instanceof Error ? error.message : WORKFLOW_EXECUTION_FAILURE_MESSAGE,
          logs: [],
        }
      } finally {
        if (settled && sessionStorage.getItem(key) === saved) sessionStorage.removeItem(key)
        if (activeExecution === execution) {
          activeExecution = null
          resetExecutionState()
        }
      }
      if (controller.signal.aborted) return
      useConsoleStore.getState().addConsole({
        workflowId: activeWorkflowId,
        executionId,
        blockId: 'execution',
        blockName: 'Workflow',
        blockType: 'workflow',
        output: result.output,
        success: result.success,
        error: result.error,
        isRunning: false,
        endedAt: new Date().toISOString(),
      })
      if (manual) setManualRunResult(result)
      return result
    },
    [
      activeWorkflowId,
      applyExecutionEvent,
      resetExecutionState,
      setIsDebugging,
      setIsExecuting,
      setPendingBlocks,
      userId,
    ]
  )

  useEffect(() => {
    if (!userId || !activeWorkflowId || activeExecution) return
    const key = executionStorageKey(userId, activeWorkflowId)
    const saved = sessionStorage.getItem(key)
    if (!saved) return
    let handle: QueuedWorkflowExecutionHandle
    try {
      handle = JSON.parse(saved)
      if (typeof handle.taskId !== 'string' || typeof handle.executionId !== 'string')
        throw new Error('Invalid saved workflow execution')
    } catch {
      sessionStorage.removeItem(key)
      return
    }
    void runExecution(handle.executionId, {}, async () => handle)
  }, [activeWorkflowId, runExecution, userId])

  const buildExecutionRequest = useCallback(
    async (
      workflowInput: unknown,
      triggerType: WorkflowExecutionTriggerType,
      requestedTriggerBlockId?: string
    ) => {
      const workflowSnapshot = readWorkflowSnapshot()
      if (!workflowSnapshot || !doc) {
        throw new Error('Workflow session is not ready')
      }
      if (!workspaceId) {
        throw new Error('Cannot execute workflow without workspaceId')
      }

      const workflowData = buildExecutableWorkflowData(
        workflowSnapshot.blocks,
        workflowSnapshot.edges
      )

      let triggerBlockId: string | undefined
      let finalWorkflowInput = workflowInput
      let finalTriggerType = triggerType

      if (triggerType === 'chat') {
        const chatTrigger = TriggerUtils.findTriggerBlock(workflowData.blocks, 'chat')
        if (!chatTrigger) {
          throw new Error('Chat execution requires a Chat Trigger block')
        }
        triggerBlockId = chatTrigger.blockId
      } else {
        if (!requestedTriggerBlockId) {
          throw new Error('Run requires choosing a configured trigger block')
        }
        const editorTestTrigger = resolveWorkflowRunTrigger(
          workflowData.blocks,
          workflowData.edges,
          {
            surface: 'editor',
            workflowInput,
            triggerBlockId: requestedTriggerBlockId,
          }
        )
        triggerBlockId = editorTestTrigger.blockId
        workflowData.blocks = editorTestTrigger.blocks
        finalWorkflowInput = editorTestTrigger.input
        finalTriggerType = editorTestTrigger.triggerType
      }

      const workflowVariables = Object.values(getVariablesSnapshot(doc)).reduce(
        (acc, variable: any) => {
          if (variable?.id) acc[variable.id] = variable
          return acc
        },
        {} as Record<string, unknown>
      )

      return {
        workspaceId,
        input: finalWorkflowInput,
        triggerBlockId,
        triggerType: finalTriggerType,
        workflowVariables,
        workflowData,
      }
    },
    [doc, readWorkflowSnapshot, workspaceId]
  )

  const uploadChatFiles = useCallback(
    async (workflowInput: any, executionId: string, workspaceId: string) => {
      if (!workflowInput?.files || !Array.isArray(workflowInput.files) || !activeWorkflowId) {
        return workflowInput
      }

      const uploadedFiles: any[] = []
      const onUploadError =
        typeof workflowInput.onUploadError === 'function' ? workflowInput.onUploadError : undefined

      try {
        for (const fileData of workflowInput.files) {
          const formData = new FormData()
          formData.append('file', fileData.file)
          formData.append('workflowId', activeWorkflowId)
          formData.append('executionId', executionId)
          formData.append('workspaceId', workspaceId)

          const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            throw new Error(
              `Failed to upload ${fileData.name}: ${response.status} ${await response.text()}`
            )
          }

          const uploadResult = await response.json()
          if (!isRecord(uploadResult) || typeof uploadResult.id !== 'string') {
            throw new Error(`Upload response for ${fileData.name} is missing file id`)
          }

          uploadedFiles.push({
            id: uploadResult.id,
            name: uploadResult.name,
            url: uploadResult.url,
            size: uploadResult.size,
            type: uploadResult.type,
            key: uploadResult.key,
            uploadedAt: uploadResult.uploadedAt,
            expiresAt: uploadResult.expiresAt,
          })
        }
      } catch (error) {
        logger.error('Error uploading files:', error)
        onUploadError?.(error instanceof Error ? error.message : WORKFLOW_EXECUTION_FAILURE_MESSAGE)
        throw error
      }

      return {
        ...workflowInput,
        files: uploadedFiles,
        onUploadError: undefined,
      }
    },
    [activeWorkflowId]
  )

  const handleRunWorkflow = useCallback(
    async (request: WorkflowExecutionRequest = {}) => {
      if (!isWorkflowSessionReadyRef.current) return
      const executionId = globalThis.crypto.randomUUID()
      return runExecution(executionId, request, async (execution) => {
        request.onAdmitted?.()
        const executionRequest = await buildExecutionRequest(
          request.input,
          request.triggerType ?? 'manual',
          request.triggerBlockId
        )
        const input =
          executionRequest.triggerType === 'chat'
            ? await uploadChatFiles(
                executionRequest.input,
                executionId,
                executionRequest.workspaceId
              )
            : executionRequest.input
        execution.controller.signal.throwIfAborted()
        if (execution.cancelRequested) return
        return queueWorkflowExecution({
          workflowId: execution.workflowId,
          executionId,
          input,
          triggerType: executionRequest.triggerType,
          executionTarget: 'live',
          workflowData: executionRequest.workflowData,
          workflowVariables: executionRequest.workflowVariables,
          triggerBlockId: executionRequest.triggerBlockId,
          selectedOutputs: request.selectedOutputs,
        })
      })
    },
    [buildExecutionRequest, runExecution, uploadChatFiles]
  )

  const handleCancelExecution = useCallback(async () => {
    const execution = activeExecution
    if (!execution || execution.userId !== userId || execution.workflowId !== activeWorkflowId)
      return
    execution.cancelRequested = true
    if (execution.taskId) {
      try {
        await cancelQueuedWorkflowExecution(execution.taskId)
      } catch (error) {
        logger.error('Failed to cancel workflow execution', error)
      }
    }
  }, [activeWorkflowId, userId])

  let manualRunFeedback: ManualRunFeedback = { state: 'idle' }
  if (
    manualFeedbackPresenter?.owner === ownerRef.current &&
    manualFeedbackPresenter.workflowId === activeWorkflowId
  ) {
    if (manualRunResult === 'running') {
      manualRunFeedback = { state: 'running' }
    } else if (manualRunResult?.success) {
      manualRunFeedback = { state: 'success' }
    } else if (manualRunResult) {
      manualRunFeedback = {
        state: 'error',
        message: manualRunResult.error || WORKFLOW_EXECUTION_FAILURE_MESSAGE,
      }
    }
  }

  return {
    isExecuting,
    isWorkflowSessionReady,
    manualRunFeedback,
    handleRunWorkflow,
    handleCancelExecution,
  }
}
