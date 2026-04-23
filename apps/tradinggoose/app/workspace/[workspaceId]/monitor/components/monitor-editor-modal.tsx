'use client'

import { Activity, Workflow as WorkflowIcon } from 'lucide-react'
import { StockSelector } from '@/components/listing-selector/selector/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toListingValue } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import { ShortInput } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/short-input'
import { SearchableDropdown } from './searchable-dropdown'
import type {
  IndicatorOption,
  MonitorDraft,
  StreamingProviderOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from './types'

type MonitorEditorModalProps = {
  open: boolean
  editingKey: string | null
  draft: MonitorDraft | null
  errors: Record<string, string>
  saving: boolean
  streamingProviders: StreamingProviderOption[]
  providerIntervals: string[]
  workflowTargets: WorkflowTargetOption[]
  workflowPickerOptions: WorkflowPickerOption[]
  indicatorPickerOptions: IndicatorOption[]
  nonSecretDefinitions: MarketProviderParamDefinition[]
  secretDefinitions: MarketProviderParamDefinition[]
  listingInstanceId: string | null
  workspaceId: string
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onSave: () => void
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
  onUpdateSecretValue: (fieldId: string, value: string) => void
  onUpdateProviderParamValue: (fieldId: string, value: string) => void
}

export function MonitorEditorModal({
  open,
  editingKey,
  draft,
  errors,
  saving,
  streamingProviders,
  providerIntervals,
  workflowTargets,
  workflowPickerOptions,
  indicatorPickerOptions,
  nonSecretDefinitions,
  secretDefinitions,
  listingInstanceId,
  workspaceId,
  onOpenChange,
  onCancel,
  onSave,
  onUpdateDraft,
  onUpdateSecretValue,
  onUpdateProviderParamValue,
}: MonitorEditorModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{editingKey ? 'Edit Monitor' : 'Add Monitor'}</DialogTitle>
          <DialogDescription>
            Configure provider, auth, listing, indicator, interval, and workflow target.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className='grid gap-4 py-1'>
            <div
              className={cn(
                'grid gap-3',
                nonSecretDefinitions.length > 0 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
              )}
            >
              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Provider</p>
                <SearchableDropdown
                  value={draft.providerId}
                  options={streamingProviders.map((provider) => ({
                    value: provider.id,
                    label: provider.name,
                    icon: provider.icon,
                    searchValue: `${provider.name} ${provider.id}`,
                  }))}
                  placeholder='Select provider'
                  searchPlaceholder='Search providers...'
                  emptyText='No providers found.'
                  onValueChange={(nextProviderId) => {
                    const nextIntervals =
                      getMarketSeriesCapabilities(nextProviderId)?.intervals ?? []
                    onUpdateDraft({
                      providerId: nextProviderId,
                      interval: nextIntervals.includes(draft.interval as any)
                        ? draft.interval
                        : (nextIntervals[0] ?? ''),
                    })
                  }}
                  renderTriggerValue={(selected) => {
                    const ProviderIcon = selected?.icon

                    return (
                      <div className='flex min-w-0 items-center gap-2'>
                        {ProviderIcon ? (
                          <ProviderIcon className='h-4 w-4 shrink-0 text-foreground' />
                        ) : null}
                        <span
                          className={cn(
                            'truncate text-sm',
                            selected ? 'text-foreground' : 'text-muted-foreground'
                          )}
                        >
                          {selected?.label || 'Select provider'}
                        </span>
                      </div>
                    )
                  }}
                  renderOption={(option) => {
                    const ProviderIcon = option.icon

                    return (
                      <>
                        {ProviderIcon ? (
                          <ProviderIcon className='h-4 w-4 shrink-0 text-foreground' />
                        ) : null}
                        <span className='truncate'>{option.label}</span>
                      </>
                    )
                  }}
                />
                {errors.providerId ? (
                  <p className='text-[11px] text-destructive'>{errors.providerId}</p>
                ) : null}
              </div>

              {nonSecretDefinitions.length > 0 ? (
                <div className='space-y-2'>
                  <p className='text-muted-foreground text-xs'>Feed</p>
                  {nonSecretDefinitions.map((definition) => {
                    const key = `param:${definition.id}`
                    const value = draft.providerParamValues[definition.id] ?? ''

                    if (definition.options && definition.options.length > 0) {
                      return (
                        <div key={definition.id} className='space-y-1'>
                          <SearchableDropdown
                            value={value}
                            options={definition.options.map((option) => ({
                              value: option.id,
                              label: option.label,
                              searchValue: `${option.label} ${option.id}`,
                            }))}
                            placeholder={definition.title || definition.id}
                            searchPlaceholder={`Search ${definition.title || definition.id}...`}
                            emptyText='No options found.'
                            onValueChange={(nextValue) =>
                              onUpdateProviderParamValue(definition.id, nextValue)
                            }
                          />
                          {errors[key] ? (
                            <p className='text-[11px] text-destructive'>{errors[key]}</p>
                          ) : null}
                        </div>
                      )
                    }

                    return (
                      <div key={definition.id} className='space-y-1'>
                        <Input
                          value={value}
                          onChange={(event) =>
                            onUpdateProviderParamValue(definition.id, event.target.value)
                          }
                          placeholder={definition.title || definition.id}
                          type={definition.type === 'number' ? 'number' : 'text'}
                          autoComplete='off'
                          data-1p-ignore='true'
                          data-lpignore='true'
                          data-form-type='other'
                        />
                        {errors[key] ? (
                          <p className='text-[11px] text-destructive'>{errors[key]}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>

            {secretDefinitions.length > 0 ? (
              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Auth</p>
                <div
                  className={cn(
                    'grid gap-3',
                    secretDefinitions.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
                  )}
                >
                  {secretDefinitions.map((definition) => {
                    const key = `secret:${definition.id}`
                    const normalizedId = definition.id.replace(/\s+/g, '').toLowerCase()
                    const isPasswordField = definition.password || normalizedId.includes('secret')
                    const shortInputConfig: SubBlockConfig = {
                      id: definition.id,
                      title: definition.title ?? definition.id,
                      type: 'short-input',
                      inputType: definition.type === 'number' ? 'number' : 'text',
                      placeholder: definition.placeholder ?? definition.title ?? definition.id,
                      connectionDroppable: false,
                    }
                    return (
                      <div key={definition.id} className='space-y-1'>
                        <ShortInput
                          blockId={`monitor-auth-${editingKey ?? 'new'}`}
                          subBlockId={definition.id}
                          inputId={`monitor-secret-${definition.id}`}
                          isConnecting={false}
                          config={shortInputConfig}
                          value={draft.secretValues[definition.id] ?? ''}
                          onChange={(value) => onUpdateSecretValue(definition.id, value)}
                          placeholder={definition.title || definition.id}
                          password={isPasswordField}
                          workspaceId={workspaceId}
                          enableTags={false}
                          forceEnvVarDropdown
                        />
                        {errors[key] ? (
                          <p className='text-[11px] text-destructive'>{errors[key]}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Listing</p>
                {listingInstanceId ? (
                  <StockSelector
                    instanceId={listingInstanceId}
                    providerType='market'
                    onListingChange={(listing) => {
                      onUpdateDraft({ listing: toListingValue(listing) })
                    }}
                  />
                ) : null}
                {errors.listing ? (
                  <p className='text-[11px] text-destructive'>{errors.listing}</p>
                ) : null}
              </div>

              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Interval</p>
                <SearchableDropdown
                  value={draft.interval}
                  options={providerIntervals.map((interval) => ({
                    value: interval,
                    label: interval,
                  }))}
                  placeholder='Select interval'
                  searchPlaceholder='Search intervals...'
                  emptyText='No intervals found.'
                  onValueChange={(value) => onUpdateDraft({ interval: value })}
                />
                {errors.interval ? (
                  <p className='text-[11px] text-destructive'>{errors.interval}</p>
                ) : null}
              </div>
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Workflow</p>
                <SearchableDropdown
                  value={draft.workflowId}
                  options={workflowPickerOptions.map((option) => ({
                    ...option,
                    value: option.workflowId,
                    label: option.workflowName,
                    searchValue: `${option.workflowName} ${option.workflowId}`,
                  }))}
                  placeholder='Select workflow'
                  searchPlaceholder='Search workflows...'
                  emptyText='No workflows found.'
                  onValueChange={(workflowId) => {
                    const preferredTarget =
                      workflowTargets.find(
                        (target) =>
                          target.workflowId === workflowId && target.blockId === draft.blockId
                      ) ?? workflowTargets.find((target) => target.workflowId === workflowId)

                    onUpdateDraft({
                      workflowId,
                      blockId: preferredTarget?.blockId ?? '',
                    })
                  }}
                  renderTriggerValue={(selected) => (
                    <div className='flex min-w-0 items-center gap-2'>
                      <span
                        className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                        style={{
                          backgroundColor: selected ? `${selected.workflowColor}20` : '#64748b20',
                        }}
                        aria-hidden='true'
                      >
                        <WorkflowIcon
                          className='h-full w-full'
                          style={{ color: selected?.workflowColor ?? '#64748b' }}
                        />
                      </span>
                      <span
                        className={cn(
                          'truncate text-sm',
                          selected ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {selected?.workflowName || 'Select workflow'}
                      </span>
                    </div>
                  )}
                  renderOption={(option) => (
                    <>
                      <span
                        className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                        style={{ backgroundColor: `${option.workflowColor}20` }}
                        aria-hidden='true'
                      >
                        <WorkflowIcon
                          className='h-full w-full'
                          style={{ color: option.workflowColor }}
                        />
                      </span>
                      <span className='truncate'>{option.workflowName}</span>
                    </>
                  )}
                />
                {errors.workflowId || errors.blockId ? (
                  <p className='text-[11px] text-destructive'>
                    {errors.blockId || errors.workflowId}
                  </p>
                ) : null}
              </div>

              <div className='space-y-2'>
                <p className='text-muted-foreground text-xs'>Indicator</p>
                <SearchableDropdown
                  value={draft.indicatorId}
                  options={indicatorPickerOptions.map((option) => ({
                    ...option,
                    value: option.id,
                    label: option.name,
                    searchValue: `${option.name} ${option.id}`,
                  }))}
                  placeholder='Select indicator'
                  searchPlaceholder='Search indicators...'
                  emptyText='No indicators found.'
                  onValueChange={(indicatorId) => onUpdateDraft({ indicatorId })}
                  renderTriggerValue={(selected) => (
                    <div className='flex min-w-0 items-center gap-2'>
                      <span
                        className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                        style={{
                          backgroundColor: selected ? `${selected.color}20` : '#64748b20',
                        }}
                        aria-hidden='true'
                      >
                        <Activity
                          className='h-full w-full'
                          style={{ color: selected?.color ?? '#64748b' }}
                        />
                      </span>
                      <span
                        className={cn(
                          'truncate text-sm',
                          selected ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {selected?.name || 'Select indicator'}
                      </span>
                    </div>
                  )}
                  renderOption={(option) => (
                    <>
                      <span
                        className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                        style={{ backgroundColor: `${option.color}20` }}
                        aria-hidden='true'
                      >
                        <Activity className='h-full w-full' style={{ color: option.color }} />
                      </span>
                      <span className='truncate'>{option.name}</span>
                    </>
                  )}
                />
                {errors.indicatorId ? (
                  <p className='text-[11px] text-destructive'>{errors.indicatorId}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant='outline' onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : editingKey ? 'Save Changes' : 'Create Monitor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
