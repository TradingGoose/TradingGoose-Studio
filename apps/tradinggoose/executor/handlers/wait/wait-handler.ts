import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WaitBlockHandler')

const sleep = async (ms: number, signal?: AbortSignal): Promise<boolean> => {
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve(true)
    }, ms)
    const cancel = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      resolve(false)
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

/**
 * Handler for Wait blocks that pause workflow execution for a time delay
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.WAIT
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing Wait block: ${block.id}`, { inputs })

    // Parse the wait duration
    const timeValue = Number.parseInt(inputs.timeValue || '10', 10)
    const timeUnit = inputs.timeUnit || 'seconds'

    // Validate time value
    if (Number.isNaN(timeValue) || timeValue <= 0) {
      throw new Error('Wait amount must be a positive number')
    }

    // Calculate wait time in milliseconds
    let waitMs = timeValue * 1000 // Default to seconds
    if (timeUnit === 'minutes') {
      waitMs = timeValue * 60 * 1000
    }

    // Enforce 10-minute maximum (600,000 ms)
    const maxWaitMs = 10 * 60 * 1000
    if (waitMs > maxWaitMs) {
      const maxDisplay = timeUnit === 'minutes' ? '10 minutes' : '600 seconds'
      throw new Error(`Wait time exceeds maximum of ${maxDisplay}`)
    }

    logger.info(`Waiting for ${waitMs}ms (${timeValue} ${timeUnit})`)

    const completed = await sleep(waitMs, context.workflowDeadlineSignal)

    if (!completed) {
      logger.info('Wait was interrupted by cancellation')
      throw new Error('Workflow wait was canceled')
    }

    logger.info('Wait completed successfully')
    return {
      waitDuration: waitMs,
      status: 'completed',
    }
  }
}
