'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import {
  type CopilotWorkspaceEntityKind,
  getCopilotWorkspaceEntityKindFromMentionOption,
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

const logger = createLogger('CopilotUserInputMentionSources')

interface UseUserInputMentionSourcesOptions {
  workspaceId: string
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
})

const createEmptyWorkspaceEntityLoading = (): Record<CopilotWorkspaceEntityKind, boolean> => ({
  workflow: false,
  skill: false,
  indicator: false,
  custom_tool: false,
  mcp_server: false,
})

const sortByRecent = <T extends { createdAt?: string; updatedAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })

export function useUserInputMentionSources({ workspaceId }: UseUserInputMentionSourcesOptions) {
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
        items.map((item: any) => ({
          reviewSessionId: item.reviewSessionId,
          title: item.title ?? null,
          workflowId: null,
          updatedAt: item.updatedAt,
        }))
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

        let response: Response
        if (entityKind === 'workflow') {
          response = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)
        } else if (entityKind === 'skill') {
          response = await fetch(`/api/skills?workspaceId=${encodeURIComponent(workspaceId)}`)
        } else if (entityKind === 'indicator') {
          response = await fetch(
            `/api/indicators/custom?workspaceId=${encodeURIComponent(workspaceId)}`
          )
        } else if (entityKind === 'custom_tool') {
          response = await fetch(`/api/tools/custom?workspaceId=${encodeURIComponent(workspaceId)}`)
        } else {
          response = await fetch(`/api/mcp/servers?workspaceId=${encodeURIComponent(workspaceId)}`)
        }

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(`Failed to load ${entityKind}: ${response.status}`)
        }

        const mapped: WorkspaceEntityItem[] =
          entityKind === 'workflow'
            ? sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
                entityKind,
                id: item.id,
                name: item.name || 'Untitled Workflow',
                color: item.color,
              }))
            : entityKind === 'skill'
              ? sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
                  entityKind,
                  id: item.id,
                  name: item.name || 'Untitled Skill',
                  description: item.description || '',
                }))
              : entityKind === 'indicator'
                ? sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
                    entityKind,
                    id: item.id,
                    name: item.name || 'Untitled Indicator',
                    color: item.color,
                  }))
                : entityKind === 'custom_tool'
                  ? sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
                      entityKind,
                      id: item.id,
                      name: item.title || item.schema?.function?.name || 'Untitled Tool',
                      description: item.schema?.function?.description || '',
                      functionName: item.schema?.function?.name || '',
                    }))
                  : sortByRecent(Array.isArray(data?.data?.servers) ? data.data.servers : []).map(
                      (item: any) => ({
                        entityKind,
                        id: item.id,
                        name: item.name || 'Untitled MCP Server',
                        description: item.description || '',
                        transport: item.transport || 'http',
                        enabled: item.enabled,
                        connectionStatus: item.connectionStatus,
                      })
                    )

        setWorkspaceEntities((prev) => ({ ...prev, [entityKind]: mapped }))
      } catch (error) {
        logger.error(`Failed to load ${entityKind} mention sources`, error)
      } finally {
        setWorkspaceEntityLoading((prev) => ({ ...prev, [entityKind]: false }))
      }
    },
    [workspaceEntities, workspaceEntityLoading, workspaceId]
  )

  const ensureWorkflowsLoaded = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    await ensureWorkspaceEntityLoaded('workflow')
  }, [ensureWorkspaceEntityLoaded, workspaceId])

  const ensureKnowledgeLoaded = useCallback(async () => {
    if (isLoadingKnowledge || knowledgeBases.length > 0) {
      return
    }

    try {
      setIsLoadingKnowledge(true)
      const response = await fetch(`/api/knowledge?workspaceId=${workspaceId}`)

      if (!response.ok) {
        throw new Error(`Failed to load knowledge bases: ${response.status}`)
      }

      const data = await response.json()
      const items = Array.isArray(data?.data) ? data.data : []
      const sorted = [...items].sort((a: any, b: any) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return timeB - timeA
      })

      setKnowledgeBases(
        sorted.map((item: any) => ({
          id: item.id,
          name: item.name || 'Untitled',
        }))
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
          name: block.name || block.type,
          iconComponent: block.icon,
          bgColor: sanitizeSolidIconColor(block.bgColor),
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      const toolBlocks = allBlocks
        .filter((block: any) => !block.hideFromToolbar && block.category === 'tools')
        .map((block: any) => ({
          id: block.type,
          name: block.name || block.type,
          iconComponent: block.icon,
          bgColor: sanitizeSolidIconColor(block.bgColor),
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))

      setBlocksList([...regularBlocks, ...toolBlocks])
    } catch {
    } finally {
      setIsLoadingBlocks(false)
    }
  }, [blocksList.length, isLoadingBlocks])

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
        items.map((item: any) => ({
          id: item.id,
          executionId: item.executionId || item.id,
          level: item.level,
          trigger: item.trigger || null,
          createdAt: item.createdAt,
          workflowName:
            (item.workflow && (item.workflow.name || item.workflow.title)) ||
            item.workflowName ||
            'Untitled Workflow',
        }))
      )
    } catch {
    } finally {
      setIsLoadingLogs(false)
    }
  }, [isLoadingLogs, logsList.length, workspaceId])

  const ensureWorkflowBlocksLoaded = useCallback(async () => {
    if (isLoadingWorkflowBlocks) {
      return
    }

    if (!workflowId || Object.keys(workflowStoreBlocks).length === 0) {
      setWorkflowBlocks([])
      return
    }

    try {
      setIsLoadingWorkflowBlocks(true)
      const { registry: blockRegistry } = await import('@/blocks/registry')
      const mapped = Object.values(workflowStoreBlocks).map((block: any) => {
        const registryEntry = (blockRegistry as any)[block.type]

        return {
          id: block.id,
          name: block.name || block.id,
          type: block.type,
          iconComponent: registryEntry?.icon,
          bgColor: sanitizeSolidIconColor(registryEntry?.bgColor) || '#6B7280',
        }
      })

      setWorkflowBlocks(mapped)
    } catch (error) {
      logger.error('Failed to sync workflow blocks:', error)
    } finally {
      setIsLoadingWorkflowBlocks(false)
    }
  }, [isLoadingWorkflowBlocks, workflowId, workflowStoreBlocks])

  const ensureSubmenuLoaded = useCallback(
    async (submenu: MentionSubmenu) => {
      if (submenu === 'Chats') {
        await ensurePastChatsLoaded()
        return
      }

      if (isCopilotWorkspaceEntityMentionOption(submenu)) {
        await ensureWorkspaceEntityLoaded(getCopilotWorkspaceEntityKindFromMentionOption(submenu))
        return
      }

      if (submenu === 'Knowledge') {
        await ensureKnowledgeLoaded()
        return
      }

      if (submenu === 'Blocks') {
        await ensureBlocksLoaded()
        return
      }

      if (submenu === 'Workflow Blocks') {
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
    void ensureWorkflowBlocksLoaded()
  }, [ensureWorkflowBlocksLoaded])

  useEffect(() => {
    if (workflowId && workspaceEntities.workflow.length === 0) {
      void ensureWorkflowsLoaded()
    }
  }, [ensureWorkflowsLoaded, workflowId, workspaceEntities.workflow.length])

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
    Chats: isLoadingPastChats,
    Workflows: workspaceEntityLoading.workflow,
    Skills: workspaceEntityLoading.skill,
    Indicators: workspaceEntityLoading.indicator,
    'Custom Tools': workspaceEntityLoading.custom_tool,
    'MCP Servers': workspaceEntityLoading.mcp_server,
    'Workflow Blocks': isLoadingWorkflowBlocks,
    Blocks: isLoadingBlocks,
    Knowledge: isLoadingKnowledge,
    Logs: isLoadingLogs,
  }

  return {
    blocksList,
    ensureBlocksLoaded,
    ensureKnowledgeLoaded,
    ensureLogsLoaded,
    ensurePastChatsLoaded,
    ensureSubmenuLoaded,
    ensureWorkflowBlocksLoaded,
    ensureWorkflowsLoaded,
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
