'use client'

import { useEffect, useMemo, useState } from 'react'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { useSession } from '@/lib/auth-client'
import { EntitySessionHost } from '@/lib/copilot/review-sessions/entity-session-host'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { CopilotStoreProvider } from '@/stores/copilot/store'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import { useRegisteredEntitySession } from '@/lib/yjs/entity-session-registry'
import type { PairColor } from '@/widgets/pair-colors'
import {
  buildReviewTargetDescriptorFromState,
  resolveEntityReviewTarget,
} from '@/widgets/widgets/entity_review/review-target-utils'
import {
  buildCopilotEditableReviewTargets,
  type CopilotEditableReviewTarget,
} from '@/widgets/widgets/copilot/live-contexts'
import { Copilot } from './copilot/copilot'

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  channelId?: string
  pairColor: PairColor
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
  user:
    | {
        id: string
        name?: string
        email: string
      }
    | undefined
}) => {
  const pairContext = usePairColorContext(pairColor)
  const editableReviewTargets = useMemo(
    () => buildCopilotEditableReviewTargets({ pairContext }),
    [
      pairContext?.reviewTarget?.reviewSessionId,
      pairContext?.reviewTarget?.reviewEntityKind,
      pairContext?.reviewTarget?.reviewEntityId,
      pairContext?.reviewTarget?.reviewDraftSessionId,
    ]
  )
  const [resolvedEntityTargets, setResolvedEntityTargets] = useState<{
    key: string
    descriptors: ReviewTargetDescriptor[]
  } | null>(null)
  // Copilot threads stay channel-scoped. Editable entity sessions are mounted
  // only from explicit review targets; ambient current_* context is read-only.
  const entityTargetResolution = useMemo(() => {
    const immediate: ReviewTargetDescriptor[] = []
    const unresolved: CopilotEditableReviewTarget[] = []

    for (const target of editableReviewTargets) {
      const descriptor = buildReviewTargetDescriptorFromState({
        workspaceId,
        entityKind: target.entityKind,
        entityId: target.entityId,
        draftSessionId: target.draftSessionId,
        reviewSessionId: target.reviewSessionId,
      })

      if (descriptor) {
        immediate.push(descriptor)
      } else if (target.entityId || target.draftSessionId || target.reviewSessionId) {
        unresolved.push(target)
      }
    }

    return {
      immediate,
      unresolved,
      unresolvedKey:
        workspaceId && unresolved.length > 0
          ? JSON.stringify({
              workspaceId,
              targets: unresolved.map((target) => ({
                entityKind: target.entityKind,
                entityId: target.entityId,
                draftSessionId: target.draftSessionId,
                reviewSessionId: target.reviewSessionId,
              })),
            })
          : null,
    }
  }, [editableReviewTargets, workspaceId])

  useEffect(() => {
    if (!entityTargetResolution.unresolvedKey) {
      setResolvedEntityTargets(null)
      return
    }

    let cancelled = false

    Promise.all(
      entityTargetResolution.unresolved.map((target) =>
        resolveEntityReviewTarget({
          workspaceId,
          entityKind: target.entityKind,
          entityId: target.entityId ?? undefined,
          draftSessionId: target.draftSessionId ?? undefined,
          reviewSessionId: target.reviewSessionId ?? undefined,
        })
      )
    )
      .then((resolvedTargets) => {
        if (!cancelled) {
          setResolvedEntityTargets({
            key: entityTargetResolution.unresolvedKey!,
            descriptors: resolvedTargets.map((resolved) => resolved.descriptor),
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedEntityTargets(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [entityTargetResolution, workspaceId])

  const entityDescriptors = useMemo(
    () => [
      ...entityTargetResolution.immediate,
      ...(resolvedEntityTargets?.key === entityTargetResolution.unresolvedKey
        ? resolvedEntityTargets.descriptors
        : []),
    ],
    [entityTargetResolution.immediate, entityTargetResolution.unresolvedKey, resolvedEntityTargets]
  )
  const entitySession = useRegisteredEntitySession(entityDescriptors[0]?.reviewSessionId)
  const allEntitySessionsRegistered = entityDescriptors.every(
    (descriptor) =>
      descriptor.reviewSessionId &&
      entitySession?.descriptor.reviewSessionId === descriptor.reviewSessionId
  )
  const isResolvingReviewTarget = Boolean(
    entityTargetResolution.unresolvedKey &&
      resolvedEntityTargets?.key !== entityTargetResolution.unresolvedKey
  )
  const isWaitingForEntitySessions =
    entityDescriptors.length > 0 && !allEntitySessionsRegistered

  const copilotContent = (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        channelId={channelId}
        panelWidth={panelWidth}
        pairColor={pairColor}
        inputDisabled={isResolvingReviewTarget || isWaitingForEntitySessions}
      />
    </div>
  )

  return entityDescriptors.reduceRight(
    (children, descriptor) => (
      <EntitySessionHost
        key={descriptor.reviewSessionId ?? descriptor.yjsSessionId}
        descriptor={descriptor}
        user={user}
      >
        {children}
      </EntitySessionHost>
    ),
    copilotContent
  )
}

const CopilotApp = ({
  workspaceId,
  panelWidth,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
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
