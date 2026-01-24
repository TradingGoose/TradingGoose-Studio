'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info, Plus, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  getAllTriggerBlocks,
  getTriggerDisplayName,
  getTriggersForSidebar,
} from '@/lib/workflows/trigger-utils'
import {
  getProviderIdsForBlocks,
  isBlockAvailable,
  type ProviderAvailability,
} from '@/lib/workflows/block-availability'

const logger = createLogger('TriggerList')
const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = {}

interface TriggerListProps {
  onSelect: (triggerId: string, enableTriggerMode?: boolean) => void
  className?: string
}

export function TriggerList({ onSelect, className }: TriggerListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showList, setShowList] = useState(false)
  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>(
    DEFAULT_PROVIDER_AVAILABILITY
  )

  // Get all trigger options from the centralized source
  const triggerOptions = useMemo(() => getAllTriggerBlocks(), [])
  const triggerBlocks = useMemo(() => getTriggersForSidebar(), [])
  const providerIds = useMemo(() => getProviderIdsForBlocks(triggerBlocks), [triggerBlocks])

  useEffect(() => {
    let isMounted = true

    const loadAvailability = async () => {
      try {
        const query = providerIds.length
          ? `?providers=${encodeURIComponent(providerIds.join(','))}`
          : ''
        const response = await fetch(`/api/auth/oauth/providers${query}`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const data = (await response.json()) as ProviderAvailability
        if (!isMounted) return
        setProviderAvailability(data)
      } catch {
        // Keep default availability (gated providers stay hidden) on failure.
      }
    }

    void loadAvailability()

    return () => {
      isMounted = false
    }
  }, [providerIds])

  // Handle escape key
  useEffect(() => {
    if (!showList) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        logger.info('Closing trigger list via escape key')
        setShowList(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showList])

  const availableTriggerIds = useMemo(() => {
    if (triggerBlocks.length === 0) return new Set<string>()
    return new Set(
      triggerBlocks
        .filter((block) => isBlockAvailable(block, providerAvailability))
        .map((block) => block.type)
    )
  }, [triggerBlocks, providerAvailability])

  const availableTriggerOptions = useMemo(
    () => triggerOptions.filter((trigger) => availableTriggerIds.has(trigger.id)),
    [triggerOptions, availableTriggerIds]
  )

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return availableTriggerOptions

    const query = searchQuery.toLowerCase()
    return availableTriggerOptions.filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query)
    )
  }, [searchQuery, availableTriggerOptions])

  const coreOptions = useMemo(
    () => filteredOptions.filter((opt) => opt.category === 'core'),
    [filteredOptions]
  )

  const integrationOptions = useMemo(
    () => filteredOptions.filter((opt) => opt.category === 'integration'),
    [filteredOptions]
  )

  const handleTriggerClick = (triggerId: string, enableTriggerMode?: boolean) => {
    logger.info('Trigger selected', { triggerId, enableTriggerMode })
    onSelect(triggerId, enableTriggerMode)
    // Reset state after selection
    setShowList(false)
    setSearchQuery('')
  }

  const handleClose = () => {
    logger.info('Closing trigger list via X button')
    setShowList(false)
    setSearchQuery('')
  }

  const TriggerItem = ({ trigger }: { trigger: (typeof triggerOptions)[0] }) => {
    const Icon = trigger.icon

    return (
      <div
        className={cn(
          'flex h-10 w-full cursor-pointer items-center gap-[10px] rounded-sm border px-1.5 transition-all duration-200',
          'border-border/40 bg-background/60 hover:border-border hover:bg-secondary/80'
        )}
      >
        <div
          onClick={() => handleTriggerClick(trigger.id, trigger.enableTriggerMode)}
          className='flex flex-1 items-center gap-[10px]'
        >
          <div
            className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm'
            style={{ backgroundColor: trigger.color + '30', color: trigger.color }}
          >
            {Icon ? (
              <Icon className='!h-4 !w-4' />
            ) : (
              <div className='/20 h-4 w-4 rounded' />
            )}
          </div>
          <span className='flex-1 truncate font-medium text-sm leading-none'>
            {getTriggerDisplayName(trigger.id)}
          </span>
        </div>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className='flex h-6 w-6 items-center justify-center rounded-md'
            >
              <Info className='h-3.5 w-3.5 text-muted-foreground' />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side='top'
            sideOffset={5}
            className='z-[9999] max-w-[200px]'
            align='center'
            avoidCollisions={false}
          >
            <p className='text-xs'>{trigger.description}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center p-4 z-999',
        className
      )}
    >
      {!showList && (
        <button
          onClick={() => {
            logger.info('Opening trigger list')
            setShowList(true)
          }}
          className={cn(
            'pointer-events-auto',
            'flex items-center gap-2',
            'px-4 py-2',
            'rounded-lg border border-muted-foreground/50 border-dashed',
            'bg-background/95 backdrop-blur-sm',
            'hover:border-muted-foreground hover:bg-card',
            'transition-all duration-200',
            'font-medium text-muted-foreground text-sm'
          )}
        >
          <Plus className='h-4 w-4' />
          Click to Add Trigger
        </button>
      )}

      {showList && (
        <div
          className={cn(
            'pointer-events-auto',
            'max-h-[80vh] h-full w-full max-w-[700px]',
            'rounded-xl border border-border',
            'bg-background/95',
            'shadow-2xl',
            'flex flex-col',
            'relative'
          )}
        >
          {/* Search */}
          <div className='flex items-center border-b px-4 py-1'>
            <Search className='h-4 w-4 font-sans text-muted-foreground text-xl' />
            <Input
              placeholder='Search triggers'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='!font-[350] border-0 bg-transparent font-sans text-muted-foreground leading-10 tracking-normal placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              autoFocus
            />
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className='absolute top-4 right-4 h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus:outline-none disabled:pointer-events-none'
            tabIndex={-1}
          >
            <X className='h-4 w-4' />
            <span className='sr-only'>Close</span>
          </button>

          {/* Trigger List */}
          <div
            className='flex-1 overflow-y-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <div className='space-y-4 pt-4 pb-4'>
              {/* Core Triggers Section */}
              {coreOptions.length > 0 && (
                <div>
                  <h3 className='mb-2 ml-4 font-normal font-sans text-[13px] text-muted-foreground leading-none tracking-normal'>
                    Core Triggers
                  </h3>
                  <div className='px-4 pb-1'>
                    <div className='grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2'>
                      {coreOptions.map((trigger) => (
                        <TriggerItem key={trigger.id} trigger={trigger} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Integration Triggers Section */}
              {integrationOptions.length > 0 && (
                <div>
                  <h3 className='mb-2 ml-4 font-normal font-sans text-[13px] text-muted-foreground leading-none tracking-normal'>
                    Integration Triggers
                  </h3>
                  <div
                    className='max-h-[300px] overflow-y-auto px-4 pb-1'
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <div className='grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2'>
                      {integrationOptions.map((trigger) => (
                        <TriggerItem key={trigger.id} trigger={trigger} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {filteredOptions.length === 0 && (
                <div className='ml-6 py-12 text-center'>
                  <p className='text-muted-foreground'>No results found for "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
