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
