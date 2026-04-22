'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { EntitySessionHost } from '@/lib/copilot/review-sessions/entity-session-host'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { useRegisteredEntitySession } from '@/lib/yjs/entity-session-registry'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import {
  CopilotStoreProvider,
  DEFAULT_COPILOT_CHANNEL_ID,
  useCopilotStoreApi,
} from '@/stores/copilot/store'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import {
  buildCopilotEditableReviewTargets,
  type CopilotEditableReviewTarget,
  resolveCopilotWorkflowId,
} from '@/widgets/widgets/copilot/live-contexts'
import {
  buildReviewTargetDescriptorFromState,
  resolveEntityReviewTarget,
} from '@/widgets/widgets/entity_review/review-target-utils'
import { Copilot } from './copilot/copilot'

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  channelId?: string
  pairColor: PairColor
}

function getEditableTargetLabel(target?: CopilotEditableReviewTarget): string {
  switch (target?.entityKind) {
    case 'skill':
      return 'skill'
    case 'custom_tool':
      return 'custom tool'
    case 'indicator':
      return 'indicator'
    case 'mcp_server':
      return 'MCP server'
    default:
      return 'entity'
  }
}

function buildRejectedReviewTargetMessage(targets: CopilotEditableReviewTarget[]): string {
  const label = getEditableTargetLabel(targets[0])
  return `The request to open the editable ${label} target was rejected, so it is not open for editing. Do not try to edit that target. Ask the user for another target or continue without editing it.`
}

function createCopilotNoticeMessage(content: string) {
  return {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text' as const,
        content,
        timestamp: Date.now(),
      },
    ],
  }
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
  const setPairColorContext = useSetPairColorContext()
  const copilotStoreApi = useCopilotStoreApi()
  const workflowId = resolveCopilotWorkflowId(pairContext) ?? null
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
  const lastRejectedResolutionKeyRef = useRef<string | null>(null)
  const pairContextRef = useRef(pairContext)
  // Copilot history is workspace-scoped, while runtime edits still follow the
  // active widget channel through pair/panel context.
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
    pairContextRef.current = pairContext
  }, [pairContext])

  useEffect(() => {
    if (!entityTargetResolution.unresolvedKey) {
      setResolvedEntityTargets(null)
      lastRejectedResolutionKeyRef.current = null
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
          lastRejectedResolutionKeyRef.current = null
          setResolvedEntityTargets({
            key: entityTargetResolution.unresolvedKey!,
            descriptors: resolvedTargets.map((resolved) => resolved.descriptor),
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          const rejectedKey = entityTargetResolution.unresolvedKey!
          setResolvedEntityTargets({
            key: rejectedKey,
            descriptors: [],
          })

          if (lastRejectedResolutionKeyRef.current !== rejectedKey) {
            lastRejectedResolutionKeyRef.current = rejectedKey
            setPairColorContext(pairColor, {
              ...(pairContextRef.current ?? {}),
              reviewTarget: null,
            })

            const noticeContent = buildRejectedReviewTargetMessage(
              entityTargetResolution.unresolved
            )
            const store = copilotStoreApi.getState()
            const lastMessage = store.messages[store.messages.length - 1]

            if (lastMessage?.role !== 'assistant' || lastMessage.content !== noticeContent) {
              const noticeMessage = createCopilotNoticeMessage(noticeContent)
              const nextMessages = [...store.messages, noticeMessage]
              const currentChat = store.currentChat
                ? {
                    ...store.currentChat,
                    messages: nextMessages,
                    messageCount: nextMessages.length,
                  }
                : store.currentChat

              copilotStoreApi.setState({
                messages: nextMessages,
                ...(currentChat ? { currentChat } : {}),
                ...(currentChat
                  ? {
                      chats: store.chats.map((chat) =>
                        chat.reviewSessionId === currentChat.reviewSessionId
                          ? {
                              ...chat,
                              messages: nextMessages,
                              messageCount: nextMessages.length,
                            }
                          : chat
                      ),
                    }
                  : {}),
              })

              if (currentChat?.reviewSessionId) {
                void store.saveChatMessages(currentChat.reviewSessionId)
              }
            }
          }
        }
      })

    return () => {
      cancelled = true
    }
  }, [copilotStoreApi, entityTargetResolution, pairColor, setPairColorContext])

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
  const isWaitingForEntitySessions = entityDescriptors.length > 0 && !allEntitySessionsRegistered

  const copilotBody = (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        pairColor={pairColor}
        inputDisabled={isResolvingReviewTarget || isWaitingForEntitySessions}
      />
    </div>
  )

  const copilotContent = workflowId ? (
    <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
      {copilotBody}
    </WorkflowSessionProvider>
  ) : (
    copilotBody
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
