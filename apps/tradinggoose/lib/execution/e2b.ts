import { Sandbox } from '@e2b/code-interpreter'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { CodeLanguage } from './languages'

export interface E2BExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
  template?: string
  keepWarmMs?: number
  userScope?: string
}

export interface E2BExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
}

const logger = createLogger('E2BExecution')
const DEFAULT_E2B_KEEP_WARM_CAP_MS = 60 * 60 * 1000
const WARM_SANDBOX_TIMEOUT_BUFFER_MS = 5_000
export const E2B_WARM_SANDBOX_LIMIT_ERROR_CODE = 'E2B_WARM_SANDBOX_LIMIT_REACHED'

const resolveKeepWarmCapMs = () => {
  const raw = env.E2B_KEEP_WARM_CAP_MS
  if (!raw) return DEFAULT_E2B_KEEP_WARM_CAP_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_E2B_KEEP_WARM_CAP_MS
  return parsed
}

const resolveMaxConcurrentWarmSandboxes = () => {
  const raw = env.E2B_MAX_CONCURRENT_SANDBOX
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

const E2B_KEEP_WARM_CAP_MS = resolveKeepWarmCapMs()
const MAX_CONCURRENT_WARM_SANDBOXES = resolveMaxConcurrentWarmSandboxes()

const isSandboxNotFoundError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /sandbox\b.*\bnot found/i.test(message)
}

const summarizeCode = (code: string) => ({
  codeLength: code.length,
  codeLines: code.length > 0 ? code.split('\n').length : 0,
})

type WarmSandboxEntry = {
  sandbox: Sandbox
  sandboxId: string
  queue: Promise<void>
  pendingRuns: number
  pendingRunsByScope: Map<string, number>
  killTimer?: ReturnType<typeof setTimeout>
  disposed?: boolean
}

const warmSandboxEntries = new Map<string, WarmSandboxEntry[]>()
type WarmSandboxCreation = {
  promise: Promise<WarmSandboxEntry>
  queueScope?: string
}
const warmSandboxCreations = new Map<string, Set<WarmSandboxCreation>>()
let shutdownHooksRegistered = false

const getWarmSandboxEntriesForKey = (cacheKey: string): WarmSandboxEntry[] =>
  warmSandboxEntries.get(cacheKey) ?? []

const getAnyPendingWarmSandboxCreationForKey = (
  cacheKey: string,
  queueScope?: string
): Promise<WarmSandboxEntry> | undefined => {
  const pending = warmSandboxCreations.get(cacheKey)
  if (!pending || pending.size === 0) return undefined
  if (queueScope) {
    const scoped = [...pending].find((entry) => entry.queueScope === queueScope)
    return scoped?.promise
  }
  return undefined
}

const getPendingWarmSandboxCreationsTotal = () =>
  [...warmSandboxCreations.values()].reduce((sum, pending) => sum + pending.size, 0)

export const getWarmSandboxPoolState = () => {
  const entries = [...warmSandboxEntries.values()].flat()
  const active = entries.length
  const inUse = entries.filter((entry) => entry.pendingRuns > 0).length
  const idle = Math.max(0, active - inUse)
  const pending = getPendingWarmSandboxCreationsTotal()
  return {
    active,
    inUse,
    idle,
    pending,
    total: active + pending,
    maxConcurrent: MAX_CONCURRENT_WARM_SANDBOXES,
  }
}

logger.info('E2B warm sandbox pool startup state', getWarmSandboxPoolState())

export const isE2BWarmSandboxLimitError = (
  error: unknown
): error is Error & {
  code: typeof E2B_WARM_SANDBOX_LIMIT_ERROR_CODE
  details?: {
    cacheKey?: string
    activeWarmSandboxes?: number
    pendingWarmSandboxes?: number
    maxConcurrentWarmSandboxes?: number
  }
} => {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: unknown; name?: unknown }
  return (
    maybeError.code === E2B_WARM_SANDBOX_LIMIT_ERROR_CODE ||
    maybeError.name === 'E2BWarmSandboxLimitError'
  )
}

const sanitizeTemplate = (template?: string) => {
  const value = template?.trim()
  return value && value.length > 0 ? value : undefined
}

const sanitizeUserScope = (userScope?: string) => {
  const value = userScope?.trim()
  return value && value.length > 0 ? value : undefined
}

