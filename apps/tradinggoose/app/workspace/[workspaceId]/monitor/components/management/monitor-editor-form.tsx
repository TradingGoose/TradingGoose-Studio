'use client'

import { StockSelector } from '@/components/listing-selector/selector/input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { InputMetaMap } from '@/lib/indicators/types'
import { toListingValue } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import { ShortInput } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/short-input'
import { getProviderIntervalFallback } from '../config/config-draft'
import type {
  IndicatorOption,
  MonitorDraft,
  StreamingProviderOption,
  WorkflowTargetOption,
} from '../shared/types'
import { IndicatorInputFields } from './indicator-input-fields'

type MonitorEditorFormProps = {
  editingKey: string | null
  draft: MonitorDraft
  errors: Record<string, string>
  saving: boolean
  streamingProviders: StreamingProviderOption[]
  providerIntervals: string[]
  providerIntervalsByProviderId: Record<string, string[]>
  defaultDraftInterval: string
  workflowTargets: WorkflowTargetOption[]
  indicatorPickerOptions: IndicatorOption[]
  indicatorInputMeta: InputMetaMap | undefined
  nonSecretDefinitions: MarketProviderParamDefinition[]
  secretDefinitions: MarketProviderParamDefinition[]
  listingInstanceId: string | null
  workspaceId: string
  onCancel: () => void
  onSave: () => void
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
  onUpdateSecretValue: (fieldId: string, value: string) => void
  onUpdateProviderParamValue: (fieldId: string, value: string) => void
  onUpdateIndicatorInputs: (nextInputs: Record<string, unknown>) => void
}

