import { createBackgroundExecutionTask } from '../execution-job'

const duration = Number(process.env.KB_CONFIG_MAX_DURATION)
export const documentExecutionTask = createBackgroundExecutionTask('document', {
  machine: 'large-1x',
  maxDuration: Number.isFinite(duration) && duration >= 1 ? duration : 600,
})
