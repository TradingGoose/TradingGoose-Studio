'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import { useLatestRef } from '@/hooks/use-latest-ref'
import {
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
} from '@/i18n/workflow-inspector-core'
import { useWorkflowInspectorMessages } from '@/i18n/workspace-widget-hooks'
import { getSubflowBlockConfig } from '@/widgets/widgets/editor_workflow/components/subflows/config'
import {
  COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS,
  isCopilotWorkspaceEntityMentionOption,
} from '../../../workspace-entities'
import type {
  BlockItem,
  LogItem,
  MentionSources,
  MentionSubmenu,
  PastChatItem,
  WorkflowBlockItem,
  WorkspaceEntityItem,
} from '../types'
import {
  type LazyWorkspaceEntityMentionKind,
  loadWorkspaceEntityMentionItems,
} from '../workspace-entity-mentions'

const logger = createLogger('CopilotUserInputMentionSources')

interface UseUserInputMentionSourcesOptions {
  workspaceId: string
  ownerUserId?: string | null
}

const LAZY_WORKSPACE_ENTITY_MENTION_OPTIONS = COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS.filter(
  (entityKind): entityKind is LazyWorkspaceEntityMentionKind => entityKind !== 'dashboard_layout'
)

type WorkspaceEntityMentionLoadState = Partial<
  Record<LazyWorkspaceEntityMentionKind, WorkspaceEntityItem[] | 'loading'>
>

type WorkflowBlockMentionLoadState = {
  workflowId: string | null
  items: WorkflowBlockItem[]
  isLoading: boolean
}

const EMPTY_PAST_CHATS: PastChatItem[] = []
const EMPTY_LOGS: LogItem[] = []
const EMPTY_BLOCK_CATALOG: BlockItem[] = []
const EMPTY_WORKSPACE_ENTITY_STATE: WorkspaceEntityMentionLoadState = {}

const toTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function useUserInputMentionSources({
  workspaceId,
  ownerUserId,
}: UseUserInputMentionSourcesOptions) {
  const locale = useLocale()
  const normalizedOwnerUserId = ownerUserId ?? null
  const workspaceLifecycle = useMemo(() => ({ active: true }), [workspaceId, normalizedOwnerUserId])
  const workspaceScopeRef = useRef({
    workspaceId,
    ownerUserId: normalizedOwnerUserId,
  })
  const [loadedPastChats, setLoadedPastChats] = useState<PastChatItem[]>([])
  const [pastChatsLoading, setPastChatsLoading] = useState(false)
  const [workspaceEntityState, setWorkspaceEntityState] = useState<WorkspaceEntityMentionLoadState>(
    {}
  )
  const blockCatalogLocaleRef = useRef(locale)
  const [loadedBlocksList, setLoadedBlocksList] = useState<BlockItem[]>([])
  const [blockCatalogLoading, setBlockCatalogLoading] = useState(false)
  const blockCatalogLoadGenerationRef = useRef(0)
  const [loadedLogsList, setLoadedLogsList] = useState<LogItem[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [workflowBlockState, setWorkflowBlockState] = useState<WorkflowBlockMentionLoadState>({
    workflowId: null,
    items: [],
    isLoading: false,
  })
  const workflowBlockLoadGenerationRef = useRef(0)
  const workflowSession = useOptionalWorkflowSession()
  const workflowId = workflowSession?.workflowId ?? null
  const workflowStoreBlocks = useWorkflowBlocks()
  const workspaceScopeIsCurrent =
    workspaceScopeRef.current.workspaceId === workspaceId &&
    workspaceScopeRef.current.ownerUserId === normalizedOwnerUserId
  const pastChats = workspaceScopeIsCurrent ? loadedPastChats : EMPTY_PAST_CHATS
  const isLoadingPastChats = workspaceScopeIsCurrent && pastChatsLoading
  const scopedWorkspaceEntityState = workspaceScopeIsCurrent
    ? workspaceEntityState
    : EMPTY_WORKSPACE_ENTITY_STATE
  const logsList = workspaceScopeIsCurrent ? loadedLogsList : EMPTY_LOGS
  const isLoadingLogs = workspaceScopeIsCurrent && logsLoading
  const blockCatalogLocaleIsCurrent = blockCatalogLocaleRef.current === locale
  const blocksList = blockCatalogLocaleIsCurrent ? loadedBlocksList : EMPTY_BLOCK_CATALOG
  const isLoadingBlocks = blockCatalogLocaleIsCurrent && blockCatalogLoading
  const workflowBlocks =
    workflowBlockState.workflowId === workflowId ? workflowBlockState.items : []
  const isLoadingWorkflowBlocks =
    workflowBlockState.workflowId === workflowId && workflowBlockState.isLoading
  const { members: dashboardLayoutMembers, isLoading: isLoadingDashboardLayouts } = useEntityList(
    'dashboard_layout',
    workspaceId,
    normalizedOwnerUserId
  )
  const dashboardLayoutMentions = useMemo(
    () =>
      normalizedOwnerUserId
        ? dashboardLayoutMembers.flatMap((member) => {
            const name = toTrimmedString(member.entityName)
            return member.entityId && name
              ? [
                  {
                    entityKind: 'dashboard_layout' as const,
                    id: member.entityId,
                    name,
                    ownerUserId: normalizedOwnerUserId,
                  },
                ]
              : []
          })
        : [],
    [dashboardLayoutMembers, normalizedOwnerUserId]
  )
  const workflowInspectorMessages = useWorkflowInspectorMessages()
  const workflowInspectorCopy = useMemo(() => workflowInspectorMessages, [locale])
  const compareLocalizedBlockMentionNames = useCallback(
    <T extends { name: string }>(left: T, right: T) => left.name.localeCompare(right.name, locale),
    [locale]
  )

  const ensurePastChatsLoaded = useCallback(async () => {
    if (!workspaceLifecycle.active || isLoadingPastChats || pastChats.length > 0) {
      return
    }

    const targetWorkspaceId = workspaceId
    const targetLifecycle = workspaceLifecycle
    try {
      setPastChatsLoading(true)
      const response = await fetch(
        `/api/copilot/chat?workspaceId=${encodeURIComponent(targetWorkspaceId)}`
      )

      if (!response.ok) {
        throw new Error(`Failed to load chats: ${response.status}`)
      }

      const data = await response.json()
      const items = Array.isArray(data?.chats) ? data.chats : []

      const mapped = items.flatMap((item: any) => {
        const title = toTrimmedString(item.title)
        return item.reviewSessionId
          ? [
              {
                reviewSessionId: item.reviewSessionId,
                title: title || null,
              },
            ]
          : []
      })
      if (!targetLifecycle.active) return
      setLoadedPastChats(mapped)
    } catch {
    } finally {
      if (targetLifecycle.active) setPastChatsLoading(false)
    }
  }, [isLoadingPastChats, pastChats.length, workspaceId, workspaceLifecycle])

  const ensureWorkspaceEntityLoaded = useCallback(
    async (entityKind: LazyWorkspaceEntityMentionKind) => {
      const state = scopedWorkspaceEntityState[entityKind]
      if (!workspaceLifecycle.active || state === 'loading' || (state?.length ?? 0) > 0) return

      try {
        setWorkspaceEntityState((prev) => ({ ...prev, [entityKind]: 'loading' }))
        const mapped = await loadWorkspaceEntityMentionItems(entityKind, workspaceId)
        if (!workspaceLifecycle.active) return
        setWorkspaceEntityState((prev) => ({ ...prev, [entityKind]: mapped }))
      } catch (error) {
        if (!workspaceLifecycle.active) return
        logger.error(`Failed to load ${entityKind} mention sources`, error)
        setWorkspaceEntityState((prev) => ({ ...prev, [entityKind]: undefined }))
      }
    },
    [scopedWorkspaceEntityState, workspaceId, workspaceLifecycle]
  )

  const ensureBlocksLoaded = useCallback(async () => {
    if (isLoadingBlocks || blocksList.length > 0) {
      return
    }

    const targetLocale = locale
    const generation = ++blockCatalogLoadGenerationRef.current
    try {
      setBlockCatalogLoading(true)
      const { getAllBlocks } = await import('@/blocks')
      const allBlocks = getAllBlocks()
      const mapped = (['blocks', 'tools'] as const).flatMap((category) =>
        allBlocks
          .filter((block: any) => !block.hideFromToolbar && block.category === category)
          .map((block: any) => ({
            id: block.type,
            name: getLocalizedBlockNameWithCopy(workflowInspectorCopy, block),
            iconComponent: block.icon,
            bgColor: sanitizeSolidIconColor(block.bgColor),
          }))
          .sort(compareLocalizedBlockMentionNames)
      )
      if (
        targetLocale !== blockCatalogLocaleRef.current ||
        generation !== blockCatalogLoadGenerationRef.current
      )
        return
      setLoadedBlocksList(mapped)
    } catch {
      if (
        targetLocale !== blockCatalogLocaleRef.current ||
        generation !== blockCatalogLoadGenerationRef.current
      )
        return
      setLoadedBlocksList([])
    } finally {
      if (
        targetLocale === blockCatalogLocaleRef.current &&
        generation === blockCatalogLoadGenerationRef.current
      )
        setBlockCatalogLoading(false)
    }
  }, [
    blocksList.length,
    compareLocalizedBlockMentionNames,
    isLoadingBlocks,
    locale,
    workflowInspectorCopy,
  ])

  const ensureLogsLoaded = useCallback(async () => {
    if (!workspaceLifecycle.active || isLoadingLogs || logsList.length > 0) {
      return
    }

    const targetWorkspaceId = workspaceId
    const targetLifecycle = workspaceLifecycle
    try {
      setLogsLoading(true)
      const response = await fetch(
        `/api/logs?workspaceId=${encodeURIComponent(targetWorkspaceId)}&limit=50`
      )

      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.status}`)
      }

      const data = await response.json()
      const items = Array.isArray(data?.data) ? data.data : []
      const mapped = items.flatMap((item: any) => {
        const entityName = item.workflow && (item.workflow.name || item.workflow.title)
        return entityName
          ? [
              {
                id: item.id,
                level: item.level,
                trigger: item.trigger || null,
                startedAt: item.startedAt,
                entityName,
              },
            ]
          : []
      })
      if (!targetLifecycle.active) return
      setLoadedLogsList(mapped)
    } catch {
    } finally {
      if (targetLifecycle.active) setLogsLoading(false)
    }
  }, [isLoadingLogs, logsList.length, workspaceId, workspaceLifecycle])

  const ensureWorkflowBlocksLoaded = useCallback(async () => {
    const targetWorkflowId = workflowId
    const generation = ++workflowBlockLoadGenerationRef.current

    if (!targetWorkflowId || Object.keys(workflowStoreBlocks).length === 0) {
      setWorkflowBlockState({ workflowId: targetWorkflowId, items: [], isLoading: false })
      return
    }

    setWorkflowBlockState((current) => ({
      workflowId: targetWorkflowId,
      items: current.workflowId === targetWorkflowId ? current.items : [],
      isLoading: true,
    }))

    try {
      const { registry: blockRegistry } = await import('@/blocks/registry')
      const mapped = Object.values(workflowStoreBlocks).map((block: any) => {
        const registryEntry = (blockRegistry as any)[block.type]
        const subflowConfig = getSubflowBlockConfig(block.type)
        const presentation = registryEntry ?? subflowConfig

        return {
          id: block.id,
          name: getLocalizedDefaultBlockNameWithCopy(
            workflowInspectorCopy,
            block.type,
            block.name || presentation?.name
          ),
          type: block.type,
          iconComponent: presentation?.icon,
          bgColor: sanitizeSolidIconColor(presentation?.bgColor) || '#6B7280',
        }
      })

      if (generation !== workflowBlockLoadGenerationRef.current) return
      setWorkflowBlockState({ workflowId: targetWorkflowId, items: mapped, isLoading: false })
    } catch (error) {
      if (generation !== workflowBlockLoadGenerationRef.current) return
      logger.error('Failed to sync workflow blocks:', error)
      setWorkflowBlockState({ workflowId: targetWorkflowId, items: [], isLoading: false })
    }
  }, [workflowId, workflowInspectorCopy, workflowStoreBlocks])

  const ensureSubmenuLoadedRef = useLatestRef(async (submenu: MentionSubmenu) => {
    if (submenu === 'chats') return ensurePastChatsLoaded()

    if (submenu === 'dashboard_layout') return

    if (isCopilotWorkspaceEntityMentionOption(submenu)) return ensureWorkspaceEntityLoaded(submenu)
    if (submenu === 'blocks') return ensureBlocksLoaded()
    if (submenu === 'workflow_blocks') return ensureWorkflowBlocksLoaded()
    return ensureLogsLoaded()
  })
  const ensureSubmenuLoaded = useCallback(
    (submenu: MentionSubmenu) => ensureSubmenuLoadedRef.current(submenu),
    [ensureSubmenuLoadedRef, workspaceLifecycle]
  )

  useLayoutEffect(() => {
    blockCatalogLocaleRef.current = locale
    setLoadedBlocksList([])
    setBlockCatalogLoading(false)
    return () => {
      blockCatalogLoadGenerationRef.current += 1
    }
  }, [locale])

  useEffect(() => {
    void ensureWorkflowBlocksLoaded()
    return () => {
      workflowBlockLoadGenerationRef.current += 1
    }
  }, [ensureWorkflowBlocksLoaded])

  useEffect(() => {
    if (workflowId && scopedWorkspaceEntityState.workflow === undefined) {
      void ensureWorkspaceEntityLoaded('workflow')
    }
  }, [ensureWorkspaceEntityLoaded, scopedWorkspaceEntityState.workflow, workflowId])

  useLayoutEffect(() => {
    workspaceLifecycle.active = true
    workspaceScopeRef.current = {
      workspaceId,
      ownerUserId: normalizedOwnerUserId,
    }
    setLoadedPastChats([])
    setPastChatsLoading(false)
    setWorkspaceEntityState({})
    setLoadedLogsList([])
    setLogsLoading(false)

    return () => {
      workspaceLifecycle.active = false
    }
  }, [normalizedOwnerUserId, workspaceId, workspaceLifecycle])

  const workspaceEntities = {} as Record<LazyWorkspaceEntityMentionKind, WorkspaceEntityItem[]>
  const workspaceEntityLoading = {} as Record<LazyWorkspaceEntityMentionKind, boolean>
  for (const entityKind of LAZY_WORKSPACE_ENTITY_MENTION_OPTIONS) {
    const state = scopedWorkspaceEntityState[entityKind]
    workspaceEntities[entityKind] = Array.isArray(state) ? state : []
    workspaceEntityLoading[entityKind] = state === 'loading'
  }

  const mentionSources: MentionSources = {
    pastChats,
    workspaceEntities: {
      ...workspaceEntities,
      dashboard_layout: dashboardLayoutMentions,
    },
    blocksList,
    logsList,
    workflowBlocks,
  }

  const mentionLoading: Record<MentionSubmenu, boolean> = {
    chats: isLoadingPastChats,
    ...workspaceEntityLoading,
    dashboard_layout: isLoadingDashboardLayouts,
    workflow_blocks: isLoadingWorkflowBlocks,
    blocks: isLoadingBlocks,
    logs: isLoadingLogs,
  }

  return {
    ensureSubmenuLoaded,
    mentionLoading,
    mentionSources,
  }
}
