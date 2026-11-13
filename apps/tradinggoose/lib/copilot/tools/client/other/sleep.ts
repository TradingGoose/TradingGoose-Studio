import { Loader2, MinusCircle, Moon, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

/** Maximum sleep duration in seconds (3 minutes) */
const MAX_SLEEP_SECONDS = 180

interface SleepArgs {
  seconds?: number
}

/**
 * Format seconds into a human-readable duration string
 */
function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.round(seconds / 60)} minute${seconds >= 120 ? 's' : ''}`
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`
}

export class SleepClientTool extends BaseClientTool {
  static readonly id = 'sleep'

  constructor(toolCallId: string) {
    super(toolCallId, SleepClientTool.id, SleepClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to sleep', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Sleeping', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Sleeping', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Finished sleeping', icon: Moon },
      [ClientToolCallState.error]: { text: 'Sleep interrupted', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Sleep skipped', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Sleep aborted', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      const seconds = params?.seconds
      if (typeof seconds === 'number' && seconds > 0) {
        const displayTime = formatDuration(seconds)
        switch (state) {
          case ClientToolCallState.success:
            return `Slept for ${displayTime}`
          case ClientToolCallState.executing:
          case ClientToolCallState.pending:
            return `Sleeping for ${displayTime}`
          case ClientToolCallState.generating:
            return `Preparing to sleep for ${displayTime}`
          case ClientToolCallState.error:
            return `Failed to sleep for ${displayTime}`
          case ClientToolCallState.rejected:
            return `Skipped sleeping for ${displayTime}`
          case ClientToolCallState.aborted:
            return `Aborted sleeping for ${displayTime}`
        }
      }
      return undefined
    },
  }

  async handleAccept(args?: SleepArgs): Promise<void> {
    const logger = createLogger('SleepClientTool')

    // Use a timeout slightly longer than max sleep (3 minutes + buffer)
    const timeoutMs = (MAX_SLEEP_SECONDS + 30) * 1000

    await this.executeWithTimeout(async () => {
      const params = args || {}
      logger.debug('handleAccept() called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasArgs: !!args,
        seconds: params.seconds,
      })

      // Validate and clamp seconds
      let seconds = typeof params.seconds === 'number' ? params.seconds : 0
      if (seconds < 0) seconds = 0
      if (seconds > MAX_SLEEP_SECONDS) seconds = MAX_SLEEP_SECONDS

      logger.debug('Starting sleep', { seconds })

      this.setState(ClientToolCallState.executing)

      try {
        // Sleep for the specified duration
        const signal = this.getAbortSignal()
        signal?.throwIfAborted()
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, seconds * 1000)
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        signal?.throwIfAborted()

        logger.debug('Sleep completed successfully')
        this.setState(ClientToolCallState.success)
        await this.completeBrowserAssertion({
          kind: 'timer.completed',
          data: { success: true, seconds, message: `Slept for ${seconds} seconds` },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Sleep failed', { error: message })
        this.setState(ClientToolCallState.error)
        this.fail(message)
      }
    }, timeoutMs)
  }

  async execute(args?: SleepArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
