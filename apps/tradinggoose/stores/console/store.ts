import { devtools, persist } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { redactApiKeys } from '@/lib/utils'
import type {
  WorkflowExecutionBlockData,
  WorkflowExecutionEvent,
} from '@/lib/workflows/execution-events'
import { isTerminalWorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { ConsoleEntry, ConsoleStore } from '@/stores/console/types'

const MAX_ENTRIES = 500 // MAX across all workflows - allows for 100 loop iterations + other workflow logs
const MAX_IMAGE_DATA_SIZE = 1000 // Maximum size of image data to store (in characters)
const MAX_ANY_DATA_SIZE = 5000 // Maximum size of any data to store (in characters)
const MAX_TOTAL_ENTRY_SIZE = 50000 // Maximum size of entire entry to prevent localStorage overflow

type ConsoleUpdate = Partial<
  Pick<
    ConsoleEntry,
    | 'blockName'
    | 'blockType'
    | 'startedAt'
    | 'input'
    | 'error'
    | 'warning'
    | 'success'
    | 'endedAt'
    | 'durationMs'
    | 'isRunning'
    | 'isCanceled'
    | 'iterationCurrent'
    | 'iterationTotal'
    | 'iterationType'
  >
> & {
  content?: string
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput
}

/**
 * Safely clone and update a NormalizedBlockOutput
 */
const updateBlockOutput = (
  existingOutput: NormalizedBlockOutput | undefined,
  contentUpdate: string
): NormalizedBlockOutput => {
  const baseOutput = existingOutput || {}

  return {
    ...baseOutput,
    content: contentUpdate,
  }
}

/**
 * Checks if a string is likely a base64 encoded image or large data blob
 */
const isLikelyBase64Data = (value: string): boolean => {
  if (value.length < 100) return false
  return value.startsWith('data:image') || /^[A-Za-z0-9+/=]{1000,}$/.test(value)
}

/**
 * Processes an object to handle large strings and data for localStorage to prevent quota issues
 */
const processSafeStorage = (obj: any): any => {
  if (!obj) return obj

  if (typeof obj === 'string') {
    if (obj.length > MAX_ANY_DATA_SIZE) {
      return `[Large text truncated, original length: ${obj.length}]${obj.substring(0, 200)}...`
    }
    return obj
  }

  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    if (obj.length > 100) {
      return [
        `[Array truncated, original length: ${obj.length}]`,
        ...obj.slice(0, 10).map((item) => processSafeStorage(item)),
      ]
    }
    return obj.map((item) => processSafeStorage(item))
  }

  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (
      (key === 'image' || key.includes('image')) &&
      typeof value === 'string' &&
      value.length > MAX_IMAGE_DATA_SIZE
    ) {
      if (value.startsWith('data:image')) {
        const mimeEnd = value.indexOf(',')
        result[key] =
          mimeEnd > 0
            ? `${value.substring(0, mimeEnd + 1)}[Image data removed, original length: ${value.length}]`
            : `[Image data removed, original length: ${value.length}]`
      } else {
        result[key] = `[Image data removed, original length: ${value.length}]`
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = processSafeStorage(value)
    } else if (typeof value === 'string' && value.length > MAX_ANY_DATA_SIZE) {
      if (isLikelyBase64Data(value)) {
        if (value.startsWith('data:image')) {
          const mimeEnd = value.indexOf(',')
          result[key] =
            mimeEnd > 0
              ? `${value.substring(0, mimeEnd + 1)}[Large data removed, original length: ${value.length}]`
              : `[Large data removed, original length: ${value.length}]`
        } else {
          result[key] = `[Large data removed, original length: ${value.length}]`
        }
      } else {
        // Truncate large text/JSON data
        result[key] =
          `[Large text truncated, original length: ${value.length}]${value.substring(0, 500)}...`
      }
    } else {
      result[key] = value
    }
  }

  return result
}

