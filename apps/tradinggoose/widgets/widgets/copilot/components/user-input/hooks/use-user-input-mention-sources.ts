'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import { fetchKnowledgeBases as fetchWorkspaceKnowledgeBases } from '@/hooks/queries/knowledge'
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
  KnowledgeBaseItem,
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

const toTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function useUserInputMentionSources({
  workspaceId,
  ownerUserId,
}: UseUserInputMentionSourcesOptions) {
  const locale = useLocale()
  const normalizedOwnerUserId = ownerUserId ?? null
  const workspaceLifecycle = useMemo(() => ({ active: true }), [workspaceId])
  const [pastChats, setPastChats] = useState<PastChatItem[]>([])
  const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)
  const [workspaceEntityState, setWorkspaceEntityState] = useState<WorkspaceEntityMentionLoadState>(
    {}
  )
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([])
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false)
  const [blocksList, setBlocksList] = useState<BlockItem[]>([])
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false)
  const [logsList, setLogsList] = useState<LogItem[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [workflowBlocks, setWorkflowBlocks] = useState<WorkflowBlockItem[]>([])
  const [isLoadingWorkflowBlocks, setIsLoadingWorkflowBlocks] = useState(false)
  const workflowSession = useOptionalWorkflowSession()
  const workflowId = workflowSession?.workflowId ?? null
  const workflowStoreBlocks = useWorkflowBlocks()
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
    if (isLoadingPastChats || pastChats.length > 0) {
      return
    }

    try {
      setIsLoadingPastChats(true)
      const response = await fetch(
        `/api/copilot/chat?workspaceId=${encodeURIComponent(workspaceId)}`
      )

      if (!response.ok) {
        throw new Error(`Failed to load chats: ${response.status}`)
      }

      const data = await response.json()
      const items = Array.isArray(data?.chats) ? data.chats : []

      setPastChats(
        items.flatMap((item: any) => {
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
      )
    } catch {
    } finally {
      setIsLoadingPastChats(false)
    }
  }, [isLoadingPastChats, pastChats.length, workspaceId])

  const ensureWorkspaceEntityLoaded = useCallback(
    async (entityKind: LazyWorkspaceEntityMentionKind) => {
      if (workspaceEntityState[entityKind] !== undefined || !workspaceLifecycle.active) return

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
    [workspaceEntityState, workspaceId, workspaceLifecycle]
  )

  const ensureKnowledgeLoaded = useCallback(async () => {
    if (isLoadingKnowledge || knowledgeBases.length > 0) {
      return
    }

    try {
      setIsLoadingKnowledge(true)
      const items = await fetchWorkspaceKnowledgeBases(workspaceId)
      const sorted = [...items].sort((a: any, b: any) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return timeB - timeA
      })

      setKnowledgeBases(
        sorted.flatMap((item: any) => {
          const name = toTrimmedString(item.name)
          return item.id && name ? [{ id: item.id, name }] : []
        })
      )
    } catch {
    } finally {
      setIsLoadingKnowledge(false)
    }
  }, [isLoadingKnowledge, knowledgeBases.length, workspaceId])

  const ensureBlocksLoaded = useCallback(async () => {
    if (isLoadingBlocks || blocksList.length > 0) {
      return
    }

    try {
      setIsLoadingBlocks(true)
      const { getAllBlocks } = await import('@/blocks')
      const allBlocks = getAllBlocks()
      setBlocksList(
        (['blocks', 'tools'] as const).flatMap((category) =>
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
      )
    } catch {
    } finally {
      setIsLoadingBlocks(false)
    }
  }, [blocksList.length, compareLocalizedBlockMentionNames, isLoadingBlocks, workflowInspectorCopy])

  const ensureLogsLoaded = useCallback(async () => {
    if (isLoadingLogs || logsList.length > 0) {
      return
    }

    try {
      setIsLoadingLogs(true)
      const response = await fetch(`/api/logs?workspaceId=${workspaceId}&limit=50&details=full`)

      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.status}`)
      }

      const data = await response.json()
      const items = Array.isArray(data?.data) ? data.data : []

      setLogsList(
        items.flatMap((item: any) => {
          const entityName = item.workflow && (item.workflow.name || item.workflow.title)
          return entityName
            ? [
                {
                  id: item.id,
                  executionId: item.executionId || item.id,
                  level: item.level,
                  trigger: item.trigger || null,
                  startedAt: item.startedAt,
                  entityName,
                },
              ]
            : []
        })
      )
    } catch {
    } finally {
      setIsLoadingLogs(false)
    }
  }, [isLoadingLogs, logsList.length, workspaceId])

  const ensureWorkflowBlocksLoaded = useCallback(async () => {
    if (!workflowId || Object.keys(workflowStoreBlocks).length === 0) {
      setWorkflowBlocks([])
      return
    }

    try {
      setIsLoadingWorkflowBlocks(true)
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

      setWorkflowBlocks(mapped)
    } catch (error) {
      logger.error('Failed to sync workflow blocks:', error)
    } finally {
      setIsLoadingWorkflowBlocks(false)
    }
  }, [workflowId, workflowInspectorCopy, workflowStoreBlocks])

  const ensureSubmenuLoaded = useCallback(
    async (submenu: MentionSubmenu) => {
      if (submenu === 'chats') return ensurePastChatsLoaded()

      if (submenu === 'dashboard_layout') return

      if (isCopilotWorkspaceEntityMentionOption(submenu))
        return ensureWorkspaceEntityLoaded(submenu)
      if (submenu === 'knowledge') return ensureKnowledgeLoaded()
      if (submenu === 'blocks') return ensureBlocksLoaded()
      if (submenu === 'workflow_blocks') return ensureWorkflowBlocksLoaded()
      return ensureLogsLoaded()
    },
    [
      ensureBlocksLoaded,
      ensureKnowledgeLoaded,
      ensureLogsLoaded,
      ensurePastChatsLoaded,
      ensureWorkflowBlocksLoaded,
      ensureWorkspaceEntityLoaded,
    ]
  )

  useEffect(() => {
    setWorkflowBlocks([])
    setIsLoadingWorkflowBlocks(false)
  }, [workflowId])

  useEffect(() => {
    setBlocksList([])
    setIsLoadingBlocks(false)
  }, [locale])

  useEffect(() => {
    void ensureWorkflowBlocksLoaded()
  }, [ensureWorkflowBlocksLoaded])

  useEffect(() => {
    if (workflowId && workspaceEntityState.workflow === undefined) {
      void ensureWorkspaceEntityLoaded('workflow')
    }
  }, [ensureWorkspaceEntityLoaded, workflowId, workspaceEntityState.workflow])

  useLayoutEffect(() => {
    workspaceLifecycle.active = true
    setPastChats([])
    setIsLoadingPastChats(false)
    setWorkspaceEntityState({})
    setKnowledgeBases([])
    setIsLoadingKnowledge(false)
    setLogsList([])
    setIsLoadingLogs(false)

    return () => {
      workspaceLifecycle.active = false
    }
  }, [workspaceLifecycle])

  const workspaceEntities = {} as Record<LazyWorkspaceEntityMentionKind, WorkspaceEntityItem[]>
  const workspaceEntityLoading = {} as Record<LazyWorkspaceEntityMentionKind, boolean>
  for (const entityKind of LAZY_WORKSPACE_ENTITY_MENTION_OPTIONS) {
    const state = workspaceEntityState[entityKind]
    workspaceEntities[entityKind] = Array.isArray(state) ? state : []
    workspaceEntityLoading[entityKind] = state === 'loading'
  }

  const mentionSources: MentionSources = {
    pastChats,
    workspaceEntities: {
      ...workspaceEntities,
      dashboard_layout: dashboardLayoutMentions,
    },
    knowledgeBases,
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
    knowledge: isLoadingKnowledge,
    logs: isLoadingLogs,
  }

  return {
    ensureSubmenuLoaded,
    mentionLoading,
    mentionSources,
  }
}
