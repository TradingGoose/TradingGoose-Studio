import type { ToolExecutionRuntime } from '@/tools/types'

export async function dispatchToolRemote<T>(
  runtime: ToolExecutionRuntime | undefined,
  dispatch: () => Promise<T>
): Promise<T> {
  runtime?.signal?.throwIfAborted()
  if (runtime?.claimRemoteDispatch && !(await runtime.claimRemoteDispatch())) {
    runtime.signal?.throwIfAborted()
    throw new Error('Tool dispatch is closed')
  }
  return dispatch()
}

export function dispatchToolFetch(
  runtime: ToolExecutionRuntime | undefined,
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  return dispatchToolRemote(runtime, () =>
    fetch(input, { ...init, signal: runtime?.signal ?? init?.signal })
  )
}

export async function waitForToolDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }, milliseconds)
    const abort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
