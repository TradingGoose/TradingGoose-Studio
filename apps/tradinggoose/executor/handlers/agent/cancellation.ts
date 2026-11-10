/** Poll the existing workflow cancellation hook while native inference is awaited. */
export function watchExecutionCancellation(
  shouldCancel?: () => Promise<boolean>,
  timeout = 120000
) {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)])
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = async () => {
    try {
      if (await shouldCancel?.()) controller.abort(new Error('Workflow execution cancelled'))
    } catch (error) {
      controller.abort(error)
    }
    signal.throwIfAborted()
  }
  const poll = async () => {
    try {
      await check()
    } catch {
      return
    }
    if (!stopped) timer = setTimeout(poll, 1000)
  }
  if (shouldCancel) timer = setTimeout(poll, 1000)
  return {
    signal,
    check,
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
