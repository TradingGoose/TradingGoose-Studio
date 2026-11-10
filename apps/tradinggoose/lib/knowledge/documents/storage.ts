import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { createLogger } from '@/lib/logs/console/logger'
import { assertPublicStorageInput, fetchPublicStorageUrl } from '@/lib/uploads/archive-boundary'
import { getStorageConfig } from '@/lib/uploads/core/config-resolver'
import { getStorageProvider } from '@/lib/uploads/core/setup'
import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import {
  assertStorageDeleteAccess,
  assertStorageDeleteReferenceAccess,
  assertStorageReadAccess,
  assertStorageReferenceAccess,
  PrivateSourceAccessError,
  PrivateSourceMutationError,
  withAuthorizedStorageDelete,
  withAuthorizedStorageRead,
} from '@/lib/uploads/source-read-boundary'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { getBaseUrl } from '@/lib/urls/utils'

const KNOWLEDGE_STORAGE_CONTEXT = 'knowledge-base'
const logger = createLogger('KnowledgeDocumentStorage')

export type KnowledgeDocumentFileCleanup = {
  deleted: string[]
  retained: Array<{ fileUrl: string; reason: string }>
}

/** Created only after checking the current actor, canonical document/KB and queued metadata. */
export type KnowledgeDocumentSourceContext = {
  workspaceId: string
  knowledgeBaseId: string
  filename: string
  reauthorize: () => Promise<void>
  signal: AbortSignal
}

/** Shared pre-mutation grammar check; no IO, actor assertion or capability minting. */
export function assertKnowledgeDocumentSource(
  fileUrl: string,
  filename: string,
  source: Pick<KnowledgeDocumentSourceContext, 'workspaceId' | 'knowledgeBaseId' | 'filename'>
): void {
  resolveKnowledgeDocumentSource(fileUrl, filename, source)
}