export function MonitorEditorForm({
  editingKey,
  draft,
  errors,
  saving,
  streamingProviders,
  providerIntervals,
  providerIntervalsByProviderId,
  defaultDraftInterval,
  workflowTargets,
  indicatorPickerOptions,
  indicatorInputMeta,
  nonSecretDefinitions,
  secretDefinitions,
  listingInstanceId,
  workspaceId,
  onCancel,
  onSave,
  onUpdateDraft,
  onUpdateSecretValue,
  onUpdateProviderParamValue,
  onUpdateIndicatorInputs,
}: MonitorEditorFormProps) {
  const workflowTargetValue =
    draft.workflowId && draft.blockId ? `${draft.workflowId}:${draft.blockId}` : undefined
  const intervalOptions =
    providerIntervals.length > 0 ? providerIntervals : draft.interval ? [draft.interval] : []

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4'>
        <div className='flex items-center justify-between rounded-md border px-3 py-2'>
          <div>
            <div className='font-medium text-sm'>Monitor status</div>
            <div className='text-muted-foreground text-xs'>
              New monitors start paused unless enabled here.
            </div>
          </div>
          <Switch
            checked={draft.isActive}
            disabled={saving}
            onCheckedChange={(isActive) => onUpdateDraft({ isActive })}
          />
        </div>

        <div className={cn('grid gap-3', nonSecretDefinitions.length > 0 && 'sm:grid-cols-2')}>
          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>Provider</Label>
            <Select
              value={draft.providerId || undefined}
              onValueChange={(nextProviderId) => {
                const nextIntervals = providerIntervalsByProviderId[nextProviderId] ?? []
                onUpdateDraft({
                  providerId: nextProviderId,
                  interval: nextIntervals.includes(draft.interval as any)
                    ? draft.interval
                    : getProviderIntervalFallback({
                        defaultDraftInterval,
                        providerId: nextProviderId,
                        providerIntervalsByProviderId,
                      }),
                })
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select provider' />
              </SelectTrigger>
              <SelectContent>
                {streamingProviders.map((provider) => {
                  const Icon = provider.icon
                  return (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className='inline-flex min-w-0 items-center gap-2'>
                        {Icon ? <Icon className='h-4 w-4 shrink-0 text-muted-foreground' /> : null}
                        <span className='truncate'>{provider.name}</span>
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {errors.providerId ? (
              <p className='text-[11px] text-destructive'>{errors.providerId}</p>
            ) : null}
          </div>

          {nonSecretDefinitions.length > 0 ? (
            <div className='space-y-2'>
              <Label className='text-muted-foreground text-xs'>Feed</Label>
              {nonSecretDefinitions.map((definition) => {
                const key = `param:${definition.id}`
                const value = draft.providerParamValues[definition.id] ?? ''
                return (
                  <div key={definition.id} className='space-y-1'>
                    {definition.options && definition.options.length > 0 ? (
                      <Select
                        value={value || undefined}
                        onValueChange={(nextValue) =>
                          onUpdateProviderParamValue(definition.id, nextValue)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={definition.title || definition.id} />
                        </SelectTrigger>
                        <SelectContent>
                          {definition.options.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={value}
                        placeholder={definition.title || definition.id}
                        type={definition.type === 'number' ? 'number' : 'text'}
                        autoComplete='off'
                        onChange={(event) =>
                          onUpdateProviderParamValue(definition.id, event.target.value)
                        }
                      />
                    )}
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
            <Label className='text-muted-foreground text-xs'>Auth</Label>
            <div className={cn('grid gap-3', secretDefinitions.length > 1 && 'sm:grid-cols-2')}>
              {secretDefinitions.map((definition) => {
                const key = `secret:${definition.id}`
                const normalizedId = definition.id.replace(/\s+/g, '').toLowerCase()
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
                      password={definition.password || normalizedId.includes('secret')}
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
            <Label className='text-muted-foreground text-xs'>Listing</Label>
            {listingInstanceId ? (
              <StockSelector
                instanceId={listingInstanceId}
                providerType='market'
                onListingChange={(listing) => onUpdateDraft({ listing: toListingValue(listing) })}
              />
            ) : null}
            {errors.listing ? (
              <p className='text-[11px] text-destructive'>{errors.listing}</p>
            ) : null}
          </div>

          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>Interval</Label>
            <Select
              value={draft.interval || undefined}
              onValueChange={(interval) => onUpdateDraft({ interval })}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select interval' />
              </SelectTrigger>
              <SelectContent>
                {intervalOptions.map((interval) => (
                  <SelectItem key={interval} value={interval}>
                    {interval}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.interval ? (
              <p className='text-[11px] text-destructive'>{errors.interval}</p>
            ) : null}
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>Workflow Target</Label>
            <Select
              value={workflowTargetValue}
              onValueChange={(targetKey) => {
                const target = workflowTargets.find(
                  (entry) => `${entry.workflowId}:${entry.blockId}` === targetKey
                )
                onUpdateDraft({
                  workflowId: target?.workflowId ?? '',
                  blockId: target?.blockId ?? '',
                })
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select workflow target' />
              </SelectTrigger>
              <SelectContent>
                {workflowTargets.map((target) => (
                  <SelectItem
                    key={`${target.workflowId}:${target.blockId}`}
                    value={`${target.workflowId}:${target.blockId}`}
                  >
                    {target.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.workflowId || errors.blockId || errors.workflowTarget ? (
              <p className='text-[11px] text-destructive'>
                {errors.workflowTarget || errors.blockId || errors.workflowId}
              </p>
            ) : null}
          </div>

          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>Indicator</Label>
            <Select
              value={draft.indicatorId || undefined}
              onValueChange={(indicatorId) => onUpdateDraft({ indicatorId })}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select indicator' />
              </SelectTrigger>
              <SelectContent>
                {indicatorPickerOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.indicatorId || errors.indicator ? (
              <p className='text-[11px] text-destructive'>
                {errors.indicator || errors.indicatorId}
              </p>
            ) : null}
          </div>
        </div>

        <IndicatorInputFields
          inputMeta={indicatorInputMeta}
          sparseInputs={draft.indicatorInputs}
          onChange={onUpdateIndicatorInputs}
          disabled={saving}
        />
      </div>

      <div className='flex shrink-0 items-center justify-end gap-2 border-t pt-3'>
        <Button variant='outline' onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : editingKey ? 'Save Changes' : 'Create Monitor'}
        </Button>
      </div>
    </div>
  )
}
