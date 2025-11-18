import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { WorkflowUIConfigProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-ui-context'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

interface WorkflowLayoutProps {
  children: React.ReactNode
  params: {
    workspaceId: string
    workflowId: string
  }
}

export default function WorkflowLayout({ children, params }: WorkflowLayoutProps) {
  const { workspaceId, workflowId } = params

  return (
    <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId}>
      <WorkflowUIConfigProvider
        value={{ panel: true, controlBar: true, floatingControls: true, trainingControls: true }}
      >
        <div className='flex min-h-screen w-full'>
          <div className='z-20'>
            <Sidebar />
          </div>
          <main className='flex flex-1 overflow-hidden bg-muted/40'>
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </WorkflowUIConfigProvider>
    </WorkflowRouteProvider>
  )
}
