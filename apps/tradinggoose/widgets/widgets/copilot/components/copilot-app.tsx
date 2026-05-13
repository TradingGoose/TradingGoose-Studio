'use client'

import type { ReactNode } from 'react'
import { useSession } from '@/lib/auth-client'
import {
  EntitySessionHost,
  useEntitySession,
} from '@/lib/copilot/review-sessions/entity-session-host'
import {
  ENTITY_KIND_WORKFLOW,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { CopilotStoreProvider, DEFAULT_COPILOT_CHANNEL_ID } from '@/stores/copilot/store'
import { normalizePairColorContext, usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { resolveCopilotWorkflowId } from '@/widgets/widgets/copilot/live-contexts'
import {
  COPILOT_WORKSPACE_ENTITY_CONFIGS,
  getCopilotWorkspaceEntityIdFromPairContext,
} from '@/widgets/widgets/copilot/workspace-entities'
import { useResolvedReviewTarget } from '@/widgets/widgets/copilot/use-resolved-review-target'
import { Copilot } from './copilot/copilot'

type CopilotAppUser =
  | {
      id: string
      name?: string
      email: string
    }
  | undefined
type EditableReviewEntityKind = Exclude<ReviewEntityKind, typeof ENTITY_KIND_WORKFLOW>
type CopilotBodyState = {
  inputDisabled: boolean
  reviewTarget: ReviewTargetDescriptor | null
}

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  channelId?: string
  pairColor: PairColor
}

function CopilotEntitySessionBoundary({
  workspaceId,
  entityKind,
  entityId,
  user,
  children,
}: {
  workspaceId: string
  entityKind: EditableReviewEntityKind
  entityId: string
  user: CopilotAppUser
  children: (state: CopilotBodyState) => ReactNode
}) {
  const { descriptor, error } = useResolvedReviewTarget({
    workspaceId,
    entityKind,
    entityId,
  })

  if (!descriptor) {
    return <>{children({ inputDisabled: !error, reviewTarget: null })}</>
  }

  return (
    <EntitySessionHost descriptor={descriptor} accessMode='read' user={user}>
      <CopilotEntitySessionGate descriptor={descriptor}>{children}</CopilotEntitySessionGate>
    </EntitySessionHost>
  )
}

function CopilotEntitySessionGate({
  descriptor,
  children,
}: {
  descriptor: ReviewTargetDescriptor
  children: (state: CopilotBodyState) => ReactNode
}) {
  const session = useEntitySession()
  const inputDisabled =
    session.isLoading || !session.doc || !session.isSynced || Boolean(session.error)

  return <>{children({ inputDisabled, reviewTarget: descriptor })}</>
}

const CopilotAppContent = ({
  workspaceId,
  panelWidth,
  channelId,
  pairColor,
  user,
}: {
  workspaceId: string
  panelWidth: number
  channelId: string
  pairColor: PairColor
  user: CopilotAppUser
}) => {
  const pairContext = normalizePairColorContext(usePairColorContext(pairColor))
  const workflowId = resolveCopilotWorkflowId(pairContext) ?? null
  const entityConfig = COPILOT_WORKSPACE_ENTITY_CONFIGS.find(
    (config) =>
      config.entityKind !== ENTITY_KIND_WORKFLOW &&
      Boolean(getCopilotWorkspaceEntityIdFromPairContext(pairContext, config.entityKind))
  )
  const entityId = entityConfig
    ? getCopilotWorkspaceEntityIdFromPairContext(pairContext, entityConfig.entityKind)
    : null

  const renderCopilotBody = (
    state: CopilotBodyState = { inputDisabled: false, reviewTarget: null }
  ) => (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        pairColor={pairColor}
        inputDisabled={state.inputDisabled}
        reviewTarget={state.reviewTarget}
      />
    </div>
  )

  const renderWorkflowContent = (state?: CopilotBodyState) =>
    workflowId ? (
      <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
        {renderCopilotBody(state)}
      </WorkflowSessionProvider>
    ) : (
      renderCopilotBody(state)
    )

  return entityConfig && entityId ? (
    <CopilotEntitySessionBoundary
      workspaceId={workspaceId}
      entityKind={entityConfig.entityKind as EditableReviewEntityKind}
      entityId={entityId}
      user={user}
    >
      {renderWorkflowContent}
    </CopilotEntitySessionBoundary>
  ) : (
    renderWorkflowContent()
  )
}

const CopilotApp = ({
  workspaceId,
  panelWidth,
  channelId = DEFAULT_COPILOT_CHANNEL_ID,
  pairColor,
}: CopilotAppProps) => {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  return (
    <Providers workspaceId={workspaceId}>
      <CopilotStoreProvider channelId={channelId}>
        <CopilotAppContent
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          channelId={channelId}
          pairColor={pairColor}
          user={user}
        />
      </CopilotStoreProvider>
    </Providers>
  )
}

export default CopilotApp
export { CopilotApp }