const applyConsoleUpdate = (entry: ConsoleEntry, update: string | ConsoleUpdate): ConsoleEntry => {
  if (typeof update === 'string') {
    const newOutput = updateBlockOutput(entry.output, update)
    return { ...entry, output: newOutput }
  }

  const updatedEntry = { ...entry }

  if (update.blockName !== undefined) {
    updatedEntry.blockName = update.blockName
  }

  if (update.blockType !== undefined) {
    updatedEntry.blockType = update.blockType
  }

  if (update.startedAt !== undefined) {
    updatedEntry.startedAt = update.startedAt
  }

  if (update.content !== undefined) {
    const newOutput = updateBlockOutput(entry.output, update.content)
    updatedEntry.output = newOutput
  }

  if (update.replaceOutput !== undefined) {
    updatedEntry.output = update.replaceOutput
  } else if (update.output !== undefined) {
    const existingOutput = entry.output || {}
    updatedEntry.output = {
      ...existingOutput,
      ...update.output,
    }
  }

  if (update.error !== undefined) {
    updatedEntry.error = update.error
  }

  if (update.warning !== undefined) {
    updatedEntry.warning = update.warning
  }

  if (update.success !== undefined) {
    updatedEntry.success = update.success
  }

  if (update.endedAt !== undefined) {
    updatedEntry.endedAt = update.endedAt
  }

  if (update.durationMs !== undefined) {
    updatedEntry.durationMs = update.durationMs
  }

  if (update.input !== undefined) {
    updatedEntry.input = update.input
  }

  if (update.isRunning !== undefined) {
    updatedEntry.isRunning = update.isRunning
  }

  if (update.isCanceled !== undefined) {
    updatedEntry.isCanceled = update.isCanceled
  }

  if (update.iterationCurrent !== undefined) {
    updatedEntry.iterationCurrent = update.iterationCurrent
  }

  if (update.iterationTotal !== undefined) {
    updatedEntry.iterationTotal = update.iterationTotal
  }

  if (update.iterationType !== undefined) {
    updatedEntry.iterationType = update.iterationType
  }

  return updatedEntry
}

const executionBlockKey = (executionId: string | undefined, blockId: string) =>
  `${executionId ?? 'execution'}:${blockId}`

const streamBuffers = new Map<string, string>()

const findExecutionEntry = (
  entries: ConsoleEntry[],
  event: Pick<WorkflowExecutionEvent, 'workflowId' | 'executionId'>,
  data: WorkflowExecutionBlockData
) => {
  const matchingEntries = entries.filter(
    (entry) =>
      entry.workflowId === event.workflowId &&
      entry.executionId === event.executionId &&
      entry.blockId === data.blockId
  )

  return (
    (data.startedAt && matchingEntries.find((entry) => entry.startedAt === data.startedAt)) ||
    (data.iterationType &&
      data.iterationCurrent !== undefined &&
      matchingEntries.find(
        (entry) =>
          entry.iterationType === data.iterationType &&
          entry.iterationCurrent === data.iterationCurrent
      )) ||
    matchingEntries.find((entry) => entry.isRunning) ||
    null
  )
}

const updateEntryById = (entries: ConsoleEntry[], entryId: string, update: ConsoleUpdate) =>
  entries.map((entry) => (entry.id === entryId ? applyConsoleUpdate(entry, update) : entry))

