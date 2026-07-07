'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
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
  type CopilotWorkspaceEntityKind,
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
import { loadWorkspaceEntityMentionItems } from '../workspace-entity-mentions'

const logger = createLogger('CopilotUserInputMentionSources')

interface UseUserInputMentionSourcesOptions {
  workspaceId: string
  ownerUserId?: string | null
}

const createEmptyWorkspaceEntities = (): Record<
  CopilotWorkspaceEntityKind,
  WorkspaceEntityItem[]
> => ({
  workflow: [],
  skill: [],
  indicator: [],
  custom_tool: [],
  mcp_server: [],
  watchlist: [],
  dashboard_layout: [],
})

const createEmptyWorkspaceEntityLoading = (): Record<CopilotWorkspaceEntityKind, boolean> => ({
  workflow: false,
  skill: false,
  indicator: false,
  custom_tool: false,
  mcp_server: false,
  watchlist: false,
  dashboard_layout: false,
})

const toTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function useUserInputMentionSources({
  workspaceId,
  ownerUserId,
}: UseUserInputMentionSourcesOptions) {
  const locale = useLocale()
  const [pastChats, setPastChats] = useState<PastChatItem[]>([])
  const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)
  const [workspaceEntities, setWorkspaceEntities] = useState(createEmptyWorkspaceEntities)
  const [workspaceEntityLoading, setWorkspaceEntityLoading] = useState(
    createEmptyWorkspaceEntityLoading
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
      const params = new URLSearchParams()

      if (workspaceId) {
        params.set('workspaceId', workspaceId)
      }

      const query = params.toString()
      const response = await fetch(query ? `/api/copilot/chat?${query}` : '/api/copilot/chat')

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
                  workflowId: null,
                  updatedAt: item.updatedAt,
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
    async (entityKind: CopilotWorkspaceEntityKind) => {
      if (workspaceEntityLoading[entityKind] || workspaceEntities[entityKind].length > 0) {
        return
      }

      try {
        setWorkspaceEntityLoading((prev) => ({ ...prev, [entityKind]: true }))
        const mapped = await loadWorkspaceEntityMentionItems(entityKind, workspaceId, ownerUserId)
        setWorkspaceEntities((prev) => ({ ...prev, [entityKind]: mapped }))
      } catch (error) {
        logger.error(`Failed to load ${entityKind} mention sources`, error)
      } finally {
        setWorkspaceEntityLoading((prev) => ({ ...prev, [entityKind]: false }))
      }
    },
    [ownerUserId, workspaceEntities, workspaceEntityLoading, workspaceId]
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
      const regularBlocks = allBlocks
        .filter((block: any) => !block.hideFromToolbar && block.category === 'blocks')
        .map((block: any) => ({
          id: block.type,
          name: getLocalizedBlockNameWithCopy(workflowInspectorCopy, block),
          iconComponent: block.icon,
          bgColor: sanitizeSolidIconColor(block.bgColor),
        }))
        .sort(compareLocalizedBlockMentionNames)

      const toolBlocks = allBlocks
        .filter((block: any) => !block.hideFromToolbar && block.category === 'tools')
        .map((block: any) => ({
          id: block.type,
          name: getLocalizedBlockNameWithCopy(workflowInspectorCopy, block),
          iconComponent: block.icon,
          bgColor: sanitizeSolidIconColor(block.bgColor),
        }))
        .sort(compareLocalizedBlockMentionNames)

      setBlocksList([...regularBlocks, ...toolBlocks])
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
      if (submenu === 'chats') {
        await ensurePastChatsLoaded()
        return
      }

      if (isCopilotWorkspaceEntityMentionOption(submenu)) {
        await ensureWorkspaceEntityLoaded(submenu)
        return
      }

      if (submenu === 'knowledge') {
        await ensureKnowledgeLoaded()
        return
      }

      if (submenu === 'blocks') {
        await ensureBlocksLoaded()
        return
      }

      if (submenu === 'workflow_blocks') {
        await ensureWorkflowBlocksLoaded()
        return
      }

      await ensureLogsLoaded()
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
    if (workflowId && workspaceEntities.workflow.length === 0) {
      void ensureWorkspaceEntityLoaded('workflow')
    }
  }, [ensureWorkspaceEntityLoaded, workflowId, workspaceEntities.workflow.length])

  useEffect(() => {
    setPastChats([])
    setIsLoadingPastChats(false)
    setWorkspaceEntities(createEmptyWorkspaceEntities())
    setWorkspaceEntityLoading(createEmptyWorkspaceEntityLoading())
    setKnowledgeBases([])
    setIsLoadingKnowledge(false)
    setLogsList([])
    setIsLoadingLogs(false)
  }, [workspaceId])

  const mentionSources: MentionSources = {
    pastChats,
    workspaceEntities,
    knowledgeBases,
    blocksList,
    logsList,
    workflowBlocks,
  }

  const mentionLoading: Record<MentionSubmenu, boolean> = {
    chats: isLoadingPastChats,
    workflow: workspaceEntityLoading.workflow,
    skill: workspaceEntityLoading.skill,
    indicator: workspaceEntityLoading.indicator,
    custom_tool: workspaceEntityLoading.custom_tool,
    mcp_server: workspaceEntityLoading.mcp_server,
    watchlist: workspaceEntityLoading.watchlist,
    dashboard_layout: workspaceEntityLoading.dashboard_layout,
    workflow_blocks: isLoadingWorkflowBlocks,
    blocks: isLoadingBlocks,
    knowledge: isLoadingKnowledge,
    logs: isLoadingLogs,
  }

  return {
    blocksList,
    ensureBlocksLoaded,
    ensureKnowledgeLoaded,
    ensureLogsLoaded,
    ensurePastChatsLoaded,
    ensureSubmenuLoaded,
    ensureWorkflowBlocksLoaded,
    isLoadingBlocks,
    isLoadingKnowledge,
    isLoadingLogs,
    isLoadingPastChats,
    isLoadingWorkflowBlocks,
    knowledgeBases,
    logsList,
    mentionLoading,
    mentionSources,
    pastChats,
    workflowBlocks,
    workspaceEntities,
  }
}
