import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import { GlobalCopilotKnowledgeContextPublisher } from '@/global-navbar/copilot-context'

interface PageProps {
  params: Promise<{
    id: string
    workspaceId: string
  }>
  searchParams: Promise<{
    kbName?: string
  }>
}

export default async function KnowledgeBasePage({ params, searchParams }: PageProps) {
  const { id, workspaceId } = await params
  const { kbName } = await searchParams

  return (
    <>
      <GlobalCopilotKnowledgeContextPublisher knowledgeBaseId={id} workspaceId={workspaceId} />
      <KnowledgeBase id={id} knowledgeBaseName={kbName || 'Knowledge Base'} />
    </>
  )
}
