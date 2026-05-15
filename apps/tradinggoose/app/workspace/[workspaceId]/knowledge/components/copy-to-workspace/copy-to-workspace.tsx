'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CopyPlus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import {
  commandListClass,
  dropdownContentClass,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

const logger = createLogger('CopyToWorkspace')

interface Workspace {
  id: string
  name: string
  permissions: 'admin' | 'write' | 'read'
}

interface CopyToWorkspaceProps {
  knowledgeBaseId: string
  currentWorkspaceId: string
  disabled?: boolean
}

export function CopyToWorkspace({
  knowledgeBaseId,
  currentWorkspaceId,
  disabled = false,
}: CopyToWorkspaceProps) {
  const queryClient = useQueryClient()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCopying, setIsCopying] = useState(false)

  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        setIsLoading(true)
        const response = await fetch('/api/workspaces')
        if (!response.ok) {
          throw new Error('Failed to fetch workspaces')
        }

        const data = await response.json()
        setWorkspaces(
          data.workspaces
            .filter(
              (workspace: Workspace) =>
                workspace.permissions === 'write' || workspace.permissions === 'admin'
            )
            .map((workspace: Workspace) => ({
              id: workspace.id,
              name: workspace.name,
              permissions: workspace.permissions,
            }))
        )
      } catch (error) {
        logger.error('Error fetching workspaces:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkspaces()
  }, [])

  const copyToWorkspace = async (workspaceId: string) => {
    if (isCopying || disabled) return

    try {
      setIsCopying(true)
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceId }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to copy knowledge base')
      }

      if (workspaceId === currentWorkspaceId) {
        queryClient.setQueryData<KnowledgeBaseData[]>(
          knowledgeKeys.list(currentWorkspaceId),
          (previous = []) =>
            previous.some((kb) => kb.id === result.data.id) ? previous : [result.data, ...previous]
        )
      }
    } catch (error) {
      logger.error('Error copying knowledge base:', error)
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
              disabled={disabled || isLoading || isCopying}
              aria-label='Copy knowledge base to workspace'
            >
              <CopyPlus className='h-3.5 w-3.5' />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>Copy to workspace</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <div className={`${commandListClass} p-1`}>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => copyToWorkspace(workspace.id)}
              className='flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <div className='flex flex-col'>
                <span>{workspace.name}</span>
                <span className='text-muted-foreground text-xs capitalize'>
                  {workspace.permissions}
                </span>
              </div>
            </DropdownMenuItem>
          ))}

          {workspaces.length === 0 && !isLoading && (
            <DropdownMenuItem disabled className='px-3 py-2'>
              <span className='text-muted-foreground text-xs'>No workspaces with write access</span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
