'use client'

import { useMemo } from 'react'
import { type MonitorCopy, useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import { MarketProviderSelector } from '@/components/market-selector/provider-selector'
import { TradingAccountSelector } from '@/components/trading-selector/account-selector'
import { TradingProviderSelector } from '@/components/trading-selector/provider-selector'
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
import { TooltipProvider } from '@/components/ui/tooltip'
import type { InputMetaMap } from '@/lib/indicators/types'
import { toListingValue } from '@/lib/listing/identity'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import { cn } from '@/lib/utils'
import type {
  MarketProviderOption,
  MarketProviderParamDefinition,
} from '@/providers/market/providers'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { getProviderIntervalFallback } from '../config/config-draft'
import type {
  IndicatorOption,
  MonitorDraft,
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
  marketProviders: MarketProviderOption[]
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

function WorkflowTargetSelect({
  value,
  targets,
  errors,
  label,
  placeholder,
  onUpdateDraft,
}: {
  value?: string
  targets: WorkflowTargetOption[]
  errors: Record<string, string>
  label: string
  placeholder: string
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
}) {
  return (
    <div className='space-y-2'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <Select
        value={value}
        onValueChange={(targetKey) => {
          const target = targets.find(
            (entry) => `${entry.workflowId}:${entry.blockId}` === targetKey
          )
          onUpdateDraft({
            workflowId: target?.workflowId ?? '',
            blockId: target?.blockId ?? '',
          })
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
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
  )
}

function IndicatorMonitorFields({
  copy,
  draft,
  errors,
  saving,
  marketProviders,
  providerIntervals,
  providerIntervalsByProviderId,
  defaultDraftInterval,
  availableWorkflowTargets,
  workflowTargetValue,
  indicatorPickerOptions,
  indicatorInputMeta,
  nonSecretDefinitions,
  secretDefinitions,
  listingInstanceId,
  onUpdateDraft,
  onUpdateSecretValue,
  onUpdateProviderParamValue,
  onUpdateIndicatorInputs,
}: {
  copy: MonitorCopy
  draft: MonitorDraft
  errors: Record<string, string>
  saving: boolean
  marketProviders: MarketProviderOption[]
  providerIntervals: string[]
  providerIntervalsByProviderId: Record<string, string[]>
  defaultDraftInterval: string
  availableWorkflowTargets: WorkflowTargetOption[]
  workflowTargetValue?: string
  indicatorPickerOptions: IndicatorOption[]
  indicatorInputMeta: InputMetaMap | undefined
  nonSecretDefinitions: MarketProviderParamDefinition[]
  secretDefinitions: MarketProviderParamDefinition[]
  listingInstanceId: string | null
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
  onUpdateSecretValue: (fieldId: string, value: string) => void
  onUpdateProviderParamValue: (fieldId: string, value: string) => void
  onUpdateIndicatorInputs: (nextInputs: Record<string, unknown>) => void
}) {
  return (
    <>
      <div className={cn('grid gap-3', nonSecretDefinitions.length > 0 && 'sm:grid-cols-2')}>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.fields.provider}</Label>
          <MarketProviderSelector
            value={draft.providerId}
            options={marketProviders}
            disabled={saving}
            placeholder={copy.editor.form.providerPlaceholder}
            variant='form'
            onChange={(nextProviderId) => {
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
          />
          {errors.providerId ? <p className='text-[11px] text-destructive'>{errors.providerId}</p> : null}
        </div>

        {nonSecretDefinitions.length > 0 ? (
          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>{copy.editor.form.feed}</Label>
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
                  {errors[key] ? <p className='text-[11px] text-destructive'>{errors[key]}</p> : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {secretDefinitions.length > 0 ? (
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.editor.form.auth}</Label>
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
                    onChange={(event) => onUpdateSecretValue(definition.id, event.target.value)}
                    placeholder={definition.title || definition.id}
                    type={
                      definition.type === 'number' ? 'number' : isPassword ? 'password' : 'text'
                    }
                    autoComplete='off'
                    disabled={saving}
                  />
                  {errors[key] ? <p className='text-[11px] text-destructive'>{errors[key]}</p> : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.fields.listing}</Label>
          {listingInstanceId ? (
            <ListingSearchInput
              instanceId={listingInstanceId}
              providerType='market'
              onListingChange={(listing) => onUpdateDraft({ listing: toListingValue(listing) })}
            />
          ) : null}
          {errors.listing ? <p className='text-[11px] text-destructive'>{errors.listing}</p> : null}
        </div>

        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.fields.interval}</Label>
          <Select
            value={draft.interval || undefined}
            onValueChange={(interval) => onUpdateDraft({ interval })}
          >
            <SelectTrigger>
              <SelectValue placeholder={copy.editor.form.intervalPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {providerIntervals.map((interval) => (
                <SelectItem key={interval} value={interval}>
                  {interval}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.interval ? <p className='text-[11px] text-destructive'>{errors.interval}</p> : null}
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        <WorkflowTargetSelect
          value={workflowTargetValue}
          targets={availableWorkflowTargets}
          errors={errors}
          label={copy.fields.workflowTarget}
          placeholder={copy.editor.form.workflowTargetPlaceholder}
          onUpdateDraft={onUpdateDraft}
        />

        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.fields.indicator}</Label>
          <Select
            value={draft.indicatorId || undefined}
            onValueChange={(indicatorId) => onUpdateDraft({ indicatorId })}
          >
            <SelectTrigger>
              <SelectValue placeholder={copy.editor.form.indicatorPlaceholder} />
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
  )
}

function PortfolioMonitorFields({
  draft,
  errors,
  saving,
  tradingProviders,
  availableWorkflowTargets,
  workflowTargetValue,
  selectedPortfolioIdentity,
  onUpdateDraft,
}: {
  draft: MonitorDraft
  errors: Record<string, string>
  saving: boolean
  tradingProviders: TradingProviderOption[]
  availableWorkflowTargets: WorkflowTargetOption[]
  workflowTargetValue?: string
  selectedPortfolioIdentity: PortfolioIdentity | null
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
}) {
  return (
    <>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>Trading provider</Label>
          <TradingProviderSelector
            value={draft.providerId}
            options={tradingProviders}
            disabled={saving}
            placeholder='Select trading provider'
            variant='form'
            onChange={(providerId) =>
              onUpdateDraft({
                providerId,
                serviceId: '',
                credentialId: '',
                accountId: '',
              })
            }
          />
          {errors.providerId ? <p className='text-[11px] text-destructive'>{errors.providerId}</p> : null}
        </div>

        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>Trading account</Label>
          <TradingAccountSelector
            providerId={draft.providerId}
            serviceId={draft.serviceId}
            portfolioIdentity={selectedPortfolioIdentity}
            disabled={saving}
            placeholder='Select account'
            tooltipText='Select trading account'
            toolName='Portfolio Monitor'
            variant='form'
            onAccountSelect={(selection) => {
              const account = selection.portfolioIdentity
              onUpdateDraft({
                serviceId: account?.serviceId ?? selection.serviceId ?? '',
                credentialId: account?.credentialId ?? '',
                accountId: account?.accountId ?? '',
              })
            }}
          />
          {errors.accountId || errors.credentialId || errors.serviceId ? (
            <p className='text-[11px] text-destructive'>
              {errors.accountId || errors.credentialId || errors.serviceId}
            </p>
          ) : null}
        </div>
      </div>

      <WorkflowTargetSelect
        value={workflowTargetValue}
        targets={availableWorkflowTargets}
        errors={errors}
        label='Workflow Target'
        placeholder='Select workflow target'
        onUpdateDraft={onUpdateDraft}
      />

      <PortfolioConditionBuilder
        condition={draft.condition}
        disabled={saving}
        error={errors.condition}
        tradingProviderId={draft.providerId}
        onChange={(condition) => onUpdateDraft({ condition })}
      />

      <div className='grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)]'>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>Fire mode</Label>
          <Select
            value={draft.fireMode}
            onValueChange={(fireMode: MonitorDraft['fireMode']) => onUpdateDraft({ fireMode })}
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
  )
}

export function MonitorEditorForm({
  workspaceId: _workspaceId,
  editingKey,
  draft,
  errors,
  saving,
  marketProviders,
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
  const { copy } = useMonitorCopy()
  const workflowTargetValue =
    draft.workflowId && draft.blockId ? `${draft.workflowId}:${draft.blockId}` : undefined
  const availableWorkflowTargets = workflowTargets.filter(
    (target) => target.source === draft.source
  )
  const intervalOptions =
    providerIntervals.length > 0 ? providerIntervals : draft.interval ? [draft.interval] : []
  const selectedPortfolioIdentity = useMemo<PortfolioIdentity | null>(() => {
    if (
      draft.source !== PORTFOLIO_MONITOR_PROVIDER ||
      !draft.providerId ||
      !draft.serviceId ||
      !draft.credentialId ||
      !draft.accountId
    ) {
      return null
    }

    return {
      providerId: draft.providerId,
      serviceId: draft.serviceId,
      credentialId: draft.credentialId,
      accountId: draft.accountId,
    }
  }, [draft.accountId, draft.credentialId, draft.providerId, draft.serviceId, draft.source])

  return (
    <TooltipProvider>
      <div className='flex h-full min-h-0 flex-col'>
        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4'>
          <div className='flex items-center justify-between rounded-md border px-3 py-2'>
            <div>
              <div className='font-medium text-sm'>{copy.editor.form.statusTitle}</div>
              <div className='text-muted-foreground text-xs'>{copy.editor.form.statusDescription}</div>
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
                <SelectItem value={INDICATOR_MONITOR_PROVIDER}>Indicator trigger</SelectItem>
                <SelectItem value={PORTFOLIO_MONITOR_PROVIDER}>Portfolio state</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {draft.source === PORTFOLIO_MONITOR_PROVIDER ? (
            <PortfolioMonitorFields
              draft={draft}
              errors={errors}
              saving={saving}
              tradingProviders={tradingProviders}
              availableWorkflowTargets={availableWorkflowTargets}
              workflowTargetValue={workflowTargetValue}
              selectedPortfolioIdentity={selectedPortfolioIdentity}
              onUpdateDraft={onUpdateDraft}
            />
          ) : (
            <IndicatorMonitorFields
              copy={copy}
              draft={draft}
              errors={errors}
              saving={saving}
              marketProviders={marketProviders}
              providerIntervals={intervalOptions}
              providerIntervalsByProviderId={providerIntervalsByProviderId}
              defaultDraftInterval={defaultDraftInterval}
              availableWorkflowTargets={availableWorkflowTargets}
              workflowTargetValue={workflowTargetValue}
              indicatorPickerOptions={indicatorPickerOptions}
              indicatorInputMeta={indicatorInputMeta}
              nonSecretDefinitions={nonSecretDefinitions}
              secretDefinitions={secretDefinitions}
              listingInstanceId={listingInstanceId}
              onUpdateDraft={onUpdateDraft}
              onUpdateSecretValue={onUpdateSecretValue}
              onUpdateProviderParamValue={onUpdateProviderParamValue}
              onUpdateIndicatorInputs={onUpdateIndicatorInputs}
            />
          )}
        </div>

        <div className='flex shrink-0 items-center justify-end gap-2 border-t pt-3'>
          <Button variant='outline' onClick={onCancel} disabled={saving}>
            {copy.dialog.cancel}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving
              ? copy.editor.form.saving
              : editingKey
                ? copy.editor.form.saveChanges
                : copy.editor.form.createMonitor}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