function resolveKnowledgeDocumentSource(
  fileUrl: string,
  filename: string,
  source: Pick<KnowledgeDocumentSourceContext, 'workspaceId' | 'knowledgeBaseId' | 'filename'>
) {
  assertPublicStorageInput(fileUrl, KNOWLEDGE_STORAGE_CONTEXT)
  if (!source.workspaceId || !source.knowledgeBaseId || !filename || source.filename !== filename)
    throw new PrivateSourceAccessError()
  let url: URL
  try {
    url = new URL(fileUrl, getBaseUrl())
  } catch {
    throw new PrivateSourceAccessError()
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new PrivateSourceAccessError()
  if (url.pathname.startsWith('/api/files/serve/')) {
    const provider = getStorageProvider()
    const prefix = `/api/files/serve/${provider === 'local' ? '' : `${provider}/`}`
    if (
      url.origin !== new URL(getBaseUrl()).origin ||
      !url.pathname.startsWith(prefix) ||
      url.searchParams.getAll('context').length !== 1 ||
      url.searchParams.get('context') !== KNOWLEDGE_STORAGE_CONTEXT
    )
      throw new PrivateSourceAccessError()
    const key = decodeURIComponent(url.pathname.slice(prefix.length))
    assertPublicStorageInput(key, KNOWLEDGE_STORAGE_CONTEXT)
    if (key !== buildKnowledgeStorageKey(source.workspaceId, source.knowledgeBaseId, filename))
      throw new PrivateSourceAccessError()
    const config = { ...getStorageConfig(KNOWLEDGE_STORAGE_CONTEXT) }
    assertPublicStorageInput(fileUrl, KNOWLEDGE_STORAGE_CONTEXT, config)
    return { kind: 'storage' as const, key, provider, config }
  }
  if (!/^https?:\/\//i.test(fileUrl)) throw new PrivateSourceAccessError()
  assertStorageReferenceAccess(fileUrl, KNOWLEDGE_STORAGE_CONTEXT)
  return { kind: 'public' as const }
}

/** The capability surrounds actual IO; it is never sent through an HTTP request. */
export async function readKnowledgeDocumentSource(
  fileUrl: string,
  filename: string,
  source: KnowledgeDocumentSourceContext
): Promise<Buffer> {
  assertKnowledgeDocumentSource(fileUrl, filename, source)
  source.signal.throwIfAborted()
  await source.reauthorize()
  source.signal.throwIfAborted()
  const target = resolveKnowledgeDocumentSource(fileUrl, filename, source)
  if (target.kind === 'storage') {
    const { key, provider, config } = target
    const assertTarget = () => {
      if (
        provider !== getStorageProvider() ||
        !isDeepStrictEqual(config, getStorageConfig(KNOWLEDGE_STORAGE_CONTEXT))
      )
        throw new PrivateSourceAccessError()
      // Recheck actual local physical-root identity, which has no configuration fields.
      assertStorageReadAccess(key, KNOWLEDGE_STORAGE_CONTEXT, config, provider)
    }
    return withAuthorizedStorageRead(key, KNOWLEDGE_STORAGE_CONTEXT, async () => {
      assertStorageReferenceAccess(fileUrl, KNOWLEDGE_STORAGE_CONTEXT, config, provider)
      assertTarget()
      source.signal.throwIfAborted()
      const buffer = await downloadFile({
        key,
        context: KNOWLEDGE_STORAGE_CONTEXT,
        signal: source.signal,
      })
      source.signal.throwIfAborted()
      await source.reauthorize()
      source.signal.throwIfAborted()
      assertTarget()
      return buffer
    })
  }
  // Only absolute public URLs use fetch. No cookie, internal JWT or caller credential is forwarded.
  const response = await fetchPublicStorageUrl(fileUrl, { signal: source.signal }, async () => {
    await source.reauthorize()
    source.signal.throwIfAborted()
  })
  if (!response.ok)
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  source.signal.throwIfAborted()
  await source.reauthorize()
  source.signal.throwIfAborted()
  assertKnowledgeDocumentSource(fileUrl, filename, source)
  return buffer
}

export function buildKnowledgeStorageKey(
  workspaceId: string,
  knowledgeBaseId: string,
  fileName: string
) {
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${workspaceId}/${knowledgeBaseId}/${safeFileName}`
}

export function withKnowledgeStorageContext(filePath: string) {
  const [path, query = ''] = filePath.split('?')
  const params = new URLSearchParams(query)
  if (params.get('context') === KNOWLEDGE_STORAGE_CONTEXT) return filePath

  params.set('context', KNOWLEDGE_STORAGE_CONTEXT)
  return `${path}?${params.toString()}`
}

export async function copyKnowledgeDocumentFile({
  sourceFileUrl,
  targetWorkspaceId,
  targetKnowledgeBaseId,
  filename,
  mimeType,
}: {
  sourceFileUrl: string
  targetWorkspaceId: string
  targetKnowledgeBaseId: string
  filename: string
  mimeType: string
}) {
  assertStorageReferenceAccess(sourceFileUrl, KNOWLEDGE_STORAGE_CONTEXT)
  if (!sourceFileUrl.includes('/api/files/serve/')) {
    throw new Error('Knowledge document file must use an internal storage reference')
  }

  const sourceKey = extractStorageKey(sourceFileUrl)
  assertStorageReadAccess(sourceKey, KNOWLEDGE_STORAGE_CONTEXT)
  const file = await downloadFile({
    key: sourceKey,
    context: KNOWLEDGE_STORAGE_CONTEXT,
  })

  const targetKey = buildKnowledgeStorageKey(targetWorkspaceId, targetKnowledgeBaseId, filename)
  assertPublicStorageInput(targetKey, KNOWLEDGE_STORAGE_CONTEXT)
  const targetProvider = getStorageProvider()
  const targetConfig = { ...getStorageConfig(KNOWLEDGE_STORAGE_CONTEXT) }
  const assertTargetUnchanged = () => {
    if (
      targetProvider !== getStorageProvider() ||
      !isDeepStrictEqual(targetConfig, getStorageConfig(KNOWLEDGE_STORAGE_CONTEXT))
    ) {
      throw new Error('Knowledge copy target changed; file preserved')
    }
  }
  const uploaded = await uploadFile({
    file,
    fileName: targetKey,
    contentType: mimeType,
    context: KNOWLEDGE_STORAGE_CONTEXT,
    preserveKey: true,
    customKey: targetKey,
    preventOverwrite: true,
  })

  if (uploaded.key !== targetKey) {
    throw new Error('Knowledge copy returned a different target; file preserved')
  }
  assertTargetUnchanged()
  const runRollback = withAuthorizedStorageDelete(targetKey, KNOWLEDGE_STORAGE_CONTEXT, () =>
    AsyncLocalStorage.snapshot()
  )
  let rollbackUsed = false
  return {
    fileUrl: withKnowledgeStorageContext(uploaded.path),
    async rollback() {
      if (rollbackUsed) return
      rollbackUsed = true
      assertTargetUnchanged()
      await runRollback(() => deleteFile({ key: targetKey, context: KNOWLEDGE_STORAGE_CONTEXT }))
    },
  }
}

export async function deleteKnowledgeDocumentFiles(
  fileUrls: string[]
): Promise<KnowledgeDocumentFileCleanup> {
  const report: KnowledgeDocumentFileCleanup = { deleted: [], retained: [] }
  const attempts = new Map<string, Promise<void>>()
  for (const fileUrl of new Set(fileUrls)) {
    try {
      assertStorageDeleteReferenceAccess(fileUrl, KNOWLEDGE_STORAGE_CONTEXT)
      if (!fileUrl.includes('/api/files/serve/')) throw new PrivateSourceMutationError()
      const key = extractStorageKey(fileUrl)
      assertStorageDeleteAccess(key, KNOWLEDGE_STORAGE_CONTEXT)
      let deletion = attempts.get(key)
      if (!deletion) {
        deletion = deleteFile({ key, context: KNOWLEDGE_STORAGE_CONTEXT })
        attempts.set(key, deletion)
      }
      await deletion
      report.deleted.push(fileUrl)
    } catch (error) {
      logger.error('Knowledge document file retained:', error)
      report.retained.push({
        fileUrl,
        reason:
          error instanceof Error && 'status' in error && error.status === 403
            ? error.message
            : 'Storage deletion failed; file retained',
      })
    }
  }
  return report
}
