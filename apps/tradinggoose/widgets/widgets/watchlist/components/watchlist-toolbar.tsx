'use client'

import { type ChangeEvent, useRef, useState } from 'react'
import {
  Download,
  EllipsisVertical,
  Eraser,
  FileUp,
  ListPlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ListingOption } from '@/lib/listing/identity'
import { ListingSelector } from '@/widgets/widgets/components/listing-selector'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

type WatchlistToolbarProps = {
  workspaceId?: string | null
  providerId?: string
  listingSelectorInstanceId: string
  canManageCurrentList: boolean
  hasActiveSort: boolean
  onListingChange: (listing: ListingOption | null) => void
  onAddListing: () => void
  onAddSection: (label: string) => Promise<void> | void
  onResetSort: () => void
  onRenameWatchlist: () => Promise<void> | void
  onClearWatchlist: () => Promise<void> | void
  onImportText: (content: string) => Promise<void>
  onExport: () => Promise<void>
  isMutating?: boolean
}

export const WatchlistToolbar = ({
  workspaceId,
  providerId,
  listingSelectorInstanceId,
  canManageCurrentList,
  hasActiveSort,
  onListingChange,
  onAddListing,
  onAddSection,
  onResetSort,
  onRenameWatchlist,
  onClearWatchlist,
  onImportText,
  onExport,
  isMutating = false,
}: WatchlistToolbarProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [sectionName, setSectionName] = useState('')

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const content = await file.text()
    await onImportText(content)
    event.target.value = ''
  }

  const handleAddSection = async () => {
    const label = sectionName.trim()
    if (!label) return
    await onAddSection(label)
    setSectionName('')
    setSectionOpen(false)
  }

  return (
    <div className='flex w-full flex-wrap items-center gap-2 border-b p-2'>
      <div className='min-w-[280px] flex-1'>
        <ListingSelector
          instanceId={listingSelectorInstanceId}
          providerType='market'
          disabled={!workspaceId || !providerId}
          onListingChange={onListingChange}
        />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={onAddListing}
            disabled={!workspaceId || !providerId || isMutating}
          >
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>Add symbol</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Add symbol</TooltipContent>
      </Tooltip>

      <Popover open={sectionOpen} onOpenChange={setSectionOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={!workspaceId || isMutating}
              >
                <ListPlus className='h-3.5 w-3.5' />
                <span className='sr-only'>Add section</span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side='top'>Add section</TooltipContent>
        </Tooltip>
        <PopoverContent className='w-64 p-3' align='end'>
          <div className='space-y-2'>
            <Input
              placeholder='Section name'
              value={sectionName}
              onChange={(event) => setSectionName(event.target.value)}
            />
            <Button
              size='sm'
              className='w-full'
              onClick={() => {
                void handleAddSection()
              }}
              disabled={isMutating || !sectionName.trim()}
            >
              Create
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={widgetHeaderIconButtonClassName()}
                  disabled={!workspaceId || isMutating}
                >
                  <EllipsisVertical className='h-3.5 w-3.5' />
                  <span className='sr-only'>Other actions</span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>Other actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align='end' className='w-44 p-1'>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              handleImportClick()
            }}
            disabled={!workspaceId || isMutating}
          >
            <FileUp className='h-3.5 w-3.5' />
            <span>Import</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              void onExport()
            }}
            disabled={!workspaceId || isMutating}
          >
            <Download className='h-3.5 w-3.5' />
            <span>Export</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              void onRenameWatchlist()
            }}
            disabled={!workspaceId || !canManageCurrentList || isMutating}
          >
            <Pencil className='h-3.5 w-3.5' />
            <span>Rename list</span>
          </DropdownMenuItem>
          {canManageCurrentList ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void onClearWatchlist()
              }}
              disabled={!workspaceId || isMutating}
            >
              <Trash2 className='h-3.5 w-3.5' />
              <span>Clear list</span>
            </DropdownMenuItem>
          ) : null}
          {canManageCurrentList ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onResetSort()
              }}
              disabled={!hasActiveSort || isMutating}
            >
              <Eraser className='h-3.5 w-3.5' />
              <span>Reset order</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type='file'
        accept='.txt,text/plain'
        className='hidden'
        onChange={handleImportChange}
      />
    </div>
  )
}