const normalizeKeepWarmMs = (keepWarmMs?: number) => {
  if (!Number.isFinite(keepWarmMs)) return 0
  const normalizedKeepWarmMs = Math.max(0, Math.floor(keepWarmMs ?? 0))
  return Math.min(normalizedKeepWarmMs, E2B_KEEP_WARM_CAP_MS)
}

const resolveWarmSandboxTimeoutMs = (keepWarmMs: number, executionTimeoutMs: number) =>
  Math.min(
    E2B_KEEP_WARM_CAP_MS,
    keepWarmMs + Math.max(0, executionTimeoutMs) + WARM_SANDBOX_TIMEOUT_BUFFER_MS
  )

const buildWarmCacheKey = ({
  template,
  language,
}: {
  template?: string
  language: CodeLanguage
}) =>
  `${template ?? '__default_template__'}::${language}::pool`

const clearWarmKillTimer = (entry: WarmSandboxEntry) => {
  if (!entry.killTimer) return
  clearTimeout(entry.killTimer)
  entry.killTimer = undefined
}

const createSandbox = async (template: string | undefined, apiKey: string) => {
  return template ? Sandbox.create(template, { apiKey }) : Sandbox.create({ apiKey })
}

const registerWarmSandboxCreation = (cacheKey: string, creation: WarmSandboxCreation) => {
  const existing = warmSandboxCreations.get(cacheKey)
  if (existing) {
    existing.add(creation)
    return
  }
  warmSandboxCreations.set(cacheKey, new Set([creation]))
}

const unregisterWarmSandboxCreation = (cacheKey: string, creation: WarmSandboxCreation) => {
  const existing = warmSandboxCreations.get(cacheKey)
  if (!existing) return
  existing.delete(creation)
  if (existing.size === 0) {
    warmSandboxCreations.delete(cacheKey)
  }
}

const appendWarmSandboxEntry = (cacheKey: string, entry: WarmSandboxEntry) => {
  const existing = warmSandboxEntries.get(cacheKey)
  if (existing) {
    existing.push(entry)
    return
  }
  warmSandboxEntries.set(cacheKey, [entry])
}

const removeWarmSandboxEntry = (cacheKey: string, entry: WarmSandboxEntry) => {
  const existing = warmSandboxEntries.get(cacheKey)
  if (!existing) return
  const next = existing.filter((candidate) => candidate !== entry)
  if (next.length === 0) {
    warmSandboxEntries.delete(cacheKey)
    return
  }
  warmSandboxEntries.set(cacheKey, next)
}

const destroyWarmSandboxEntry = async (cacheKey: string, entry: WarmSandboxEntry, reason: string) => {
  if (entry.disposed) return
  entry.disposed = true
  clearWarmKillTimer(entry)
  removeWarmSandboxEntry(cacheKey, entry)
  try {
    await entry.queue.catch(() => undefined)
    await entry.sandbox.kill()
  } catch {}
  logger.debug('Disposed warm E2B sandbox', { cacheKey, sandboxId: entry.sandboxId, reason })
}

const ensureShutdownHooks = () => {
  if (shutdownHooksRegistered) return
  shutdownHooksRegistered = true

  const drain = async (reason: string) => {
    const entries = [...warmSandboxEntries.entries()].flatMap(([cacheKey, cacheEntries]) =>
      cacheEntries.map((entry) => ({ cacheKey, entry }))
    )
    await Promise.all(
      entries.map(({ cacheKey, entry }) => destroyWarmSandboxEntry(cacheKey, entry, reason))
    )
  }

  process.once('beforeExit', () => {
    void drain('process_before_exit')
  })
  process.once('SIGINT', () => {
    void drain('process_sigint')
  })
  process.once('SIGTERM', () => {
    void drain('process_sigterm')
  })
}

