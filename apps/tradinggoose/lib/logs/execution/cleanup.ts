import { deleteAgentHistory } from '@/lib/mastra/agent-history'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { assertStorageReferenceAccess } from '@/lib/uploads/utils/file-utils'

/** Keep the owning log until all of its generated assets have been removed. */
export async function deleteExecutionLogAssets(log: {
  id: string
  workspaceId: string
  executionId: string | null
  files?: unknown
}) {
  const keys = new Set<string>()
  if (log.executionId && Array.isArray(log.files)) {
    for (const file of log.files) {
      if (!file || typeof file.key !== 'string') continue
      const parts = file.key.split('/')
      // Execution IDs are globally unique; workflow definitions may already have been deleted.
      if (
        parts.length !== 4 ||
        parts[0] !== log.workspaceId ||
        parts[2] !== log.executionId ||
        !parts[1] ||
        !parts[3]
      )
        continue
      assertStorageReferenceAccess(file.key, 'execution')
      keys.add(file.key)
    }
  }
  for (const key of keys) await deleteFile({ key, context: 'execution' })
  await deleteAgentHistory(log)
}
