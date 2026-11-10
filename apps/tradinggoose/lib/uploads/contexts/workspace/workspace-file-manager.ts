import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import {
  PrivateSourceAccessError,
  PrivateSourceMutationError,
  withAuthorizedStorageDelete,
} from '@/lib/uploads/source-read-boundary'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { db } from '@tradinggoose/db'
import { workspaceFile } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { createLogger } from '@/lib/logs/console/logger'
import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WorkspaceFileStorage')

export interface WorkspaceFileRecord {
  id: string
  workspaceId: string
  name: string
  key: string
  path: string // Full serve path including storage type
  url?: string // Presigned URL for external access (optional, regenerated as needed)
  size: number
  type: string
  uploadedBy: string
  uploadedAt: Date
}

/**
 * Generate workspace-scoped storage key
 * Pattern: {workspaceId}/{timestamp}-{filename}
 */
export function generateWorkspaceFileKey(workspaceId: string, fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${workspaceId}/${timestamp}-${random}-${safeFileName}`
}

/**
 * Upload a file to workspace-scoped storage
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  userId: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<UserFile> {
  logger.info(`Uploading workspace file: ${fileName} for workspace ${workspaceId}`)

  const exists = await fileExistsInWorkspace(workspaceId, fileName)
  if (exists) {
    throw new Error(`A file named "${fileName}" already exists in this workspace`)
  }

  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length, workspaceId)

  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  const storageKey = generateWorkspaceFileKey(workspaceId, fileName)
  const fileId = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  try {
    logger.info(`Generated storage key: ${storageKey}`)

    const uploadResult = await uploadFile({
      file: fileBuffer,
      fileName: storageKey, // Use the full storageKey as fileName
      contentType,
      context: 'workspace',
      preserveKey: true, // Don't add timestamp prefix
      customKey: storageKey, // Explicitly set the key
    })

    logger.info(`Upload returned key: ${uploadResult.key}`)

    await db.insert(workspaceFile).values({
      id: fileId,
      workspaceId,
      name: fileName,
      key: uploadResult.key, // This is what actually got stored in S3
      size: fileBuffer.length,
      type: contentType,
      uploadedBy: userId,
      uploadedAt: new Date(),
    })

    logger.info(`Successfully uploaded workspace file: ${fileName} with key: ${uploadResult.key}`)

    try {
      await incrementStorageUsage(userId, fileBuffer.length, workspaceId)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
    }

    const { getServePathPrefix } = await import('@/lib/uploads')
    const authorizedPath = `${getServePathPrefix()}${encodeURIComponent(uploadResult.key)}?${new URLSearchParams({ context: 'workspace', workspaceId, fileId })}`

    return {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: authorizedPath,
      key: uploadResult.key,
      uploadedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      context: 'workspace',
    }
  } catch (error) {
    logger.error(`Failed to upload workspace file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Check if a file with the same name already exists in workspace
 */
export async function fileExistsInWorkspace(
  workspaceId: string,
  fileName: string
): Promise<boolean> {
  try {
    const existing = await db
      .select()
      .from(workspaceFile)
      .where(and(eq(workspaceFile.workspaceId, workspaceId), eq(workspaceFile.name, fileName)))
      .limit(1)

    return existing.length > 0
  } catch (error) {
    logger.error(`Failed to check file existence for ${fileName}:`, error)
    return false
  }
}

/**
 * List all files for a workspace
 */
export async function listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileRecord[]> {
  try {
    const files = await db
      .select()
      .from(workspaceFile)
      .where(eq(workspaceFile.workspaceId, workspaceId))
      .orderBy(workspaceFile.uploadedAt)

    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    return files.map((file) => ({
      ...file,
      path: `${pathPrefix}${encodeURIComponent(file.key)}?${new URLSearchParams({ context: 'workspace', workspaceId, fileId: file.id })}`,
    }))
  } catch (error) {
    logger.error(`Failed to list workspace files for ${workspaceId}:`, error)
    return []
  }
}

/**
 * Get a specific workspace file
 */
export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string
): Promise<WorkspaceFileRecord | null> {
  try {
    const files = await db
      .select()
      .from(workspaceFile)
      .where(and(eq(workspaceFile.id, fileId), eq(workspaceFile.workspaceId, workspaceId)))
      .limit(1)

    if (files.length === 0) return null

    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    return {
      ...files[0],
      path: `${pathPrefix}${encodeURIComponent(files[0].key)}?${new URLSearchParams({ context: 'workspace', workspaceId, fileId: files[0].id })}`,
    }
  } catch (error) {
    logger.error(`Failed to get workspace file ${fileId}:`, error)
    return null
  }
}

/**
 * Download workspace file content
 */
export async function downloadWorkspaceFile(fileRecord: WorkspaceFileRecord): Promise<Buffer> {
  logger.info(`Downloading workspace file: ${fileRecord.name}`)

  try {
    const buffer = await downloadFile({
      key: fileRecord.key,
      context: 'workspace',
    })
    logger.info(
      `Successfully downloaded workspace file: ${fileRecord.name} (${buffer.length} bytes)`
    )
    return buffer
  } catch (error) {
    logger.error(`Failed to download workspace file ${fileRecord.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete a workspace file (both from storage and database)
 */
export async function deleteWorkspaceFile(
  workspaceId: string,
  fileId: string,
  actorUserId: string
): Promise<void> {
  if (!actorUserId || !(await checkWorkspaceAccess(workspaceId, actorUserId)).canWrite)
    throw new PrivateSourceMutationError()
  logger.info(`Deleting workspace file: ${fileId}`)

  try {
    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord || fileRecord.workspaceId !== workspaceId || fileRecord.id !== fileId)
      throw new PrivateSourceMutationError()

    await withAuthorizedStorageDelete(fileRecord.key, 'workspace', () =>
      deleteFile({ key: fileRecord.key, context: 'workspace' })
    )

    await db
      .delete(workspaceFile)
      .where(and(eq(workspaceFile.id, fileId), eq(workspaceFile.workspaceId, workspaceId)))

    try {
      await decrementStorageUsage(fileRecord.uploadedBy, fileRecord.size, workspaceId)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
    }

    logger.info(`Successfully deleted workspace file: ${fileRecord.name}`)
  } catch (error) {
    logger.error(`Failed to delete workspace file ${fileId}:`, error)
    if (error instanceof PrivateSourceMutationError) throw error
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/** Locators are untrusted: only a fresh actor permission and actual exact-key row grant access. */
export async function resolveAuthorizedWorkspaceFileReference(
  reference: string,
  actorUserId: string | undefined
): Promise<WorkspaceFileRecord | null> {
  assertPublicStorageInput(reference)
  const url = new URL(reference, 'https://storage-reference.invalid')
  if (
    !url.pathname.startsWith('/api/files/serve/') ||
    url.searchParams.get('context') !== 'workspace'
  )
    return null
  const workspaceId = url.searchParams.get('workspaceId')
  const fileId = url.searchParams.get('fileId')
  if (!workspaceId || !fileId) return null
  if (!actorUserId || !(await checkWorkspaceAccess(workspaceId, actorUserId)).hasAccess)
    throw new PrivateSourceAccessError()
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (
    !file ||
    file.id !== fileId ||
    file.workspaceId !== workspaceId ||
    file.key !== extractStorageKey(reference)
  )
    throw new PrivateSourceAccessError()
  return file
}