const createWarmSandboxEntry = async ({
  cacheKey,
  template,
  apiKey,
  queueScope,
}: {
  cacheKey: string
  template?: string
  apiKey: string
  queueScope?: string
}): Promise<WarmSandboxEntry> => {
  const creationPromise = (async () => {
    const sandbox = await createSandbox(template, apiKey)
    const entry: WarmSandboxEntry = {
      sandbox,
      sandboxId: sandbox.sandboxId,
      queue: Promise.resolve(),
      pendingRuns: 0,
      pendingRunsByScope: new Map(),
    }
    appendWarmSandboxEntry(cacheKey, entry)
    logger.debug('Created warm E2B sandbox', {
      cacheKey,
      sandboxId: entry.sandboxId,
      template,
    })
    ensureShutdownHooks()
    return entry
  })()
  const creation: WarmSandboxCreation = { promise: creationPromise, queueScope }

  registerWarmSandboxCreation(cacheKey, creation)
  try {
    return await creationPromise
  } finally {
    unregisterWarmSandboxCreation(cacheKey, creation)
  }
}

const selectLeastBusyWarmSandbox = (entries: WarmSandboxEntry[]) =>
  entries.reduce((leastBusy, entry) => (entry.pendingRuns < leastBusy.pendingRuns ? entry : leastBusy))

const selectLeastBusyWarmSandboxForScope = (entries: WarmSandboxEntry[], scope: string) => {
  const scopeEntries = entries.filter((entry) => (entry.pendingRunsByScope.get(scope) ?? 0) > 0)
  if (scopeEntries.length === 0) return undefined
  return selectLeastBusyWarmSandbox(scopeEntries)
}

const buildWarmSandboxLimitError = (cacheKey: string) => {
  const poolState = getWarmSandboxPoolState()
  return Object.assign(new Error('E2B warm sandbox pool at capacity'), {
    name: 'E2BWarmSandboxLimitError',
    code: E2B_WARM_SANDBOX_LIMIT_ERROR_CODE,
    details: {
      cacheKey,
      activeWarmSandboxes: poolState.active,
      pendingWarmSandboxes: poolState.pending,
      maxConcurrentWarmSandboxes: MAX_CONCURRENT_WARM_SANDBOXES,
    },
  })
}

const getOrCreateWarmSandbox = async ({
  cacheKey,
  template,
  apiKey,
  queueScope,
}: {
  cacheKey: string
  template?: string
  apiKey: string
  queueScope?: string
}): Promise<WarmSandboxEntry> => {
  const entries = getWarmSandboxEntriesForKey(cacheKey)
  const idleEntry = entries.find((entry) => entry.pendingRuns === 0)
  if (idleEntry) return idleEntry

  const poolState = getWarmSandboxPoolState()
  const hasGlobalCapacity =
    !MAX_CONCURRENT_WARM_SANDBOXES || poolState.total < MAX_CONCURRENT_WARM_SANDBOXES
  if (hasGlobalCapacity) {
    return createWarmSandboxEntry({
      cacheKey,
      template,
      apiKey,
      queueScope,
    })
  }

  if (entries.length > 0) {
    if (queueScope) {
      const existingScopeEntry = selectLeastBusyWarmSandboxForScope(entries, queueScope)
      if (existingScopeEntry) return existingScopeEntry
    }
  }

  const pendingCreation = getAnyPendingWarmSandboxCreationForKey(cacheKey, queueScope)
  if (pendingCreation) return pendingCreation

  logger.warn('Warm E2B sandbox pool at capacity', {
    cacheKey,
    ...poolState,
  })
  throw buildWarmSandboxLimitError(cacheKey)
}

const runWithSandboxLock = async <T>(
  entry: WarmSandboxEntry,
  queueScope: string | undefined,
  task: () => Promise<T>
): Promise<T> => {
  entry.pendingRuns += 1
  if (queueScope) {
    entry.pendingRunsByScope.set(queueScope, (entry.pendingRunsByScope.get(queueScope) ?? 0) + 1)
  }
  const previous = entry.queue
  let release: () => void = () => {}
  entry.queue = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    entry.pendingRuns = Math.max(0, entry.pendingRuns - 1)
    if (queueScope) {
      const next = (entry.pendingRunsByScope.get(queueScope) ?? 1) - 1
      if (next <= 0) {
        entry.pendingRunsByScope.delete(queueScope)
      } else {
        entry.pendingRunsByScope.set(queueScope, next)
      }
    }
    release()
  }
}

const scheduleWarmSandboxKill = (cacheKey: string, entry: WarmSandboxEntry, keepWarmMs: number) => {
  if (entry.disposed) return
  clearWarmKillTimer(entry)
  entry.killTimer = setTimeout(() => {
    void destroyWarmSandboxEntry(cacheKey, entry, 'keep_warm_expired')
  }, keepWarmMs)
  entry.killTimer.unref?.()
}

