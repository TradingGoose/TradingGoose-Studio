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
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import {
  buildCopilotEditableReviewTargetRequest,
  buildCopilotLiveReviewTarget,
  type CopilotEditableReviewTargetRequest,
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

function getEditableTargetLabel(target?: CopilotEditableReviewTargetRequest): string {
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

function buildRejectedReviewTargetMessage(target?: CopilotEditableReviewTargetRequest): string {
  const label = getEditableTargetLabel(target)
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
  const copilotStoreApi = useCopilotStoreApi()
  const workflowId = resolveCopilotWorkflowId(pairContext) ?? null
  const editableReviewTargetRequest = useMemo(
    () => buildCopilotEditableReviewTargetRequest({ pairContext }),
    [pairContext]
  )
  const [resolvedEntityTarget, setResolvedEntityTarget] = useState<{
    key: string
    descriptor: ReviewTargetDescriptor | null
  } | null>(null)
  const lastRejectedResolutionKeyRef = useRef<string | null>(null)
  // Copilot history is workspace-scoped, while runtime edits still follow the
  // active widget channel through pair/panel context.
  const entityTargetResolution = useMemo(() => {
    const descriptor = editableReviewTargetRequest
      ? buildReviewTargetDescriptorFromState({
          workspaceId,
          entityKind: editableReviewTargetRequest.entityKind,
          entityId: editableReviewTargetRequest.entityId,
          draftSessionId: editableReviewTargetRequest.draftSessionId,
          reviewSessionId: editableReviewTargetRequest.reviewSessionId,
        })
      : null
    const unresolved =
      editableReviewTargetRequest &&
      !descriptor &&
      (editableReviewTargetRequest.entityId ||
        editableReviewTargetRequest.draftSessionId ||
        editableReviewTargetRequest.reviewSessionId)
        ? editableReviewTargetRequest
        : null

    return {
      descriptor,
      unresolved,
      unresolvedKey:
        workspaceId && unresolved
          ? JSON.stringify({
              workspaceId,
              target: {
                entityKind: unresolved.entityKind,
                entityId: unresolved.entityId,
                draftSessionId: unresolved.draftSessionId,
                reviewSessionId: unresolved.reviewSessionId,
              },
            })
          : null,
    }
  }, [editableReviewTargetRequest, workspaceId])

  useEffect(() => {
    if (!entityTargetResolution.unresolvedKey || !entityTargetResolution.unresolved) {
      setResolvedEntityTarget(null)
      lastRejectedResolutionKeyRef.current = null
      return
    }

    let cancelled = false
    const unresolvedKey = entityTargetResolution.unresolvedKey
    const unresolved = entityTargetResolution.unresolved

    resolveEntityReviewTarget({
      workspaceId,
      entityKind: unresolved.entityKind,
      entityId: unresolved.entityId ?? undefined,
      draftSessionId: unresolved.draftSessionId ?? undefined,
      reviewSessionId: unresolved.reviewSessionId ?? undefined,
    })
      .then((resolvedTarget) => {
        if (!cancelled) {
          lastRejectedResolutionKeyRef.current = null
          setResolvedEntityTarget({
            key: unresolvedKey,
            descriptor: resolvedTarget.descriptor,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          const rejectedKey = unresolvedKey
          setResolvedEntityTarget({
            key: rejectedKey,
            descriptor: null,
          })

          if (lastRejectedResolutionKeyRef.current !== rejectedKey) {
            lastRejectedResolutionKeyRef.current = rejectedKey
            const noticeContent = buildRejectedReviewTargetMessage(unresolved)
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
  }, [copilotStoreApi, entityTargetResolution])

  const entityDescriptor = useMemo(
    () =>
      entityTargetResolution.descriptor ??
      (resolvedEntityTarget?.key === entityTargetResolution.unresolvedKey
        ? resolvedEntityTarget.descriptor
        : null),
    [entityTargetResolution.descriptor, entityTargetResolution.unresolvedKey, resolvedEntityTarget]
  )
  const entitySession = useRegisteredEntitySession(entityDescriptor?.reviewSessionId)
  const entitySessionRegistered = Boolean(
    entityDescriptor?.reviewSessionId &&
      entitySession?.descriptor.reviewSessionId === entityDescriptor.reviewSessionId
  )
  const isResolvingReviewTarget = Boolean(
    entityTargetResolution.unresolvedKey &&
      resolvedEntityTarget?.key !== entityTargetResolution.unresolvedKey
  )
  const isWaitingForEntitySession = Boolean(entityDescriptor && !entitySessionRegistered)
  const liveReviewTarget = entitySessionRegistered
    ? buildCopilotLiveReviewTarget(entityDescriptor)
    : null

  const copilotBody = (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        pairColor={pairColor}
        inputDisabled={isResolvingReviewTarget || isWaitingForEntitySession}
        reviewTarget={liveReviewTarget}
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

  return entityDescriptor ? (
    <EntitySessionHost
      key={entityDescriptor.reviewSessionId ?? entityDescriptor.yjsSessionId}
      descriptor={entityDescriptor}
      user={user}
    >
      {copilotContent}
    </EntitySessionHost>
  ) : (
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
