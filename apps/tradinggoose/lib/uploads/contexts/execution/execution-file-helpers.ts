import type { WorkflowExecutionLog } from '@/lib/logs/types'
import type { UserFile } from '@/executor/types'

/**
 * Execution context for file operations
 */
export interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/** Collect file metadata independently of the surrounding output or tool transcript. */
export function extractExecutionFiles(
  ...values: unknown[]
): NonNullable<WorkflowExecutionLog['files']> {
  const files: NonNullable<WorkflowExecutionLog['files']> = []
  const ids = new Set<string>()
  const visited = new WeakSet<object>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    const file = value as (typeof files)[number]
    if (
      typeof file.id === 'string' &&
      file.id &&
      typeof file.name === 'string' &&
      file.name &&
      typeof file.key === 'string' &&
      file.key &&
      typeof file.size === 'number' &&
      !ids.has(file.id)
    ) {
      ids.add(file.id)
      files.push({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        url: file.url,
        key: file.key,
        uploadedAt: file.uploadedAt,
        expiresAt: file.expiresAt,
        storageProvider: file.storageProvider,
        bucketName: file.bucketName,
      })
    }
    for (const child of Object.values(value)) visit(child)
  }
  for (const value of values) visit(value)
  return files
}

/**
 * Generate execution-scoped storage key
 * Format: workspace_id/workflow_id/execution_id/filename
 */
export function generateExecutionFileKey(context: ExecutionContext, fileName: string): string {
  const { workspaceId, workflowId, executionId } = context
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${workspaceId}/${workflowId}/${executionId}/${safeFileName}`
}

/**
 * Generate unique file ID for execution files
 */
export function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get file expiration date for execution files (5 minutes from now)
 */
export function getFileExpirationDate(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString()
}

/**
 * Check if a file is from execution storage based on its key pattern
 * Execution files have keys in format: workspaceId/workflowId/executionId/filename
 * Regular files have keys in format: timestamp-random-filename or just filename
 */
export function isExecutionFile(file: UserFile): boolean {
  if (!file.key) {
    return false
  }

  // Execution files have at least 3 slashes in their key (4 parts)
  // e.g., "workspace123/workflow456/execution789/document.pdf"
  const parts = file.key.split('/')
  return parts.length >= 4 && !file.key.startsWith('/api/') && !file.key.startsWith('http')
}