const runCodeInSandbox = async ({
  sandbox,
  sandboxId,
  code,
  language,
  timeoutMs,
}: {
  sandbox: Sandbox
  sandboxId: string
  code: string
  language: CodeLanguage
  timeoutMs: number
}): Promise<E2BExecutionResult> => {
  const stdoutChunks: string[] = []
  const execution = await sandbox.runCode(code, {
    language: language === CodeLanguage.Python ? 'python' : 'javascript',
    timeoutMs,
  })

  if (execution.error) {
    const errorMessage = `${execution.error.name}: ${execution.error.value}`
    logger.error(`E2B execution error`, {
      sandboxId,
      error: execution.error,
      errorMessage,
    })

    const errorOutput = execution.error.traceback || errorMessage
    return {
      result: null,
      stdout: errorOutput,
      error: errorMessage,
      sandboxId,
    }
  }

  if (execution.text) {
    stdoutChunks.push(execution.text)
  }
  if (execution.logs?.stdout) {
    stdoutChunks.push(...execution.logs.stdout)
  }
  if (execution.logs?.stderr) {
    stdoutChunks.push(...execution.logs.stderr)
  }

  const stdout = stdoutChunks.join('\n')
  let result: unknown = null
  const prefix = '__TG_RESULT__='
  const lines = stdout.split('\n')
  const marker = lines.find((l) => l.startsWith(prefix))
  let cleanedStdout = stdout
  if (marker) {
    const jsonPart = marker.slice(prefix.length)
    try {
      result = JSON.parse(jsonPart)
    } catch {
      result = jsonPart
    }
    cleanedStdout = lines.filter((l) => !l.startsWith(prefix)).join('\n')
  }

  return { result, stdout: cleanedStdout, sandboxId }
}

export async function executeInE2B(req: E2BExecutionRequest): Promise<E2BExecutionResult> {
  const { code, language, timeoutMs } = req
  const template = sanitizeTemplate(req.template)
  const keepWarmMs = normalizeKeepWarmMs(req.keepWarmMs)
  const userScope = sanitizeUserScope(req.userScope)
  const queueScope = userScope
  const warmReuseEnabled = keepWarmMs > 0

  logger.info(`Executing code in E2B`, {
    language,
    timeoutMs,
    template,
    userScope,
    warmReuseEnabled,
    keepWarmMs: warmReuseEnabled ? keepWarmMs : undefined,
    ...summarizeCode(code),
  })

  const apiKey = process.env.E2B_API_KEY
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required when E2B is enabled')
  }

  if (warmReuseEnabled) {
    const cacheKey = buildWarmCacheKey({ template, language })
    const warmSandboxTimeoutMs = resolveWarmSandboxTimeoutMs(keepWarmMs, timeoutMs)
    let retryOnNotFound = true

    while (true) {
      const entry = await getOrCreateWarmSandbox({
        cacheKey,
        template,
        apiKey,
        queueScope,
      })

      try {
        const result = await runWithSandboxLock(entry, queueScope, async () => {
          // Clear keep-warm timer right before execution starts (after queue wait).
          // This avoids inheriting an about-to-expire timer from a prior run.
          clearWarmKillTimer(entry)
          const executionResult = await runCodeInSandbox({
            sandbox: entry.sandbox,
            sandboxId: entry.sandboxId,
            code,
            language,
            timeoutMs,
          })
          await entry.sandbox.setTimeout(warmSandboxTimeoutMs)
          return executionResult
        })

        scheduleWarmSandboxKill(cacheKey, entry, keepWarmMs)
        return result
      } catch (error) {
        const shouldRetry = retryOnNotFound && isSandboxNotFoundError(error)
        await destroyWarmSandboxEntry(
          cacheKey,
          entry,
          shouldRetry ? 'sandbox_not_found_retry' : 'execution_failed'
        )
        if (!shouldRetry) {
          throw error
        }
        retryOnNotFound = false
      }
    }
  }

  const sandbox = await createSandbox(template, apiKey)
  try {
    return await runCodeInSandbox({
      sandbox,
      sandboxId: sandbox.sandboxId,
      code,
      language,
      timeoutMs,
    })
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}
