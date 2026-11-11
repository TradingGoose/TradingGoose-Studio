'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '@/lib/auth-client'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { useWorkflowSession, WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCopilotStore } from '@/stores/copilot/store'
import type { WorkflowChatDeploymentRequest } from '@/stores/copilot/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { DeployModal } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/deploy-modal'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

type TargetProps = {
  request: WorkflowChatDeploymentRequest
  container: HTMLElement | null
  fail: (message: string) => void
}

function ReadyChatDeployment({ request, container, fail }: TargetProps) {
  const session = useWorkflowSession()
  const blocks = useWorkflowBlocks()
  const { readPendingTool, settleWorkflowChatDeployment } = useCopilotStore()
  const [open, setOpen] = useState(false)
  const [isDeployed, setIsDeployed] = useState(false)
  const [needsRedeployment, setNeedsRedeployment] = useState(false)
  const [deployedState, setDeployedState] = useState<WorkflowState | null>(null)
  const [isLoadingDeployedState, setIsLoadingDeployedState] = useState(true)
  const controller = useMemo(() => new AbortController(), [request.id])
  const lifetime = useRef({ controller, generation: 0 })
  lifetime.current.controller = controller
  const ready =
    session.workflowId === request.workflowId &&
    Boolean(session.doc) &&
    session.isSynced &&
    !session.isLoading &&
    !session.error &&
    session.canEdit
  const hasChat = Object.values(blocks).some((block) => resolveTriggerIdForBlock(block) === 'chat')
  const refreshStatus = useCallback(async () => {
    const response = await fetch(
      `/api/workflows/${encodeURIComponent(request.workflowId)}/status`,
      {
        signal: controller.signal,
      }
    )
    if (!response.ok) throw new Error('Workflow deployment status could not be loaded')
    const data = await response.json()
    if (!request.isCurrent() || controller.signal.aborted) return false
    setIsDeployed(Boolean(data.isDeployed))
    setNeedsRedeployment(Boolean(data.needsRedeployment))
    return Boolean(data.isDeployed)
  }, [request.workflowId, request.isCurrent, controller])
  const refreshDeployed = useCallback(async () => {
    setIsLoadingDeployedState(true)
    try {
      const response = await fetch(
        `/api/workflows/${encodeURIComponent(request.workflowId)}/deployed`,
        {
          signal: controller.signal,
        }
      )
      if (response.status === 404) {
        if (request.isCurrent()) setDeployedState(null)
        return
      }
      if (!response.ok) throw new Error('Deployed workflow state could not be loaded')
      const data = await response.json()
      if (request.isCurrent() && !controller.signal.aborted)
        setDeployedState(data.deployedState || null)
    } finally {
      if (!controller.signal.aborted) setIsLoadingDeployedState(false)
    }
  }, [request.workflowId, request.isCurrent, controller])

  useEffect(() => {
    const generation = ++lifetime.current.generation
    return () =>
      queueMicrotask(() => {
        // React's effect re-setup retains this exact owner; actual unmount does not.
        if (
          lifetime.current.controller === controller &&
          lifetime.current.generation !== generation
        )
          return
        controller.abort()
        settleWorkflowChatDeployment(request.id, 'closed', 'Workflow deployment session ended')
      })
  }, [controller, request.id, settleWorkflowChatDeployment])
  useEffect(() => {
    if (!request.isCurrent()) {
      fail('Native tool selection changed')
      return
    }
    if (session.error || session.workflowId !== request.workflowId) {
      fail(session.error || 'Workflow session target differs')
      return
    }
    if (!ready) {
      if (request.opened) fail('Workflow deployment session is no longer ready')
      return
    }
    if (!hasChat) {
      fail('The target workflow has no chat trigger')
      return
    }
    if (request.opened) return
    let active = true
    void (async () => {
      await Promise.all([refreshStatus(), refreshDeployed()])
      if (!active || !request.isCurrent()) throw new Error('Native tool selection changed')
      const pending = await readPendingTool(request.toolCallId)
      const args = ToolArgSchemas.deploy_workflow.parse(pending.originalArgs)
      if (
        !active ||
        !request.isCurrent() ||
        pending.stage !== 'result' ||
        pending.target.toolName !== 'deploy_workflow' ||
        args.entityId !== request.workflowId ||
        args.action !== 'deploy' ||
        args.deployType !== 'chat'
      )
        throw new Error('Original chat deployment target changed')
      setOpen(true)
    })().catch((error) => {
      if (active)
        fail(error instanceof Error ? error.message : 'Chat deployment could not be opened')
    })
    return () => {
      active = false
    }
  }, [
    request.id,
    request.toolCallId,
    request.workflowId,
    request.opened,
    request.isCurrent,
    session.error,
    session.workflowId,
    ready,
    hasChat,
    readPendingTool,
    refreshStatus,
    refreshDeployed,
    fail,
  ])

  const onChatRendered = useCallback(() => {
    if (open && ready && hasChat && container?.isConnected && request.isCurrent())
      settleWorkflowChatDeployment(request.id, 'opened')
  }, [open, ready, hasChat, container, request.id, request.isCurrent, settleWorkflowChatDeployment])

  return (
    <DeployModal
      open={open && ready && hasChat && request.isCurrent()}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) settleWorkflowChatDeployment(request.id, 'closed')
      }}
      container={container}
      initialTab='chat'
      onChatRendered={onChatRendered}
      workflowId={request.workflowId}
      isDeployed={isDeployed}
      needsRedeployment={needsRedeployment}
      setNeedsRedeployment={setNeedsRedeployment}
      deployedState={deployedState}
      isLoadingDeployedState={isLoadingDeployedState}
      refetchDeployedState={refreshDeployed}
      refetchDeploymentStatus={refreshStatus}
    />
  )
}

