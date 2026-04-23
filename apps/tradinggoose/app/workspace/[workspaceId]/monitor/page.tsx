import { getSession } from '@/lib/auth'
import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'

export default async function WorkspaceMonitorPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const session = await getSession()
  const userId = session?.user?.id ?? null

  if (!userId) {
    return <div />
  }

  return <MonitorPage workspaceId={workspaceId} userId={userId} />
}
