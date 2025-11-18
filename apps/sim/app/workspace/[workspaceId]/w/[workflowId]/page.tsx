import WorkflowEditorApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-editor-app'

interface WorkflowPageProps {
  params: {
    workspaceId: string
    workflowId: string
  }
}

export default function WorkflowPage({ params }: WorkflowPageProps) {
  const { workspaceId, workflowId } = params
  return <WorkflowEditorApp workspaceId={workspaceId} workflowId={workflowId} />
}
