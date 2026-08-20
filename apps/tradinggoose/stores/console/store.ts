import { devtools, persist } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { deepRedactSecrets } from '@/lib/security/redaction'
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

type ConsoleEntryPatchFields = Partial<
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
>

type ConsoleEntryPatch = ConsoleEntryPatchFields &
  ({ content: string; output?: never } | { content?: never; output?: NormalizedBlockOutput })

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

const applyConsolePatch = (entry: ConsoleEntry, patch: ConsoleEntryPatch): ConsoleEntry => {
  const { content, output, ...entryPatch } = patch
  const definedPatch = Object.fromEntries(
    Object.entries(entryPatch).filter(([, value]) => value !== undefined)
  ) as Partial<ConsoleEntry>
  if (output !== undefined) {
    definedPatch.output = deepRedactSecrets(output) as NormalizedBlockOutput
  }
  const updatedEntry = { ...entry, ...definedPatch }

  if (content !== undefined) {
    updatedEntry.output = updateBlockOutput(entry.output, deepRedactSecrets(content) as string)
  }

  return updatedEntry
}

const executionBlockKey = (
  workflowId: string,
  executionId: string | undefined,
  blockId: string,
  data?: Pick<WorkflowExecutionBlockData, 'iterationCurrent' | 'iterationType'>
) =>
  `${workflowId}:${executionId ?? 'execution'}:${blockId}:${data?.iterationType ?? ''}:${data?.iterationCurrent ?? ''}`

const streamBuffers = new Map<string, string>()

const clearWorkflowStreamBuffers = (workflowId: string) => {
  const prefix = `${workflowId}:`
  for (const key of streamBuffers.keys()) {
    if (key.startsWith(prefix)) streamBuffers.delete(key)
  }
}

const clearExecutionStreamBuffers = (workflowId: string, executionId: string | undefined) => {
  const prefix = `${workflowId}:${executionId ?? 'execution'}:`
  for (const key of streamBuffers.keys()) {
    if (key.startsWith(prefix)) streamBuffers.delete(key)
  }
}

const findExecutionEntry = (
  entries: ConsoleEntry[],
  event: Pick<WorkflowExecutionEvent, 'workflowId' | 'executionId'>,
  data: WorkflowExecutionBlockData,
  options: { allowRunningFallback?: boolean } = {}
) => {
  const matchingEntries = entries.filter(
    (entry) =>
      entry.workflowId === event.workflowId &&
      entry.executionId === event.executionId &&
      entry.blockId === data.blockId
  )

  if (data.iterationType !== undefined || data.iterationCurrent !== undefined) {
    return (
      matchingEntries.find(
        (entry) =>
          entry.iterationType === data.iterationType &&
          entry.iterationCurrent === data.iterationCurrent
      ) ?? null
    )
  }

  if (data.startedAt) {
    return matchingEntries.find((entry) => entry.startedAt === data.startedAt) ?? null
  }

  if (options.allowRunningFallback) {
    const runningEntries = matchingEntries.filter((entry) => entry.isRunning)
    if (runningEntries.length === 1) return runningEntries[0]
    if (runningEntries.length > 1) return undefined
  }

  return matchingEntries.length > 1 ? undefined : (matchingEntries[0] ?? null)
}

