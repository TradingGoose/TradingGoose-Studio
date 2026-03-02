'use client'

import { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { StockSelector } from '@/components/listing-selector/selector/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'
import { toListingValue } from '@/lib/listing/identity'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

type ListingSelectorAddButtonProps = {
  instanceId: string
  workspaceId?: string
  providerId?: string
  isMutating?: boolean
  onAddListing: (listing: ListingIdentity) => Promise<boolean> | boolean
}

export const ListingSelectorAddButton = ({
  instanceId,
  workspaceId,
  providerId,
  isMutating = false,
  onAddListing,
}: ListingSelectorAddButtonProps) => {
  const [open, setOpen] = useState(false)
  const [selectedListing, setSelectedListing] = useState<ListingIdentity | null>(null)

  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instance = useListingSelectorStore((state) => state.instances[instanceId])
  const safeInstance = instance ?? createEmptyListingSelectorInstance()

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  useEffect(() => {
    if (!providerId || safeInstance.providerId === providerId) return
    updateInstance(instanceId, { providerId })
  }, [instanceId, providerId, safeInstance.providerId, updateInstance])

  const resetSelectionState = () => {
    setSelectedListing(null)
    updateInstance(instanceId, {
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: null,
      selectedListing: null,
    })
  }

  const disabled = !workspaceId || !providerId || isMutating

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      resetSelectionState()
    }
  }

  const handleAddListing = async () => {
    if (disabled || !selectedListing) return
    const added = await onAddListing(selectedListing)
    if (!added) return
    handleOpenChange(false)
  }

  const handleListingChange = (listing: ListingOption | null) => {
    setSelectedListing(toListingValue(listing))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={disabled}
              >
                <Plus className='h-3.5 w-3.5' />
                <span className='sr-only'>Add symbol</span>
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Add symbol</TooltipContent>
      </Tooltip>
      <PopoverContent
        align='end'
        className='w-[320px] p-2'
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className='flex items-center gap-2'>
          <StockSelector
            instanceId={instanceId}
            providerType='market'
            disabled={disabled}
            className='min-w-0 flex-1 [&>div>button]:h-5 [&>div>button]:w-5 [&>div>input]:h-8 [&>div>input]:rounded-sm [&>div>input]:px-2 [&>div>input]:pr-8 [&>div>input]:text-xs'
            onListingChange={handleListingChange}
          />
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            disabled={disabled || !selectedListing}
            onClick={() => {
              void handleAddListing()
            }}
          >
            <Check className='h-3.5 w-3.5' />
            <span className='sr-only'>Confirm add symbol</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
