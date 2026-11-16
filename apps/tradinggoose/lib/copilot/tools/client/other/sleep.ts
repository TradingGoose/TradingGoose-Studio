import { Loader2, MinusCircle, Moon, XCircle } from 'lucide-react'
import type { z } from 'zod'
import type { ToolArgSchemas } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

type SleepArgs = z.infer<typeof ToolArgSchemas.sleep>

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
  constructor(toolCallId: string) {
    super(toolCallId, SleepClientTool.metadata)
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

  async execute({ seconds }: SleepArgs): Promise<void> {
    const logger = createLogger('SleepClientTool')

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
      this.fail(message)
    }
  }
}
