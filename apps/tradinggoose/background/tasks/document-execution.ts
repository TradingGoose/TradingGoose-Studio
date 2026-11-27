import { createBackgroundExecutionTask } from '../execution-job'

export const documentExecutionTask = createBackgroundExecutionTask('document', {
  machine: 'large-1x',
})
