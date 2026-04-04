'use client'

import type { ReactNode } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSession } from '@/lib/auth-client'
import type {
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import {
  EntitySessionHost,
} from '@/lib/copilot/review-sessions/entity-session-host'
import { useCopilotStoreApi } from '@/stores/copilot/store'
import {
  usePairColorContext,
  useSetPairColorContext,
  type PairColorContext,
} from '@/stores/dashboard/pair-store'
import { useWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { useResolvedReviewTarget } from '@/widgets/widgets/entity_review/use-resolved-review-target'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Selection state read from widget params or pair context. */
export interface EntitySelectionState {
  legacyEntityId: string | null
  reviewSessionId: string | null
  reviewEntityId: string | null
  reviewDraftSessionId: string | null
  reviewModel: string | null
  descriptor: ReviewTargetDescriptor | null
}

/**
 * Entity-specific configuration that each editor widget supplies.
 *
 * This captures exactly the parts that differ between indicator, MCP,
 * skill, and custom-tool editors.
 */
export interface EntityEditorShellConfig {
  /** The entity kind passed to useResolvedReviewTarget. */
  entityKind: Exclude<ReviewEntityKind, 'workflow'>

  /** Widget key used as fallback for useWidgetChannel. */
  fallbackWidgetKey: string

  /** Key on PairColorContext that stores the legacy entity id. */
  legacyIdKey: keyof PairColorContext & string

  /** Build widget params to persist the review target. */
  buildWidgetParams: (options: {
    currentParams?: Record<string, unknown> | null
    legacyIdKey: string
    descriptor: ReviewTargetDescriptor | null
    legacyEntityId?: string | null
  }) => Record<string, unknown> | null

  /** Build pair context to persist the review target. */
  buildPairContext: (options: {
    existing?: PairColorContext | null
    legacyIdKey: keyof PairColorContext
    descriptor: ReviewTargetDescriptor | null
    legacyEntityId?: string | null
  }) => PairColorContext

  /** Read the entity selection from params/pairContext. */
  readEntitySelectionState: (options: {
    params?: Record<string, unknown> | null
    pairContext?: PairColorContext | null
    legacyIdKey: string
  }) => EntitySelectionState

  /** Message shown when no workspace is available. */
  noWorkspaceMessage: string

  /** Message shown when nothing is selected. */
  noSelectionMessage: string
}

/** Props passed to the shell's children render function. */
export interface EntityEditorShellChildProps {
  workspaceId: string
  descriptor: ReviewTargetDescriptor
  persistDescriptor: (descriptor: ReviewTargetDescriptor | null) => void
  panelId?: string
  widget?: WidgetComponentProps['widget']
}

/**
 * Hook that the consumer can use to wire up selection-change persistence
 * before the shell renders. The hook receives the resolved pair color,
 * isLinkedToColorPair flag, pairContext, setPairContext, and the widget props
 * so it can call the appropriate selection persistence hook.
 */
export interface EntityEditorShellSelectionPersistenceArgs {
  resolvedPairColor: PairColor
  isLinkedToColorPair: boolean
  pairContext: PairColorContext | undefined
  setPairContext: (color: PairColor, context: PairColorContext) => void
  channelId: string | undefined
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
}

interface EntityEditorShellProps extends WidgetComponentProps {
  config: EntityEditorShellConfig
  /** Optional hook to call before rendering, for selection persistence. */
  useSelectionPersistence?: (args: EntityEditorShellSelectionPersistenceArgs) => void
  /** Render function receiving the resolved session props. */
  children: (props: EntityEditorShellChildProps) => ReactNode
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared shell for all entity editor widgets.
 *
 * Encapsulates the common boilerplate:
 *  - user session extraction
 *  - widget channel and pair-color context
 *  - copilot store
 *  - entity selection state reading
 *  - review target resolution
 *  - guard rendering (no workspace, no selection, resolving, error)
 *  - EntitySessionHost wrapping
 */
export function EntityEditorShell({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
  config,
  useSelectionPersistence,
  children,
}: EntityEditorShellProps) {
  const workspaceId = context?.workspaceId ?? null
  const session = useSession()
  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  const { resolvedPairColor, channelId, isLinkedToColorPair } = useWidgetChannel({
    context,
    pairColor,
    panelId,
    widget,
    fallbackWidgetKey: config.fallbackWidgetKey,
  })
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const copilotStoreApi = useCopilotStoreApi(channelId)

  // Let the consumer wire up selection persistence before we read state.
  useSelectionPersistence?.({
    resolvedPairColor,
    isLinkedToColorPair,
    pairContext,
    setPairContext,
    channelId,
    onWidgetParamsChange,
    panelId,
    params,
  })

  const selectionState = config.readEntitySelectionState({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
    legacyIdKey: config.legacyIdKey,
  })
  const hasSelection =
    !!selectionState.legacyEntityId ||
    !!selectionState.reviewSessionId ||
    !!selectionState.reviewDraftSessionId
  const { descriptor, isResolving, error, persistDescriptor } = useResolvedReviewTarget({
    workspaceId,
    entityKind: config.entityKind,
    params,
    pairColor: resolvedPairColor,
    pairContext: isLinkedToColorPair ? pairContext : null,
    onWidgetParamsChange,
    setPairContext,
    legacyIdKey: config.legacyIdKey,
    selectionState,
    buildWidgetParams: config.buildWidgetParams,
    buildPairContext: config.buildPairContext,
    selectedModel: copilotStoreApi.getState().selectedModel,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={config.noWorkspaceMessage} />
  }

  if (!hasSelection) {
    return <WidgetStateMessage message={config.noSelectionMessage} />
  }

  if (isResolving || !descriptor) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error) {
    return <WidgetStateMessage message={error} />
  }

  return (
    <EntitySessionHost descriptor={descriptor} user={user}>
      {children({
        workspaceId,
        descriptor,
        persistDescriptor,
        panelId,
        widget,
      })}
    </EntitySessionHost>
  )
}
