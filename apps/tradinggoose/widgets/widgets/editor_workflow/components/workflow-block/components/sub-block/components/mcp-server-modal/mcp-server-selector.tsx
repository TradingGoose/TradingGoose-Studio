'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface McpServerSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function McpServerSelector({ blockId, subBlock, disabled = false }: McpServerSelectorProps) {
  const copy = useMessages().workspace.widgets.mcpDropdown
  const workspaceId = useWorkspaceId()
  const [open, setOpen] = useState(false)

  const { members, isLoading, error } = useEntityList('mcp_server', workspaceId)
  const enabledServers = useMemo(
    () =>
      members
        .filter((member) => member.enabled !== false)
        .map((member) => ({
          id: member.entityId,
          name: member.entityName,
        })),
    [members]
  )

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const label = subBlock.placeholder || copy.selectMcpServer

  const selectedServerId = storeValue || ''

  const selectedServer = enabledServers.find((server) => server.id === selectedServerId)

  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
  }

  const handleSelect = (serverId: string) => {
    setStoreValue(serverId)
    setOpen(false)
  }

  const getDisplayText = () => {
    if (selectedServer) {
      return <span className='truncate font-normal'>{selectedServer.name}</span>
    }
    return <span className='truncate text-muted-foreground'>{label}</span>
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='relative w-full justify-between'
          disabled={disabled}
        >
          <div className='flex max-w-[calc(100%-20px)] items-center overflow-hidden'>
            {getDisplayText()}
          </div>
          <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[250px] p-0' align='start'>
        <Command>
          <CommandInput placeholder={copy.searchPlaceholder} />
          <CommandList>
            <CommandEmpty>
              {isLoading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>{copy.loading}</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-destructive text-sm'>{copy.failedToLoad}</p>
                  <p className='text-muted-foreground text-xs'>{error}</p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.noServersAvailable}</p>
                  <p className='text-muted-foreground text-xs'>
                    {copy.addServerInDashboardWidgets}
                  </p>
                </div>
              )}
            </CommandEmpty>
            {enabledServers.length > 0 && (
              <CommandGroup>
                {enabledServers.map((server) => (
                  <CommandItem
                    key={server.id}
                    value={`server-${server.id}-${server.name}`}
                    onSelect={() => handleSelect(server.id)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-1 overflow-hidden'>
                      <span className='truncate font-normal'>{server.name}</span>
                    </div>
                    {server.id === selectedServerId && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
