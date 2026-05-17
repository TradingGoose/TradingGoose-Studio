import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'

const KNOWLEDGE_STORAGE_CONTEXT = 'knowledge-base'

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
  if (!sourceFileUrl.includes('/api/files/serve/')) {
    throw new Error('Knowledge document file must be an owned storage file')
  }

  const file = await downloadFile({
    key: extractStorageKey(sourceFileUrl),
    context: KNOWLEDGE_STORAGE_CONTEXT,
  })

  const targetKey = buildKnowledgeStorageKey(targetWorkspaceId, targetKnowledgeBaseId, filename)
  const uploaded = await uploadFile({
    file,
    fileName: targetKey,
    contentType: mimeType,
    context: KNOWLEDGE_STORAGE_CONTEXT,
    preserveKey: true,
    customKey: targetKey,
  })

  return withKnowledgeStorageContext(uploaded.path)
}

export async function deleteKnowledgeDocumentFiles(fileUrls: string[]) {
  const keys = new Set(
    fileUrls
      .filter((fileUrl) => fileUrl.includes('/api/files/serve/'))
      .map((fileUrl) => extractStorageKey(fileUrl))
  )

  await Promise.all(
    Array.from(keys).map((key) =>
      deleteFile({
        key,
        context: KNOWLEDGE_STORAGE_CONTEXT,
      })
    )
  )
}
