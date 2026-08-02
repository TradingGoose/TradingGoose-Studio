'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
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
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { useMessages } from 'next-intl'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface McpToolSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function McpToolSelector({ blockId, subBlock, disabled = false }: McpToolSelectorProps) {
  const workspaceCopy = useMessages().workspace.widgets.blockEditor
  const copy = workspaceCopy.mcpToolSelector
  const searchCopy = workspaceCopy.toolInput
  const workspaceId = useWorkspaceId()
  const [open, setOpen] = useState(false)
  const feedbackId = useId()

  const {
    isLoading: toolsBusy,
    error,
    refreshTools,
    getToolsByServer,
  } = useMcpTools(workspaceId)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue(blockId, '_toolSchema')

  const [serverValue] = useSubBlockValue(blockId, 'server')

  const label = subBlock.placeholder || copy.selectTool

  const selectedToolId = storeValue || ''

  const availableTools = useMemo(() => {
    if (!serverValue) return []
    return getToolsByServer(serverValue)
  }, [serverValue, getToolsByServer])

  const selectedTool = availableTools.find((tool) => tool.id === selectedToolId)

  useEffect(() => {
    if (serverValue && selectedToolId && !selectedTool && availableTools.length === 0) {
      refreshTools()
    }
  }, [serverValue, selectedToolId, selectedTool, availableTools.length, refreshTools])

  useEffect(() => {
    if (
      storeValue &&
      availableTools.length > 0 &&
      !availableTools.find((tool) => tool.id === storeValue)
    ) {
      if (!disabled) {
        setStoreValue('')
      }
    }
  }, [serverValue, availableTools, storeValue, setStoreValue, disabled])

  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
    if (isOpen && serverValue) {
      refreshTools()
    }
  }

  const handleSelect = (toolId: string) => {
    setStoreValue(toolId)

    const tool = availableTools.find((t) => t.id === toolId)
    if (tool?.inputSchema) {
      setSchemaCache(tool.inputSchema)
    }
    setOpen(false)
  }

  const getDisplayText = () => {
    if (selectedTool) {
      return <span className='truncate font-normal'>{selectedTool.name}</span>
    }
    return (
      <span className='truncate text-muted-foreground'>
        {serverValue ? label : copy.selectServerFirst}
      </span>
    )
  }

  const isDisabled = disabled || !serverValue

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={isDisabled}
          render={
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              aria-describedby={toolsBusy || error ? feedbackId : undefined}
              aria-busy={toolsBusy || undefined}
              className='relative w-full justify-between'
              disabled={isDisabled}
            />
          }
        >
          <div className='flex max-w-[calc(100%-20px)] items-center overflow-hidden'>
            {getDisplayText()}
          </div>
          <ChevronDown
            aria-hidden='true'
            className='absolute right-3 h-4 w-4 shrink-0 opacity-50'
          />
        </PopoverTrigger>
        <PopoverContent className='w-[250px] p-0' align='start'>
          <Command>
            <CommandInput placeholder={searchCopy.searchTools} />
            <CommandList>
              <CommandEmpty>
                {error ? (
                  <div className='space-y-2 p-4 text-center'>
                    <p className='font-medium text-destructive text-sm'>
                      {copy.errorLoadingTools}
                    </p>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={toolsBusy}
                      focusableWhenDisabled={toolsBusy}
                      aria-busy={toolsBusy || undefined}
                      onClick={() => {
                        void refreshTools()
                      }}
                    >
                      {toolsBusy ? copy.retrying : copy.retry}
                    </Button>
                  </div>
                ) : toolsBusy ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw aria-hidden='true' className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>{copy.loadingTools}</span>
                  </div>
                ) : !serverValue ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>{copy.noServerSelected}</p>
                    <p className='text-muted-foreground text-xs'>
                      {copy.selectServerFirstDescription}
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>{copy.noToolsFound}</p>
                    <p className='text-muted-foreground text-xs'>{copy.noToolsFoundDescription}</p>
                  </div>
                )}
              </CommandEmpty>
              {availableTools.length > 0 && (
                <CommandGroup>
                  {availableTools.map((tool) => (
                    <CommandItem
                      key={tool.id}
                      value={`tool-${tool.id}-${tool.name}`}
                      onSelect={() => handleSelect(tool.id)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-1 overflow-hidden'>
                        <span className='truncate font-normal'>{tool.name}</span>
                      </div>
                      {tool.id === selectedToolId && (
                        <Check aria-hidden='true' className='ml-auto h-4 w-4' />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <span
        id={feedbackId}
        role={error ? 'alert' : 'status'}
        aria-live={error ? undefined : 'polite'}
        aria-atomic='true'
        className='sr-only'
      >
        {error ? copy.errorLoadingTools : toolsBusy ? copy.loadingTools : null}
      </span>
    </>
  )
}
