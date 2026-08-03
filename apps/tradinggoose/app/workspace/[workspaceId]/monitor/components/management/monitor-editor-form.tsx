'use client'

import { useMemo } from 'react'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import { MarketProviderSelector } from '@/components/market-selector/provider-selector'
import { TradingAccountSelector } from '@/components/trading-selector/account-selector'
import { TradingProviderSelector } from '@/components/trading-selector/provider-selector'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import { cn } from '@/lib/utils'
import { type MonitorCopy, useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { useWorkspaceBlockEditorMessages } from '@/i18n/workspace-widget-hooks'
import type {
  MarketProviderOption,
  MarketProviderParamDefinition,
} from '@/providers/market/providers'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { getProviderIntervalFallback, type MonitorDraftIssues } from '../config/config-draft'
import type {
  IndicatorOption,
  MonitorDraft,
  TradingProviderOption,
  WorkflowTargetOption,
} from '../shared/types'
import { IndicatorInputFields } from './indicator-input-fields'
import { PortfolioConditionBuilder } from './portfolio-condition-builder'

type MonitorEditorFormProps = {
  editingKey: string | null
  draft: MonitorDraft
  issues: MonitorDraftIssues
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

const getIssueId = (key: string, index: number) =>
  `monitor-editor-error-${encodeURIComponent(key)}-${index}`

const getIssueProps = (issues: MonitorDraftIssues, key: string) => {
  const describedBy = issues[key]?.map((_, index) => getIssueId(key, index)).join(' ')
  return {
    'aria-invalid': describedBy ? true : undefined,
    'aria-describedby': describedBy || undefined,
  }
}

function WorkflowTargetSelect({
  value,
  targets,
  issues,
  label,
  placeholder,
  onUpdateDraft,
}: {
  value?: string
  targets: WorkflowTargetOption[]
  issues: MonitorDraftIssues
  label: string
  placeholder: string
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
}) {
  return (
    <div className='space-y-2'>
      <Label htmlFor='monitor-workflow-target' className='text-muted-foreground text-xs'>
        {label}
      </Label>
      <Select
        value={value ?? null}
        items={targets.map((target) => ({
          value: `${target.workflowId}:${target.blockId}`,
          label: target.label,
        }))}
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
        <SelectTrigger
          id='monitor-workflow-target'
          aria-label={label}
          {...getIssueProps(issues, 'workflowTarget')}
        >
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
    </div>
  )
}

function IndicatorMonitorFields({
  copy,
  draft,
  issues,
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
  issues: MonitorDraftIssues
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
          <Label id='monitor-market-provider-label' className='text-muted-foreground text-xs'>
            {copy.fields.provider}
          </Label>
          <div
            role='group'
            aria-labelledby='monitor-market-provider-label'
            {...getIssueProps(issues, 'providerId')}
          >
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
          </div>
        </div>

        {nonSecretDefinitions.length > 0 ? (
          <div className='space-y-2'>
            <p className='text-muted-foreground text-xs'>{copy.editor.form.feed}</p>
            {nonSecretDefinitions.map((definition) => {
              const key = `param:${definition.id}`
              const value = draft.providerParamValues[definition.id] ?? ''
              const fieldId = `monitor-feed-${encodeURIComponent(definition.id)}`
              const fieldLabel = definition.title || definition.id
              return definition.options && definition.options.length > 0 ? (
                <Select
                  key={definition.id}
                  value={value || null}
                  items={definition.options.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                  onValueChange={(nextValue) => {
                    if (nextValue !== null) {
                      onUpdateProviderParamValue(definition.id, nextValue)
                    }
                  }}
                >
                  <SelectTrigger
                    id={fieldId}
                    aria-label={fieldLabel}
                    {...getIssueProps(issues, key)}
                  >
                    <SelectValue placeholder={fieldLabel} />
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
                  key={definition.id}
                  id={fieldId}
                  aria-label={fieldLabel}
                  {...getIssueProps(issues, key)}
                  value={value}
                  placeholder={fieldLabel}
                  type={definition.type === 'number' ? 'number' : 'text'}
                  autoComplete='off'
                  onChange={(event) =>
                    onUpdateProviderParamValue(definition.id, event.target.value)
                  }
                />
              )
            })}
          </div>
        ) : null}
      </div>

      {secretDefinitions.length > 0 ? (
        <div className='space-y-2'>
          <p className='text-muted-foreground text-xs'>{copy.editor.form.auth}</p>
          <div className={cn('grid gap-3', secretDefinitions.length > 1 && 'sm:grid-cols-2')}>
            {secretDefinitions.map((definition) => {
              const key = `secret:${definition.id}`
              const normalizedId = definition.id.replace(/\s+/g, '').toLowerCase()
              const isPassword = definition.password || normalizedId.includes('secret')
              const fieldId = `monitor-auth-${encodeURIComponent(definition.id)}`
              const fieldLabel = definition.title || definition.id
              return (
                <Input
                  key={definition.id}
                  id={fieldId}
                  aria-label={fieldLabel}
                  {...getIssueProps(issues, key)}
                  value={draft.secretValues[definition.id] ?? ''}
                  onChange={(event) => onUpdateSecretValue(definition.id, event.target.value)}
                  placeholder={fieldLabel}
                  type={definition.type === 'number' ? 'number' : isPassword ? 'password' : 'text'}
                  autoComplete='off'
                  disabled={saving}
                />
              )
            })}
          </div>
        </div>
      ) : null}

      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label id='monitor-listing-label' className='text-muted-foreground text-xs'>
            {copy.fields.listing}
          </Label>
          <div
            role='group'
            aria-labelledby='monitor-listing-label'
            {...getIssueProps(issues, 'listing')}
          >
            {listingInstanceId ? (
              <ListingSearchInput
                instanceId={listingInstanceId}
                providerType='market'
                onListingChange={(listing) =>
                  onUpdateDraft({ listing: listing?.listingIdentity ?? null })
                }
              />
            ) : null}
          </div>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='monitor-interval' className='text-muted-foreground text-xs'>
            {copy.fields.interval}
          </Label>
          <Select
            value={draft.interval || null}
            items={providerIntervals.map((interval) => ({
              value: interval,
              label: interval,
            }))}
            onValueChange={(interval) => {
              if (interval !== null) onUpdateDraft({ interval })
            }}
          >
            <SelectTrigger
              id='monitor-interval'
              aria-label={copy.fields.interval}
              {...getIssueProps(issues, 'interval')}
            >
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
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        <WorkflowTargetSelect
          value={workflowTargetValue}
          targets={availableWorkflowTargets}
          issues={issues}
          label={copy.fields.workflowTarget}
          placeholder={copy.editor.form.workflowTargetPlaceholder}
          onUpdateDraft={onUpdateDraft}
        />

        <div className='space-y-2'>
          <Label htmlFor='monitor-indicator' className='text-muted-foreground text-xs'>
            {copy.fields.indicator}
          </Label>
          <Select
            value={draft.indicatorId || null}
            items={indicatorPickerOptions.map((option) => ({
              value: option.id,
              label: option.name,
            }))}
            onValueChange={(indicatorId) => {
              if (indicatorId !== null) onUpdateDraft({ indicatorId })
            }}
          >
            <SelectTrigger
              id='monitor-indicator'
              aria-label={copy.fields.indicator}
              {...getIssueProps(issues, 'indicatorId')}
            >
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
  copy,
  draft,
  issues,
  saving,
  tradingProviders,
  availableWorkflowTargets,
  workflowTargetValue,
  portfolioTriggerToolName,
  selectedPortfolioIdentity,
  onUpdateDraft,
}: {
  copy: MonitorCopy
  draft: MonitorDraft
  issues: MonitorDraftIssues
  saving: boolean
  tradingProviders: TradingProviderOption[]
  availableWorkflowTargets: WorkflowTargetOption[]
  workflowTargetValue?: string
  portfolioTriggerToolName: string
  selectedPortfolioIdentity: PortfolioIdentity | null
  onUpdateDraft: (patch: Partial<MonitorDraft>) => void
}) {
  return (
    <>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label id='monitor-trading-provider-label' className='text-muted-foreground text-xs'>
            {copy.editor.form.tradingProvider}
          </Label>
          <div
            role='group'
            aria-labelledby='monitor-trading-provider-label'
            {...getIssueProps(issues, 'providerId')}
          >
            <TradingProviderSelector
              value={draft.providerId}
              options={tradingProviders}
              disabled={saving}
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
          </div>
        </div>

        <div className='space-y-2'>
          <Label id='monitor-trading-account-label' className='text-muted-foreground text-xs'>
            {copy.editor.form.tradingAccount}
          </Label>
          <div
            role='group'
            aria-labelledby='monitor-trading-account-label'
            {...getIssueProps(issues, 'tradingAccount')}
          >
            <TradingAccountSelector
              providerId={draft.providerId}
              serviceId={draft.serviceId}
              portfolioIdentity={selectedPortfolioIdentity}
              disabled={saving}
              toolName={portfolioTriggerToolName}
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
          </div>
        </div>
      </div>

      <WorkflowTargetSelect
        value={workflowTargetValue}
        targets={availableWorkflowTargets}
        issues={issues}
        label={copy.fields.workflowTarget}
        placeholder={copy.editor.form.workflowTargetPlaceholder}
        onUpdateDraft={onUpdateDraft}
      />

      <PortfolioConditionBuilder
        condition={draft.condition}
        disabled={saving}
        invalid={Boolean(issues.condition)}
        describedBy={getIssueProps(issues, 'condition')['aria-describedby']}
        tradingProviderId={draft.providerId}
        onChange={(condition) => onUpdateDraft({ condition })}
      />

      <div className='grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]'>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-xs'>{copy.editor.form.fireMode}</Label>
          <Select
            value={draft.fireMode}
            items={[
              { value: 'edge', label: copy.editor.form.fireModeEdge },
              { value: 'while_true', label: copy.editor.form.fireModeWhileTrue },
            ]}
            onValueChange={(fireMode) => {
              if (fireMode !== null) onUpdateDraft({ fireMode })
            }}
          >
            <SelectTrigger aria-label={copy.editor.form.fireMode}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='edge'>{copy.editor.form.fireModeEdge}</SelectItem>
              <SelectItem value='while_true'>{copy.editor.form.fireModeWhileTrue}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='monitor-cooldown-seconds' className='text-muted-foreground text-xs'>
            {copy.editor.form.cooldownSeconds}
          </Label>
          <Input
            id='monitor-cooldown-seconds'
            type='number'
            min={0}
            max={86400}
            value={draft.cooldownSeconds}
            disabled={saving}
            onChange={(event) => onUpdateDraft({ cooldownSeconds: Number(event.target.value) })}
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='monitor-poll-seconds' className='text-muted-foreground text-xs'>
            {copy.editor.form.pollSeconds}
          </Label>
          <Input
            id='monitor-poll-seconds'
            type='number'
            min={15}
            max={3600}
            value={draft.pollIntervalSeconds}
            disabled={saving}
            onChange={(event) => onUpdateDraft({ pollIntervalSeconds: Number(event.target.value) })}
          />
        </div>
      </div>
    </>
  )
}

export function MonitorEditorForm({
  editingKey,
  draft,
  issues,
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
  const blockEditorCopy = useWorkspaceBlockEditorMessages()
  const workflowTargetValue =
    draft.workflowId && draft.blockId ? `${draft.workflowId}:${draft.blockId}` : undefined
  const availableWorkflowTargets = workflowTargets.filter(
    (target) => target.source === draft.source
  )
  const portfolioTriggerToolName = blockEditorCopy.blockNames.portfolio_state_trigger
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
          {Object.keys(issues).length > 0 ? (
            <Alert variant='destructive' aria-atomic='true'>
              <AlertDescription>
                <ul className='list-disc space-y-1 pl-4'>
                  {Object.entries(issues).flatMap(([key, messages]) =>
                    messages.map((message, index) => (
                      <li key={`${key}:${message}`} id={getIssueId(key, index)}>
                        {message}
                      </li>
                    ))
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className='flex items-center justify-between rounded-md border px-3 py-2'>
            <div>
              <div className='font-medium text-sm'>{copy.editor.form.statusTitle}</div>
              <div className='text-muted-foreground text-xs'>
                {copy.editor.form.statusDescription}
              </div>
            </div>
            <Switch
              aria-label={copy.editor.form.statusTitle}
              checked={draft.isActive}
              disabled={saving}
              onCheckedChange={(isActive) => onUpdateDraft({ isActive })}
            />
          </div>

          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs'>{copy.editor.form.sourceLabel}</Label>
            <Select
              value={draft.source}
              disabled={saving || Boolean(editingKey)}
              items={[
                {
                  value: INDICATOR_MONITOR_PROVIDER,
                  label: copy.editor.form.sourceIndicator,
                },
                {
                  value: PORTFOLIO_MONITOR_PROVIDER,
                  label: copy.editor.form.sourcePortfolio,
                },
              ]}
              onValueChange={(source) => {
                if (source !== null) onUpdateDraft({ source })
              }}
            >
              <SelectTrigger aria-label={copy.editor.form.sourceLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INDICATOR_MONITOR_PROVIDER}>
                  {copy.editor.form.sourceIndicator}
                </SelectItem>
                <SelectItem value={PORTFOLIO_MONITOR_PROVIDER}>
                  {copy.editor.form.sourcePortfolio}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {draft.source === PORTFOLIO_MONITOR_PROVIDER ? (
            <PortfolioMonitorFields
              copy={copy}
              draft={draft}
              issues={issues}
              saving={saving}
              tradingProviders={tradingProviders}
              availableWorkflowTargets={availableWorkflowTargets}
              workflowTargetValue={workflowTargetValue}
              portfolioTriggerToolName={portfolioTriggerToolName}
              selectedPortfolioIdentity={selectedPortfolioIdentity}
              onUpdateDraft={onUpdateDraft}
            />
          ) : (
            <IndicatorMonitorFields
              copy={copy}
              draft={draft}
              issues={issues}
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
