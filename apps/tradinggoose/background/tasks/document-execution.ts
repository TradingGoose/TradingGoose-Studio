import { getDocumentProcessingMaxDurationSeconds } from '@/lib/knowledge/documents/config'
import { createBackgroundExecutionTask } from '../execution-job'

export const documentExecutionTask = createBackgroundExecutionTask('document', {
  machine: 'large-1x',
  maxDuration: getDocumentProcessingMaxDurationSeconds(),
})
