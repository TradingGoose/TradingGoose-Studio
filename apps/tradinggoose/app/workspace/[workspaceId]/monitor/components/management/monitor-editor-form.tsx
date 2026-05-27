'use client'

import { useEffect, useMemo } from 'react'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
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
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import { getPortfolioIdentityKey } from '@/providers/trading/portfolio-identity'
import { getProviderIntervalFallback } from '../config/config-draft'
import type {
  IndicatorOption,
  MonitorDraft,
  StreamingProviderOption,
  TradingProviderOption,
  WorkflowTargetOption,
} from '../shared/types'
import { IndicatorInputFields } from './indicator-input-fields'
import { PortfolioConditionBuilder } from './portfolio-condition-builder'

type MonitorEditorFormProps = {
  workspaceId: string
  editingKey: string | null
  draft: MonitorDraft
  errors: Record<string, string>
  saving: boolean
  streamingProviders: StreamingProviderOption[]
  tradingProviders: TradingProviderOption[]
  providerIntervals: string[]
  providerIntervalsByProviderId: Record<string, string[]>
  defaultDraftInterval: string
  workflowTargets: WorkflowTargetOption[]
  indicatorPickerOptions: IndicatorOption[]
  indicatorInputMeta: InputMetaMap | undefined
  nonSecretDefinitions: MarketProviderParamDefinition[]
  secretDefinitions: MarketProviderParamDefinition[]
  listingInstanceId: string | null
  onCancel: () => void
  onSave: () => void
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
  onUpdateSecretValue: (fieldId: string, value: string) => void
  onUpdateProviderParamValue: (fieldId: string, value: string) => void
  onUpdateIndicatorInputs: (nextInputs: Record<string, unknown>) => void
}