function AuthorizedChatDeployment({ request, container, fail }: TargetProps) {
  const permissions = useUserPermissionsContext()
  const session = useSession()
  const user = session.data?.user
  const sessionUser = useMemo(
    () =>
      user
        ? {
            id: user.id,
            name: user.name ?? undefined,
            email: user.email,
          }
        : undefined,
    [user]
  )
  const allowed =
    !permissions.isLoading && !permissions.error && permissions.canEdit && permissions.canAdmin
  useEffect(() => {
    if (!request.isCurrent()) fail('Native tool selection changed')
    else if (!permissions.isLoading && !allowed)
      fail(permissions.error || 'Admin permission is required to open deployment settings')
    else if (!session.isPending && !user) fail('Authenticated workflow session is missing')
  }, [
    request.isCurrent,
    permissions.isLoading,
    permissions.error,
    allowed,
    session.isPending,
    user,
    fail,
  ])
  if (!allowed || !sessionUser || !request.isCurrent()) return null
  return (
    <WorkflowSessionProvider
      workspaceId={request.workspaceId}
      workflowId={request.workflowId}
      user={sessionUser}
    >
      <WorkflowRouteProvider
        workspaceId={request.workspaceId}
        workflowId={request.workflowId}
        channelId={`copilot-chat-deployment:${request.id}`}
      >
        <ReadyChatDeployment request={request} container={container} fail={fail} />
      </WorkflowRouteProvider>
    </WorkflowSessionProvider>
  )
}

/** One transient dialog owned by this exact authenticated Copilot store. */
export function WorkflowChatDeploymentDialog({ ownerUserId }: { ownerUserId: string }) {
  const request = useCopilotStore((state) => state.workflowChatDeployment)
  const settle = useCopilotStore((state) => state.settleWorkflowChatDeployment)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const id = request?.id
  const lifetime = useRef({ id, generation: 0 })
  lifetime.current.id = id
  const fail = useCallback(
    (message: string) => {
      if (id) settle(id, 'error', message)
    },
    [id, settle]
  )
  useEffect(() => {
    const generation = ++lifetime.current.generation
    return () =>
      queueMicrotask(() => {
        if (lifetime.current.id === id && lifetime.current.generation !== generation) return
        if (id) settle(id, 'closed', 'Chat deployment owner unmounted')
      })
  }, [id, settle])
  useEffect(() => {
    if (request && !request.isCurrent())
      settle(request.id, 'closed', 'Native tool selection changed')
  }, [request, settle])
  if (!request || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={setContainer}
      className='pointer-events-none fixed inset-0 z-[1100]'
      data-copilot-deployment={request.id}
      data-workflow-id={request.workflowId}
    >
      <Providers
        workspaceId={request.workspaceId}
        userId={ownerUserId}
        requireFresh
        onUnavailable={fail}
      >
        <AuthorizedChatDeployment
          key={request.id}
          request={request}
          container={container}
          fail={fail}
        />
      </Providers>
    </div>,
    document.body
  )
}
