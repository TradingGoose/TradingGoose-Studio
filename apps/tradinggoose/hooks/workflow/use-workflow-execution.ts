import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { runQueuedWorkflowExecution } from '@/lib/workflows/queued-execution-client'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { useWorkflowVariables } from '@/lib/yjs/use-workflow-doc'
import type { ExecutionResult } from '@/executor/types'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useCurrentWorkflow } from './use-current-workflow'

const logger = createLogger('useWorkflowExecution')
const WORKFLOW_EXECUTION_FAILURE_MESSAGE = 'Workflow execution failed'
type WorkflowExecutionTriggerType = 'chat' | 'manual'
type WorkflowExecutionRequest = {
  input?: unknown
  triggerType?: WorkflowExecutionTriggerType
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

function getInputFormatTestValues(inputFormatValue: unknown): Record<string, unknown> {
  const testInput: Record<string, unknown> = {}
  if (!Array.isArray(inputFormatValue)) return testInput

  for (const field of inputFormatValue) {
    if (field && typeof field === 'object' && 'name' in field && 'value' in field) {
      const name = (field as { name?: unknown }).name
      if (typeof name === 'string' && name.length > 0) {
        testInput[name] = (field as { value?: unknown }).value
      }
    }
  }

  return testInput
}

export function useWorkflowExecution() {
  const currentWorkflow = useCurrentWorkflow()
  const { workflowId: routeWorkflowId, channelId } = useWorkflowRoute()
  const workflows = useWorkflowRegistry((state) => state.workflows)
  const registryWorkflowId = useWorkflowRegistry((state) => state.getActiveWorkflowId(channelId))
  const activeWorkflowId = routeWorkflowId ?? registryWorkflowId
  const { cancelRunningEntries } = useConsoleStore()
  const yjsVariables = useWorkflowVariables()
  const yjsVariablesRef = useLatestRef(yjsVariables)
  const abortControllerRef = useRef<AbortController | null>(null)
  const { isExecuting, setIsExecuting, setIsDebugging, setPendingBlocks, setActiveBlocks } =
    useExecutionStore()
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const applyExecutionEvent = useCallback(
    (event: WorkflowExecutionEvent, streamedContentByBlock: Map<string, string>) => {
      const { addConsole, updateConsole } = useConsoleStore.getState()

      if (event.type === 'block:started') {
        const data = event.data
        streamedContentByBlock.delete(`${event.executionId}:${data.blockId}`)
        addConsole({
          workflowId: event.workflowId,
          executionId: event.executionId,
          blockId: data.blockId,
          blockName: data.blockName,
          blockType: data.blockType,
          input: data.input,
          output: undefined,
          success: true,
          durationMs: data.durationMs ?? 0,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          iterationCurrent: data.iterationCurrent,
          iterationTotal: data.iterationTotal,
          iterationType: data.iterationType,
          isRunning: true,
          isCanceled: false,
        })

        const activeBlockIds = new Set(useExecutionStore.getState().activeBlockIds)
        activeBlockIds.add(data.blockId)
        setActiveBlocks(activeBlockIds)
        return
      }

      if (event.type === 'stream:chunk') {
        const key = `${event.executionId}:${event.data.blockId}`
        const content = `${streamedContentByBlock.get(key) ?? ''}${event.data.chunk}`
        streamedContentByBlock.set(key, content)
        updateConsole(event.data.blockId, { content }, event.executionId)
        return
      }

      if (event.type === 'block:completed') {
        const data = event.data
        streamedContentByBlock.delete(`${event.executionId}:${data.blockId}`)
        const hasEntry = useConsoleStore
          .getState()
          .entries.some(
            (entry) => entry.blockId === data.blockId && entry.executionId === event.executionId
          )

        if (hasEntry) {
          updateConsole(
            data.blockId,
            {
              replaceOutput: data.output as any,
              success: true,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
              isRunning: false,
              isCanceled: false,
            },
            event.executionId
          )
        } else {
          addConsole({
            workflowId: event.workflowId,
            executionId: event.executionId,
            blockId: data.blockId,
            blockName: data.blockName,
            blockType: data.blockType,
            input: data.input,
            output: data.output as any,
            success: true,
            durationMs: data.durationMs ?? 0,
            startedAt: data.startedAt,
            endedAt: data.endedAt,
            iterationCurrent: data.iterationCurrent,
            iterationTotal: data.iterationTotal,
            iterationType: data.iterationType,
            isRunning: false,
            isCanceled: false,
          })
        }

        const activeBlockIds = new Set(useExecutionStore.getState().activeBlockIds)
        activeBlockIds.delete(data.blockId)
        setActiveBlocks(activeBlockIds)
        return
      }

      if (event.type === 'block:error') {
        const data = event.data
        streamedContentByBlock.delete(`${event.executionId}:${data.blockId}`)
        const hasEntry = useConsoleStore
          .getState()
          .entries.some(
            (entry) => entry.blockId === data.blockId && entry.executionId === event.executionId
          )

        if (hasEntry) {
          updateConsole(
            data.blockId,
            {
              replaceOutput: data.output as any,
              success: false,
              error: data.error,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
              isRunning: false,
              isCanceled: data.isCanceled,
            },
            event.executionId
          )
        } else {
          addConsole({
            workflowId: event.workflowId,
            executionId: event.executionId,
            blockId: data.blockId,
            blockName: data.blockName,
            blockType: data.blockType,
            input: data.input,
            output: data.output as any,
            error: data.error,
            success: false,
            durationMs: data.durationMs ?? 0,
            startedAt: data.startedAt,
            endedAt: data.endedAt,
            iterationCurrent: data.iterationCurrent,
            iterationTotal: data.iterationTotal,
            iterationType: data.iterationType,
            isRunning: false,
            isCanceled: data.isCanceled,
          })
        }

        const activeBlockIds = new Set(useExecutionStore.getState().activeBlockIds)
        activeBlockIds.delete(data.blockId)
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
          blockType: 'execution',
        })
      }

      return errorResult
    },
    [activeWorkflowId, setActiveBlocks, setIsDebugging, setIsExecuting, setPendingBlocks]
  )

  const buildExecutionRequest = useCallback(
    async (workflowInput: unknown, triggerType: WorkflowExecutionTriggerType) => {
      if (!activeWorkflowId) throw new Error('Workflow target is required')

      const workspaceId = workflows[activeWorkflowId]?.workspaceId
      if (!workspaceId) {
        throw new Error('Cannot execute workflow without workspaceId')
      }

      const validBlocks = Object.entries(currentWorkflow.blocks).reduce(
        (acc, [blockId, block]) => {
          if (block?.type && block.enabled !== false) {
            acc[blockId] = block
          }
          return acc
        },
        {} as typeof currentWorkflow.blocks
      )

      const isChatExecution = triggerType === 'chat'
      let startBlockId: string | undefined
      let finalWorkflowInput = workflowInput

      if (isChatExecution) {
        const startBlock = TriggerUtils.findStartBlock(validBlocks, 'chat')
        if (!startBlock) {
          throw new Error(TriggerUtils.getTriggerValidationMessage('chat', 'missing'))
        }
        startBlockId = startBlock.blockId
      } else {
        const entries = Object.entries(validBlocks)
        const apiTriggers = TriggerUtils.findTriggersByType(validBlocks, 'api')
        const manualTriggers = TriggerUtils.findTriggersByType(validBlocks, 'manual')

        if (apiTriggers.length > 1) {
          throw new Error('Multiple API Trigger blocks found. Keep only one.')
        }

        let selectedTrigger: any = null
        let selectedBlockId: string | null = null

        if (apiTriggers.length === 1) {
          selectedTrigger = apiTriggers[0]
          selectedBlockId = entries.find(([, block]) => block === selectedTrigger)?.[0] ?? null

          const testInput = getInputFormatTestValues(selectedTrigger.subBlocks?.inputFormat?.value)
          if (Object.keys(testInput).length > 0) {
            finalWorkflowInput = testInput
          }
        } else if (manualTriggers.length > 0) {
          selectedTrigger =
            manualTriggers.find((trigger) => trigger.type === 'manual_trigger') ??
            manualTriggers.find((trigger) => trigger.type === 'input_trigger') ??
            manualTriggers[0]
          selectedBlockId = entries.find(([, block]) => block === selectedTrigger)?.[0] ?? null

          if (selectedTrigger.type === 'input_trigger') {
            const testInput = getInputFormatTestValues(
              selectedTrigger.subBlocks?.inputFormat?.value
            )
            if (Object.keys(testInput).length > 0) {
              finalWorkflowInput = testInput
            }
          }
        } else {
          throw new Error('Manual run requires a Manual, Input Form, or API Trigger block')
        }

        if (!selectedBlockId || !selectedTrigger) {
          throw new Error('No valid trigger block found to start execution')
        }

        const outgoingConnections = currentWorkflow.edges.filter(
          (edge) => edge.source === selectedBlockId
        )
        if (outgoingConnections.length === 0) {
          const triggerName = selectedTrigger.name || selectedTrigger.type
          throw new Error(`${triggerName} must be connected to other blocks to execute`)
        }

        startBlockId = selectedBlockId
      }

      const workflowVariables = Object.values(yjsVariablesRef.current ?? {}).reduce(
        (acc, variable: any) => {
          if (variable?.id) acc[variable.id] = variable
          return acc
        },
        {} as Record<string, unknown>
      )

      return {
        workspaceId,
        input: finalWorkflowInput,
        startBlockId,
        triggerType,
        workflowVariables,
        workflowData: {
          blocks: validBlocks,
          edges: currentWorkflow.edges,
          loops: generateLoopBlocks(validBlocks),
          parallels: generateParallelBlocks(validBlocks),
        },
      }
    },
    [activeWorkflowId, currentWorkflow.blocks, currentWorkflow.edges, workflows]
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
      if (!activeWorkflowId) return

      const executionId = createExecutionId()
      setExecutionResult(null)
      setIsExecuting(true)
      setIsDebugging(false)
      setPendingBlocks([])

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      const streamedContentByBlock = new Map<string, string>()

      try {
        const triggerType = request.triggerType ?? 'manual'
        const executionRequest = await buildExecutionRequest(request.input, triggerType)
        const input =
          triggerType === 'chat'
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
            triggerType,
            executionTarget: 'live',
            workflowData: executionRequest.workflowData,
            workflowVariables: executionRequest.workflowVariables,
            startBlockId: executionRequest.startBlockId,
            selectedOutputs: request.selectedOutputs,
            stream: Boolean(request.selectedOutputs?.length),
            signal: abortController.signal,
          },
          {
            onEvent: async (event) => {
              applyExecutionEvent(event, streamedContentByBlock)
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
    executionResult,
    handleRunWorkflow,
    handleCancelExecution,
  }
}
