import { Sandbox } from '@e2b/code-interpreter'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { CodeLanguage } from './languages'

export interface E2BExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
  template?: string
  reuseKey?: string
  keepWarmMs?: number
}

export interface E2BExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
}

const logger = createLogger('E2BExecution')
const DEFAULT_MAX_E2B_KEEP_WARM_MS = 60 * 60 * 1000

const resolveMaxKeepWarmMs = () => {
  const raw = env.MAX_E2B_KEEP_WARM_MS
  if (!raw) return DEFAULT_MAX_E2B_KEEP_WARM_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_E2B_KEEP_WARM_MS
  return parsed
}

const MAX_E2B_KEEP_WARM_MS = resolveMaxKeepWarmMs()

const summarizeCode = (code: string) => ({
  codeLength: code.length,
  codeLines: code.length > 0 ? code.split('\n').length : 0,
})

type WarmSandboxEntry = {
  sandbox: Sandbox
  sandboxId: string
  queue: Promise<void>
  killTimer?: ReturnType<typeof setTimeout>
}

const warmSandboxEntries = new Map<string, WarmSandboxEntry>()
const warmSandboxCreations = new Map<string, Promise<WarmSandboxEntry>>()
let shutdownHooksRegistered = false

const sanitizeTemplate = (template?: string) => {
  const value = template?.trim()
  return value && value.length > 0 ? value : undefined
}

const sanitizeReuseKey = (reuseKey?: string) => {
  const value = reuseKey?.trim()
  return value && value.length > 0 ? value : undefined
}

const normalizeKeepWarmMs = (keepWarmMs?: number) => {
  if (!Number.isFinite(keepWarmMs)) return 0
  const normalizedKeepWarmMs = Math.max(0, Math.floor(keepWarmMs ?? 0))
  return Math.min(normalizedKeepWarmMs, MAX_E2B_KEEP_WARM_MS)
}

const buildWarmCacheKey = ({
  template,
  language,
  reuseKey,
}: {
  template?: string
  language: CodeLanguage
  reuseKey: string
}) => `${template ?? '__default_template__'}::${language}::${reuseKey}`

const clearWarmKillTimer = (entry: WarmSandboxEntry) => {
  if (!entry.killTimer) return
  clearTimeout(entry.killTimer)
  entry.killTimer = undefined
}

const createSandbox = async (template: string | undefined, apiKey: string) => {
  return template ? Sandbox.create(template, { apiKey }) : Sandbox.create({ apiKey })
}

const destroyWarmSandbox = async (cacheKey: string, reason: string) => {
  const entry = warmSandboxEntries.get(cacheKey)
  if (!entry) return
  clearWarmKillTimer(entry)
  warmSandboxEntries.delete(cacheKey)
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
    const keys = [...warmSandboxEntries.keys()]
    await Promise.all(keys.map((key) => destroyWarmSandbox(key, reason)))
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

const getOrCreateWarmSandbox = async ({
  cacheKey,
  template,
  apiKey,
}: {
  cacheKey: string
  template?: string
  apiKey: string
}): Promise<WarmSandboxEntry> => {
  const existing = warmSandboxEntries.get(cacheKey)
  if (existing) return existing

  const pending = warmSandboxCreations.get(cacheKey)
  if (pending) return pending

  const creationPromise = (async () => {
    const sandbox = await createSandbox(template, apiKey)
    const entry: WarmSandboxEntry = {
      sandbox,
      sandboxId: sandbox.sandboxId,
      queue: Promise.resolve(),
    }
    warmSandboxEntries.set(cacheKey, entry)
    logger.debug('Created warm E2B sandbox', {
      cacheKey,
      sandboxId: entry.sandboxId,
      template,
    })
    ensureShutdownHooks()
    return entry
  })()

  warmSandboxCreations.set(cacheKey, creationPromise)
  try {
    return await creationPromise
  } finally {
    warmSandboxCreations.delete(cacheKey)
  }
}

const runWithSandboxLock = async <T>(
  entry: WarmSandboxEntry,
  task: () => Promise<T>
): Promise<T> => {
  const previous = entry.queue
  let release: () => void = () => {}
  entry.queue = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
  }
}

const scheduleWarmSandboxKill = (cacheKey: string, keepWarmMs: number) => {
  const entry = warmSandboxEntries.get(cacheKey)
  if (!entry) return

  clearWarmKillTimer(entry)
  entry.killTimer = setTimeout(() => {
    void destroyWarmSandbox(cacheKey, 'keep_warm_expired')
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
  const prefix = '__SIM_RESULT__='
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
  const reuseKey = sanitizeReuseKey(req.reuseKey)
  const keepWarmMs = normalizeKeepWarmMs(req.keepWarmMs)
  const warmReuseEnabled = Boolean(reuseKey) && keepWarmMs > 0

  logger.info(`Executing code in E2B`, {
    language,
    timeoutMs,
    template,
    warmReuseEnabled,
    keepWarmMs: warmReuseEnabled ? keepWarmMs : undefined,
    reuseKey: warmReuseEnabled ? reuseKey : undefined,
    ...summarizeCode(code),
  })

  const apiKey = process.env.E2B_API_KEY
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required when E2B is enabled')
  }

  if (warmReuseEnabled && reuseKey) {
    const cacheKey = buildWarmCacheKey({ template, language, reuseKey })
    const entry = await getOrCreateWarmSandbox({ cacheKey, template, apiKey })
    clearWarmKillTimer(entry)

    try {
      const result = await runWithSandboxLock(entry, () =>
        runCodeInSandbox({
          sandbox: entry.sandbox,
          sandboxId: entry.sandboxId,
          code,
          language,
          timeoutMs,
        })
      )
      scheduleWarmSandboxKill(cacheKey, keepWarmMs)
      return result
    } catch (error) {
      await destroyWarmSandbox(cacheKey, 'execution_failed')
      throw error
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