export function MonitorEditorForm({
  workspaceId,
  editingKey,
  draft,
  errors,
  saving,
  streamingProviders,
  tradingProviders,
  providerIntervals,
  providerIntervalsByProviderId,
  defaultDraftInterval,
  workflowTargets,
  indicatorPickerOptions,
  indicatorInputMeta,
  nonSecretDefinitions,
  secretDefinitions,
  listingInstanceId,
  onCancel,
  onSave,
  onUpdateDraft,
  onUpdateSecretValue,
  onUpdateProviderParamValue,
  onUpdateIndicatorInputs,
}: MonitorEditorFormProps) {
  const workflowTargetValue =
    draft.workflowId && draft.blockId ? `${draft.workflowId}:${draft.blockId}` : undefined
  const availableWorkflowTargets = workflowTargets.filter(
    (target) => target.source === draft.source
  )
  const intervalOptions =
    providerIntervals.length > 0 ? providerIntervals : draft.interval ? [draft.interval] : []
  const portfolioAccountsQuery = usePortfolioIdentities({
    workspaceId,
    provider: draft.source === 'portfolio' ? draft.providerId : undefined,
    enabled: draft.source === 'portfolio' && Boolean(draft.providerId),
  })
  const portfolioAccounts = portfolioAccountsQuery.data ?? []
  const selectedPortfolioKey =
    draft.providerId && draft.credentialId && draft.serviceId && draft.accountId
      ? getPortfolioIdentityKey({
          providerId: draft.providerId as any,
          credentialId: draft.credentialId,
          serviceId: draft.serviceId,
          accountId: draft.accountId,
        })
      : undefined
  const portfolioAccountOptions = useMemo(
    () =>
      portfolioAccounts.map((account) => ({
        key: getPortfolioIdentityKey(account),
        account,
        label: account.accountName || account.accountId,
        description: [account.serviceId, account.accountType, account.accountStatus]
          .filter(Boolean)
          .join(' - '),
      })),
    [portfolioAccounts]
  )

  useEffect(() => {
    if (draft.source !== 'portfolio' || portfolioAccountOptions.length === 0) return
    if (
      selectedPortfolioKey &&
      portfolioAccountOptions.some((option) => option.key === selectedPortfolioKey)
    ) {
      return
    }
    const firstAccount = portfolioAccountOptions[0]!.account
    onUpdateDraft({
      serviceId: firstAccount.serviceId,
      credentialId: firstAccount.credentialId,
      accountId: firstAccount.accountId,
    })
  }, [draft.source, onUpdateDraft, portfolioAccountOptions, selectedPortfolioKey])

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

        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>Monitor source</Label>
          <Select
            value={draft.source}
            disabled={saving || Boolean(editingKey)}
            onValueChange={(source: MonitorDraft['source']) => onUpdateDraft({ source })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='indicator'>Indicator trigger</SelectItem>
              <SelectItem value='portfolio'>Portfolio state</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.source === 'portfolio' ? (
          <>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label className='text-muted-foreground text-xs'>Trading provider</Label>
                <Select
                  value={draft.providerId || undefined}
                  onValueChange={(providerId) =>
                    onUpdateDraft({
                      providerId,
                      serviceId: '',
                      credentialId: '',
                      accountId: '',
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select trading provider' />
                  </SelectTrigger>
                  <SelectContent>
                    {tradingProviders.map((provider) => {
                      const Icon = provider.icon
                      return (
                        <SelectItem key={provider.id} value={provider.id}>
                          <span className='inline-flex min-w-0 items-center gap-2'>
                            {Icon ? (
                              <Icon className='h-4 w-4 shrink-0 text-muted-foreground' />
                            ) : null}
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

              <div className='space-y-2'>
                <Label className='text-muted-foreground text-xs'>Trading account</Label>
                <Select
                  value={selectedPortfolioKey}
                  disabled={saving || portfolioAccountsQuery.isLoading}
                  onValueChange={(key) => {
                    const selected = portfolioAccountOptions.find((option) => option.key === key)
                    if (!selected) return
                    onUpdateDraft({
                      serviceId: selected.account.serviceId,
                      credentialId: selected.account.credentialId,
                      accountId: selected.account.accountId,
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        portfolioAccountsQuery.isLoading ? 'Loading accounts' : 'Select account'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolioAccountOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        <span className='inline-flex min-w-0 flex-col'>
                          <span className='truncate'>{option.label}</span>
                          {option.description ? (
                            <span className='truncate text-muted-foreground text-xs'>
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.accountId || errors.credentialId || errors.serviceId ? (
                  <p className='text-[11px] text-destructive'>
                    {errors.accountId || errors.credentialId || errors.serviceId}
                  </p>
                ) : null}
                {portfolioAccountsQuery.error ? (
                  <p className='text-[11px] text-destructive'>
                    {portfolioAccountsQuery.error.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className='space-y-2'>
              <Label className='text-muted-foreground text-xs'>Workflow Target</Label>
              <Select
                value={workflowTargetValue}
                onValueChange={(targetKey) => {
                  const target = availableWorkflowTargets.find(
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
                  {availableWorkflowTargets.map((target) => (
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

            <PortfolioConditionBuilder
              condition={draft.condition}
              disabled={saving}
              error={errors.condition}
              onChange={(condition) => onUpdateDraft({ condition })}
            />

            <div className='grid gap-3 sm:grid-cols-3'>
              <div className='space-y-2'>
                <Label className='text-muted-foreground text-xs'>Fire mode</Label>
                <Select
                  value={draft.fireMode}
                  onValueChange={(fireMode: MonitorDraft['fireMode']) =>
                    onUpdateDraft({ fireMode })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='edge'>When condition turns true</SelectItem>
                    <SelectItem value='while_true'>While condition is true</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label className='text-muted-foreground text-xs'>Cooldown seconds</Label>
                <Input
                  type='number'
                  min={0}
                  max={86400}
                  value={draft.cooldownSeconds}
                  disabled={saving}
                  onChange={(event) =>
                    onUpdateDraft({ cooldownSeconds: Number(event.target.value) })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label className='text-muted-foreground text-xs'>Poll seconds</Label>
                <Input
                  type='number'
                  min={15}
                  max={3600}
                  value={draft.pollIntervalSeconds}
                  disabled={saving}
                  onChange={(event) =>
                    onUpdateDraft({ pollIntervalSeconds: Number(event.target.value) })
                  }
                />
              </div>
            </div>
          </>
        ) : (
          <>
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
                            {Icon ? (
                              <Icon className='h-4 w-4 shrink-0 text-muted-foreground' />
                            ) : null}
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
                    const isPassword = definition.password || normalizedId.includes('secret')
                    return (
                      <div key={definition.id} className='space-y-1'>
                        <Input
                          id={`monitor-secret-${definition.id}`}
                          value={draft.secretValues[definition.id] ?? ''}
                          onChange={(event) =>
                            onUpdateSecretValue(definition.id, event.target.value)
                          }
                          placeholder={definition.title || definition.id}
                          type={
                            definition.type === 'number'
                              ? 'number'
                              : isPassword
                                ? 'password'
                                : 'text'
                          }
                          autoComplete='off'
                          disabled={saving}
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
                  <ListingSearchInput
                    instanceId={listingInstanceId}
                    providerType='market'
                    onListingChange={(listing) =>
                      onUpdateDraft({ listing: toListingValue(listing) })
                    }
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
                    const target = availableWorkflowTargets.find(
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
                    {availableWorkflowTargets.map((target) => (
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
          </>
        )}
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
