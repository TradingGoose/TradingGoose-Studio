import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
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
  onEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined (undefined)') return undefined
  return trimmed
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = sanitizeMessage(error.message)
    if (message) return message
  } else if (typeof error === 'string') {
    const message = sanitizeMessage(error)
    if (message) return message
  }

  if (isRecord(error)) {
    const directMessage = sanitizeMessage(error.message)
    if (directMessage) return directMessage

    const nestedError = error.error
    if (isRecord(nestedError)) {
      const nestedMessage = sanitizeMessage(nestedError.message)
      if (nestedMessage) return nestedMessage
    } else {
      const nestedMessage = sanitizeMessage(nestedError)
      if (nestedMessage) return nestedMessage
    }
  }

  return WORKFLOW_EXECUTION_FAILURE_MESSAGE
}

function createExecutionId() {
  return globalThis.crypto.randomUUID()
}

export function useWorkflowExecution() {
  const { workflowId: activeWorkflowId, workspaceId } = useWorkflowRoute()
  const { canEdit, doc, error, isLoading, readWorkflowSnapshot } = useWorkflowSession()
  const { cancelRunningEntries } = useConsoleStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const { isExecuting, setIsExecuting, setIsDebugging, setPendingBlocks, setActiveBlocks } =
    useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)
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

      if (
        event.type === 'execution:completed' ||
        event.type === 'execution:error' ||
        event.type === 'execution:cancelled'
      ) {
        setActiveBlocks(new Set())
      }
    },
    [setActiveBlocks]
  )

  const resetExecutionState = useCallback(() => {
    abortControllerRef.current = null
    setIsExecuting(false)
    setIsDebugging(false)
    setPendingBlocks([])
    setActiveBlocks(new Set())
  }, [setActiveBlocks, setIsDebugging, setIsExecuting, setPendingBlocks])

  const handleExecutionError = useCallback(
    (error: unknown, options?: { executionId?: string }) => {
      const errorResult: ExecutionResult = {
        success: false,
        output: {},
        error: normalizeErrorMessage(error),
        logs: [],
      }

      setExecutionResult(errorResult)
      setIsExecuting(false)
      setIsDebugging(false)
      setPendingBlocks([])
      setActiveBlocks(new Set())

      if (activeWorkflowId) {
        useConsoleStore.getState().addConsole({
          input: {},
          output: {},
          success: false,
          error: errorResult.error,
          durationMs: 0,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          workflowId: activeWorkflowId,
          blockId: 'execution',
          executionId: options?.executionId,
          blockName: 'Workflow',
          blockType: 'workflow',
        })
      }

      return errorResult
    },
    [activeWorkflowId, setActiveBlocks, setIsDebugging, setIsExecuting, setPendingBlocks]
  )

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
        onUploadError?.(normalizeErrorMessage(error))
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
      if (!activeWorkflowId || !isWorkflowSessionReadyRef.current) return

      const executionId = createExecutionId()
      setExecutionResult(null)
      setIsExecuting(true)
      setIsDebugging(false)
      setPendingBlocks([])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const requestedTriggerType = request.triggerType ?? 'manual'
        const executionRequest = await buildExecutionRequest(
          request.input,
          requestedTriggerType,
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

        const result = await runQueuedWorkflowExecution(
          {
            workflowId: activeWorkflowId,
            executionId,
            input,
            triggerType: executionRequest.triggerType,
            executionTarget: 'live',
            workflowData: executionRequest.workflowData,
            workflowVariables: executionRequest.workflowVariables,
            triggerBlockId: executionRequest.triggerBlockId,
            selectedOutputs: request.selectedOutputs,
            stream: true,
            signal: abortController.signal,
          },
          {
            onEvent: async (event) => {
              applyExecutionEvent(event)
              await request.onEvent?.(event)
            },
          }
        )

        setExecutionResult(result)
        resetExecutionState()
        return result
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          resetExecutionState()
          return {
            success: false,
            output: {},
            error: 'Workflow execution was cancelled',
            logs: [],
          } satisfies ExecutionResult
        }
        return handleExecutionError(error, { executionId })
      }
    },
    [
      activeWorkflowId,
      applyExecutionEvent,
      buildExecutionRequest,
      handleExecutionError,
      resetExecutionState,
      setIsDebugging,
      setIsExecuting,
      setPendingBlocks,
      uploadChatFiles,
    ]
  )

  const handleCancelExecution = useCallback(() => {
    abortControllerRef.current?.abort()

    if (activeWorkflowId) {
      cancelRunningEntries(activeWorkflowId)
    }

    resetExecutionState()
  }, [activeWorkflowId, cancelRunningEntries, resetExecutionState])

  return {
    isExecuting,
    isWorkflowSessionReady,
    executionResult,
    handleRunWorkflow,
    handleCancelExecution,
  }
}
