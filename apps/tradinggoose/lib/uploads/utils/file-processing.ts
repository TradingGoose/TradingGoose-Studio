import type { Logger } from '@/lib/logs/console/logger'
import { ArchiveAccessError, assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-helpers'
import { resolveAuthorizedWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import * as StorageService from '@/lib/uploads/core/storage-service'
import {
  PrivateSourceAccessError,
  withAuthorizedStorageRead,
} from '@/lib/uploads/source-read-boundary'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

export type FileDownloadAuthority = {
  actorUserId: string
  workspaceId?: string
  signal: AbortSignal
}

function workspaceReference(reference: string | undefined): URL | null {
  if (!reference) return null
  const url = new URL(reference, 'https://storage-reference.invalid')
  if (
    !url.pathname.startsWith('/api/files/serve/') ||
    !url.searchParams.getAll('context').includes('workspace')
  )
    return null
  if (
    ['context', 'workspaceId', 'fileId'].some(
      (name) => url.searchParams.getAll(name).length !== 1 || !url.searchParams.get(name)
    )
  )
    throw new PrivateSourceAccessError()
  return url
}

/**
 * Converts a single raw file object to UserFile format
 * @param file - Raw file object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns UserFile object
 * @throws Error if file has no storage key
 */
export function processSingleFileToUserFile(
  file: any,
  requestId: string,
  logger: Logger
): UserFile {
  for (const value of [file.key, file.url, file.path].filter((value) => value !== undefined))
    assertPublicStorageInput(value, file.context)
  const references = [file.url, file.path].filter(
    (value): value is string => typeof value === 'string'
  )
  const canonical = references
    .map(workspaceReference)
    .filter((value): value is URL => value !== null)
  const locator = canonical[0]
  const canonicalReference = locator
    ? references.find((reference) => workspaceReference(reference))
    : undefined
  if (locator) {
    const fileId = locator.searchParams.get('fileId')!
    const workspaceId = locator.searchParams.get('workspaceId')!
    const key = extractStorageKey(locator.toString())
    if (
      (file.id !== undefined && file.id !== fileId) ||
      (file.key !== undefined && file.key !== key) ||
      (file.context !== undefined && file.context !== 'workspace') ||
      (file.workspaceId !== undefined && file.workspaceId !== workspaceId) ||
      canonical.some(
        (url) =>
          url.searchParams.get('fileId') !== fileId ||
          url.searchParams.get('workspaceId') !== workspaceId ||
          extractStorageKey(url.toString()) !== key
      )
    )
      throw new PrivateSourceAccessError()
  }
  // Already a UserFile (from variable reference)
  if (file.id && file.key && file.uploadedAt) {
    return locator
      ? { ...file, url: canonicalReference, context: file.context ?? 'workspace' }
      : (file as UserFile)
  }

  // Extract storage key from path or key property
  const storageKey =
    file.key ||
    (locator
      ? extractStorageKey(locator.toString())
      : file.path
        ? extractStorageKey(file.path)
        : null)

  if (!storageKey) {
    logger.warn(`[${requestId}] File has no storage key: ${file.name || 'unknown'}`)
    throw new Error(`File has no storage key: ${file.name || 'unknown'}`)
  }

  const userFile: UserFile = {
    id: file.id || locator?.searchParams.get('fileId') || `file-${Date.now()}`,
    name: file.name,
    url: canonicalReference || file.url || file.path,
    size: file.size,
    type: file.type || 'application/octet-stream',
    key: storageKey,
    context: file.context ?? (locator ? 'workspace' : undefined),
    uploadedAt: file.uploadedAt || new Date().toISOString(),
    expiresAt: file.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  logger.info(`[${requestId}] Converted file to UserFile: ${userFile.name} (key: ${userFile.key})`)
  return userFile
}

/**
 * Converts raw file objects (from file-upload or variable references) to UserFile format
 * @param files - Array of raw file objects
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Array of UserFile objects
 */
export function processFilesToUserFiles(
  files: any[],
  requestId: string,
  logger: Logger
): UserFile[] {
  const userFiles: UserFile[] = []

  for (const file of files) {
    try {
      const userFile = processSingleFileToUserFile(file, requestId, logger)
      userFiles.push(userFile)
    } catch (error) {
      if (error instanceof ArchiveAccessError || error instanceof PrivateSourceAccessError)
        throw error
      // Log and skip files that can't be processed
      logger.warn(
        `[${requestId}] Skipping file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  return userFiles
}

/**
 * Infer storage context from file key pattern
 * @param key - File storage key
 * @returns Inferred storage context
 */
function inferContextFromKey(key: string): StorageContext {
  // KB files always start with 'kb/' prefix
  if (key.startsWith('kb/')) {
    return 'knowledge-base'
  }

  // Execution files: three or more UUID segments
  // Pattern: {uuid}/{uuid}/{uuid}/{filename}
  const segments = key.split('/')
  if (segments.length >= 4 && segments[0].match(/^[a-f0-9-]{36}$/)) {
    return 'execution'
  }

  // Workspace files: UUID-like ID followed by timestamp pattern
  // Pattern: {uuid}/{timestamp}-{random}-{filename}
  if (key.match(/^[a-f0-9-]{36}\/\d+-[a-z0-9]+-/)) {
    return 'workspace'
  }

  // Default to general for all other patterns
  return 'general'
}

/**
 * Downloads a file from storage (execution or regular)
 * @param userFile - UserFile object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Buffer containing file data
 */
export async function downloadFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger,
  authority: FileDownloadAuthority
): Promise<Buffer> {
  assertPublicStorageInput(userFile.key, userFile.context)
  if (userFile.url) assertPublicStorageInput(userFile.url, userFile.context)
  if (!authority.actorUserId?.trim()) throw new PrivateSourceAccessError()
  authority.signal.throwIfAborted()
  const locator = workspaceReference(userFile.url)
  if (locator) {
    const resolve = async () => {
      authority.signal.throwIfAborted()
      const file = await resolveAuthorizedWorkspaceFileReference(
        userFile.url,
        authority.actorUserId
      )
      authority.signal.throwIfAborted()
      if (
        !file ||
        file.id !== userFile.id ||
        file.key !== userFile.key ||
        file.workspaceId !== locator.searchParams.get('workspaceId') ||
        file.id !== locator.searchParams.get('fileId') ||
        (userFile.context !== undefined && userFile.context !== 'workspace') ||
        (authority.workspaceId !== undefined && file.workspaceId !== authority.workspaceId)
      )
        throw new PrivateSourceAccessError()
      return file
    }
    const original = await resolve()
    const current = await resolve()
    if (
      current.id !== original.id ||
      current.key !== original.key ||
      current.workspaceId !== original.workspaceId
    )
      throw new PrivateSourceAccessError()
    const buffer = await withAuthorizedStorageRead(current.key, 'workspace', () =>
      StorageService.downloadFile({
        key: current.key,
        context: 'workspace',
        signal: authority.signal,
      })
    )
    authority.signal.throwIfAborted()
    await resolve()
    return buffer
  }
  if (!userFile.key) throw new Error('File has no key - cannot download')
  // Context selection preserves existing routing; raw keys acquire no read capability.
  const context = isExecutionFile(userFile)
    ? 'execution'
    : (userFile.context as StorageContext) || inferContextFromKey(userFile.key)
  if (context === 'workspace') throw new PrivateSourceAccessError()
  logger.info(`[${requestId}] Downloading from ${context} storage: ${userFile.key}`)
  const buffer = await StorageService.downloadFile({
    key: userFile.key,
    context,
    signal: authority.signal,
  })
  authority.signal.throwIfAborted()
  return buffer
}
