import { Document } from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/document'
import { GlobalCopilotKnowledgeContextPublisher } from '@/global-navbar/copilot-context'

interface DocumentPageProps {
  params: Promise<{
    locale: string
    workspaceId: string
    id: string
    documentId: string
  }>
  searchParams: Promise<{
    kbName?: string
    docName?: string
  }>
}

export default async function DocumentChunksPage({ params, searchParams }: DocumentPageProps) {
  const { id, documentId, workspaceId } = await params
  const { kbName, docName } = await searchParams

  return (
    <>
      <GlobalCopilotKnowledgeContextPublisher knowledgeBaseId={id} workspaceId={workspaceId} />
      <Document
        knowledgeBaseId={id}
        documentId={documentId}
        knowledgeBaseName={kbName || 'Knowledge Base'}
        documentName={docName || 'Document'}
      />
    </>
  )
}