export const useConsoleStore = create<ConsoleStore>()(
  devtools(
    persist(
      (set, get) => ({
        entries: [],

        addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => {
          const existingEntry = get().entries.find(
            (existing) =>
              existing.workflowId === entry.workflowId &&
              existing.blockId === entry.blockId &&
              existing.executionId === entry.executionId &&
              existing.iterationType === entry.iterationType &&
              existing.iterationCurrent === entry.iterationCurrent &&
              existing.isRunning
          )

          if (existingEntry) {
            return existingEntry
          }

          const redactedEntry = { ...entry }
          if (redactedEntry.output && typeof redactedEntry.output === 'object') {
            redactedEntry.output = redactApiKeys(redactedEntry.output)
          }

          const newEntry = {
            ...redactedEntry,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          }

          set((state) => ({ entries: [newEntry, ...state.entries].slice(0, MAX_ENTRIES) }))

          return newEntry
        },

        clearConsole: (workflowId: string | null) => {
          set((state) => {
            if (!workflowId) {
              streamBuffers.clear()
              return { entries: [] }
            }

            return { entries: state.entries.filter((entry) => entry.workflowId !== workflowId) }
          })
        },

        exportConsoleCSV: (workflowId: string) => {
          const entries = get().entries.filter((entry) => entry.workflowId === workflowId)

          if (entries.length === 0) {
            return
          }

          // Helper function to safely stringify and escape CSV values
          const formatCSVValue = (value: any): string => {
            if (value === null || value === undefined) {
              return ''
            }

            let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

            // Truncate very long strings
            if (stringValue.length > 1000) {
              stringValue = `${stringValue.substring(0, 1000)}...`
            }

            // Escape quotes and wrap in quotes if contains special characters
            if (
              stringValue.includes('"') ||
              stringValue.includes(',') ||
              stringValue.includes('\n')
            ) {
              stringValue = `"${stringValue.replace(/"/g, '""')}"`
            }

            return stringValue
          }

          // CSV Headers
          const headers = [
            'timestamp',
            'blockName',
            'blockType',
            'startedAt',
            'endedAt',
            'durationMs',
            'success',
            'input',
            'output',
            'error',
            'warning',
          ]

          // Generate CSV rows
          const csvRows = [
            headers.join(','),
            ...entries.map((entry) =>
              [
                formatCSVValue(entry.timestamp),
                formatCSVValue(entry.blockName),
                formatCSVValue(entry.blockType),
                formatCSVValue(entry.startedAt),
                formatCSVValue(entry.endedAt),
                formatCSVValue(entry.durationMs),
                formatCSVValue(entry.success),
                formatCSVValue(entry.input),
                formatCSVValue(entry.output),
                formatCSVValue(entry.error),
                formatCSVValue(entry.warning),
              ].join(',')
            ),
          ]

          // Create CSV content
          const csvContent = csvRows.join('\n')

          // Generate filename with timestamp
          const now = new Date()
          const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const filename = `console-${workflowId}-${timestamp}.csv`

          // Create and trigger download
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
          const link = document.createElement('a')

          if (link.download !== undefined) {
            const url = URL.createObjectURL(blob)
            link.setAttribute('href', url)
            link.setAttribute('download', filename)
            link.style.visibility = 'hidden'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }
        },

        ingestWorkflowExecutionEvent: (event: WorkflowExecutionEvent) => {
          const writeBlock = (
            data: WorkflowExecutionBlockData,
            options: { success: boolean; isRunning: boolean; isCanceled?: boolean }
          ) => {
            const update: ConsoleUpdate = {
              blockName: data.blockName,
              blockType: data.blockType,
              startedAt: data.startedAt,
              input: data.input,
              error: data.error,
              success: options.success,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
              iterationCurrent: data.iterationCurrent,
              iterationTotal: data.iterationTotal,
              iterationType: data.iterationType,
              isRunning: options.isRunning,
              isCanceled: options.isCanceled ?? false,
            }
            if (data.output !== undefined) {
              update.replaceOutput = data.output as NormalizedBlockOutput
            }

            const existingEntry = findExecutionEntry(get().entries, event, data)
            if (existingEntry) {
              set((state) => ({
                entries: updateEntryById(state.entries, existingEntry.id, update),
              }))
              return
            }

            get().addConsole({
              workflowId: event.workflowId,
              executionId: event.executionId,
              blockId: data.blockId,
              blockName: data.blockName,
              blockType: data.blockType,
              input: data.input,
              output: data.output as NormalizedBlockOutput | undefined,
              error: data.error,
              success: options.success,
              durationMs: data.durationMs ?? 0,
              startedAt: data.startedAt ?? event.timestamp,
              endedAt: data.endedAt,
              iterationCurrent: data.iterationCurrent,
              iterationTotal: data.iterationTotal,
              iterationType: data.iterationType,
              isRunning: options.isRunning,
              isCanceled: options.isCanceled ?? false,
            })
          }

          const clearExecutionStreamBuffers = () => {
            const prefix = `${event.executionId}:`
            for (const key of streamBuffers.keys()) {
              if (key.startsWith(prefix)) streamBuffers.delete(key)
            }
          }

          if (event.type === 'block:started') {
            streamBuffers.delete(executionBlockKey(event.executionId, event.data.blockId))
            writeBlock(event.data, { success: true, isRunning: true, isCanceled: false })
            return
          }

          if (event.type === 'stream:chunk') {
            const { blockId, chunk } = event.data
            const key = executionBlockKey(event.executionId, blockId)
            const content = `${streamBuffers.get(key) ?? ''}${chunk}`
            streamBuffers.set(key, content)

            const runningEntry = get().entries.find(
              (entry) =>
                entry.workflowId === event.workflowId &&
                entry.executionId === event.executionId &&
                entry.blockId === blockId &&
                entry.isRunning
            )
            const entry =
              runningEntry ??
              get().addConsole({
                workflowId: event.workflowId,
                executionId: event.executionId,
                blockId,
                blockName: blockId,
                blockType: 'unknown',
                output: undefined,
                success: true,
                durationMs: 0,
                startedAt: event.timestamp,
                isRunning: true,
                isCanceled: false,
              })

            set((state) => ({
              entries: updateEntryById(state.entries, entry.id, { content }),
            }))
            return
          }

          if (event.type === 'stream:done') {
            streamBuffers.delete(executionBlockKey(event.executionId, event.data.blockId))
            return
          }

          if (event.type === 'block:completed') {
            streamBuffers.delete(executionBlockKey(event.executionId, event.data.blockId))
            writeBlock(event.data, { success: true, isRunning: false, isCanceled: false })
            return
          }

          if (event.type === 'block:error') {
            streamBuffers.delete(executionBlockKey(event.executionId, event.data.blockId))
            writeBlock(event.data, {
              success: false,
              isRunning: false,
              isCanceled: event.data.isCanceled,
            })
            return
          }

          if (isTerminalWorkflowExecutionEvent(event)) clearExecutionStreamBuffers()
        },

        cancelRunningEntries: (workflowId: string) => {
          set((state) => {
            const now = new Date().toISOString()
            const updatedEntries = state.entries.map((entry) => {
              if (entry.workflowId === workflowId && entry.isRunning) {
                const startedAtMs = entry.startedAt ? new Date(entry.startedAt).getTime() : null
                const durationMs =
                  startedAtMs != null ? Math.max(0, Date.now() - startedAtMs) : entry.durationMs
                return {
                  ...entry,
                  isRunning: false,
                  isCanceled: true,
                  endedAt: entry.endedAt || now,
                  durationMs,
                }
              }
              return entry
            })
            return { ...state, entries: updatedEntries }
          })
        },
      }),
      {
        name: 'console-store',
        partialize: (state) => {
          const sanitizedEntries = state.entries.slice(0, MAX_ENTRIES).map((entry) => {
            const sanitizedEntry = {
              ...entry,
              input: processSafeStorage(entry.input),
              output: processSafeStorage(entry.output),
            }

            // Check total entry size and truncate further if needed
            const entryJson = JSON.stringify(sanitizedEntry)
            if (entryJson.length > MAX_TOTAL_ENTRY_SIZE) {
              return {
                ...sanitizedEntry,
                output: `[Entry too large for storage, original size: ${entryJson.length} chars]`,
                input:
                  typeof sanitizedEntry.input === 'string' && sanitizedEntry.input.length > 1000
                    ? `[Input truncated]${sanitizedEntry.input.substring(0, 200)}...`
                    : sanitizedEntry.input,
              }
            }

            return sanitizedEntry
          })

          return { entries: sanitizedEntries }
        },
      }
    )
  )
)