const updateEntryById = (entries: ConsoleEntry[], entryId: string, patch: ConsoleEntryPatch) =>
  entries.map((entry) => (entry.id === entryId ? applyConsolePatch(entry, patch) : entry))

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
              existing.startedAt === entry.startedAt &&
              existing.isRunning
          )

          if (existingEntry) {
            return existingEntry
          }

          const redactedEntry = { ...entry }
          if (redactedEntry.output && typeof redactedEntry.output === 'object') {
            redactedEntry.output = deepRedactSecrets(redactedEntry.output) as NormalizedBlockOutput
          }

          const newEntry = {
            ...redactedEntry,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          }

          set((state) => {
            const entries = [newEntry, ...state.entries]
            for (const evictedEntry of entries.slice(MAX_ENTRIES)) {
              streamBuffers.delete(
                executionBlockKey(
                  evictedEntry.workflowId,
                  evictedEntry.executionId,
                  evictedEntry.blockId,
                  evictedEntry
                )
              )
            }
            return { entries: entries.slice(0, MAX_ENTRIES) }
          })

          return newEntry
        },

        clearConsole: (workflowId: string | null) => {
          if (workflowId) {
            clearWorkflowStreamBuffers(workflowId)
          } else {
            streamBuffers.clear()
          }

          set((state) => {
            if (!workflowId) {
              return { entries: [] }
            }

            return {
              entries: state.entries.filter((entry) => entry.workflowId !== workflowId),
            }
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
          const deleteStreamBuffer = (data: WorkflowExecutionBlockData) => {
            streamBuffers.delete(
              executionBlockKey(event.workflowId, event.executionId, data.blockId, data)
            )
            const existingEntry = findExecutionEntry(get().entries, event, data, {
              allowRunningFallback: true,
            })
            if (existingEntry) {
              streamBuffers.delete(
                executionBlockKey(event.workflowId, event.executionId, data.blockId, existingEntry)
              )
            }
          }

          const writeBlock = (
            data: WorkflowExecutionBlockData,
            options: { success: boolean; isRunning: boolean; isCanceled?: boolean }
          ) => {
            const patchFields: ConsoleEntryPatchFields = {
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
            const patch: ConsoleEntryPatch =
              data.output !== undefined
                ? { ...patchFields, output: data.output as NormalizedBlockOutput }
                : patchFields

            const existingEntry = findExecutionEntry(get().entries, event, data)
            if (existingEntry === undefined) {
              return
            }

            if (existingEntry) {
              set((state) => ({
                entries: updateEntryById(state.entries, existingEntry.id, patch),
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

          if (event.type === 'block:started') {
            streamBuffers.delete(
              executionBlockKey(event.workflowId, event.executionId, event.data.blockId, event.data)
            )
            writeBlock(event.data, { success: true, isRunning: true, isCanceled: false })
            return
          }

          if (event.type === 'stream:chunk') {
            const { blockId, chunk } = event.data
            const data: WorkflowExecutionBlockData = {
              blockId,
              iterationCurrent: event.data.iterationCurrent,
              iterationType: event.data.iterationType,
            }
            const existingEntry = findExecutionEntry(get().entries, event, data, {
              allowRunningFallback: true,
            })
            if (!existingEntry) return

            const key = executionBlockKey(
              event.workflowId,
              event.executionId,
              blockId,
              existingEntry
            )
            const content = `${streamBuffers.get(key) ?? ''}${chunk}`
            streamBuffers.set(key, content)
            set((state) => ({
              entries: updateEntryById(state.entries, existingEntry.id, { content }),
            }))
            return
          }

          if (event.type === 'stream:done') {
            deleteStreamBuffer(event.data)
            return
          }

          if (event.type === 'block:completed') {
            deleteStreamBuffer(event.data)
            writeBlock(event.data, { success: true, isRunning: false, isCanceled: false })
            return
          }

          if (event.type === 'block:error') {
            deleteStreamBuffer(event.data)
            writeBlock(event.data, {
              success: false,
              isRunning: false,
              isCanceled: event.data.isCanceled,
            })
            return
          }

          if (isTerminalWorkflowExecutionEvent(event)) {
            set((state) => ({
              entries: state.entries.map((entry) => {
                if (
                  entry.workflowId !== event.workflowId ||
                  entry.executionId !== event.executionId ||
                  !entry.isRunning
                ) {
                  return entry
                }

                const endedAt = entry.endedAt || event.timestamp
                const startedAtMs = entry.startedAt ? Date.parse(entry.startedAt) : Number.NaN
                const endedAtMs = Date.parse(endedAt)
                const durationMs =
                  Number.isFinite(entry.durationMs) && entry.durationMs! > 0
                    ? entry.durationMs
                    : Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
                      ? Math.max(0, endedAtMs - startedAtMs)
                      : Number.isFinite(entry.durationMs) && entry.durationMs! >= 0
                        ? entry.durationMs
                        : 0
                if (event.type === 'execution:error') {
                  return {
                    ...entry,
                    success: false,
                    error: entry.error || event.data.error,
                    endedAt,
                    durationMs,
                    isRunning: false,
                    isCanceled: false,
                  }
                }

                return {
                  ...entry,
                  success: event.type === 'execution:cancelled' ? false : entry.success,
                  endedAt,
                  durationMs,
                  isRunning: false,
                  isCanceled: event.type === 'execution:cancelled',
                }
              }),
            }))
            clearExecutionStreamBuffers(event.workflowId, event.executionId)
          }
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
                  success: false,
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
