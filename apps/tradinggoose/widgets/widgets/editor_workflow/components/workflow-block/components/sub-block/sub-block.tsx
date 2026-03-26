import type React from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Info } from 'lucide-react'
import { Label, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { SimpleTimePicker } from '@/components/ui/simple-time-picker'
import { Slider } from '@/components/ui/slider'
import { Switch as UISwitch } from '@/components/ui/switch'
import {
  formatUtcDate,
  formatUtcDateTime,
  parseStoredTimeValue,
  resolveStoredDateValue,
} from '@/lib/time-format'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import {
  ChannelSelectorInput,
  CheckboxList,
  Code,
  ComboBox,
  ConditionInput,
  CredentialSelector,
  DocumentSelector,
  Dropdown,
  EvalInput,
  FileSelectorInput,
  FileUpload,
  FolderSelectorInput,
  GroupedCheckboxList,
  InputFormat,
  InputMapping,
  KnowledgeBaseSelector,
  ListingSelectorInput,
  LongInput,
  McpDynamicArgs,
  McpServerSelector,
  McpToolSelector,
  OrderIdSelectorInput,
  ProjectSelectorInput,
  ResponseFormat,
  ScheduleConfig,
  ShortInput,
  SkillInput,
  Table,
  Text,
  ToolInput,
  TriggerSave,
  VariablesInput,
  WebhookConfig,
} from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components'
import { DocumentTagEntry } from './components/document-tag-entry/document-tag-entry'
import { KnowledgeTagFilters } from './components/knowledge-tag-filters/knowledge-tag-filters'
import { useSubBlockValue } from './hooks/use-sub-block-value'

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isConnecting: boolean
  disabled?: boolean
}

function SubBlockSwitchField({
  blockId,
  subBlockId,
  title,
  disabled = false,
}: {
  blockId: string
  subBlockId: string
  title: string
  disabled?: boolean
}) {
  const [value, setValue] = useSubBlockValue<boolean>(blockId, subBlockId)
  const inputId = `${blockId}-${subBlockId}`

  return (
    <div className='flex items-center space-x-3'>
      <UISwitch
        id={inputId}
        checked={Boolean(value)}
        onCheckedChange={(checked) => {
          if (!disabled) {
            setValue(checked)
          }
        }}
        disabled={disabled}
      />
      <Label
        htmlFor={inputId}
        className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
      >
        {title}
      </Label>
    </div>
  )
}

function SubBlockSliderField({
  blockId,
  subBlockId,
  min = 0,
  max = 100,
  defaultValue,
  step = 0.1,
  integer = false,
  disabled = false,
}: {
  blockId: string
  subBlockId: string
  min?: number
  max?: number
  defaultValue?: number
  step?: number
  integer?: boolean
  disabled?: boolean
}) {
  const [storeValue, setStoreValue] = useSubBlockValue<number>(blockId, subBlockId)
  const computedDefaultValue = defaultValue ?? (max <= 1 ? 0.7 : (min + max) / 2)
  const normalizedValue =
    storeValue !== null && storeValue !== undefined
      ? Math.max(min, Math.min(max, storeValue))
      : computedDefaultValue
  const range = max - min || 1

  useEffect(() => {
    if (storeValue !== null && storeValue !== undefined && storeValue !== normalizedValue) {
      setStoreValue(normalizedValue)
    }
  }, [normalizedValue, setStoreValue, storeValue])

  return (
    <div className='relative pt-2 pb-6'>
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={integer ? 1 : step}
        onValueChange={(newValue) => {
          if (!disabled) {
            setStoreValue(integer ? Math.round(newValue[0]) : newValue[0])
          }
        }}
        disabled={disabled}
        className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
      />
      <div
        className='absolute text-muted-foreground text-sm'
        style={{
          left: `clamp(0%, ${((normalizedValue - min) / range) * 100}%, 100%)`,
          transform: `translateX(-${(() => {
            const percentage = ((normalizedValue - min) / range) * 100
            const bias = -25 * Math.sin((percentage * Math.PI) / 50)
            return percentage === 0 ? 0 : percentage === 100 ? 100 : 50 + bias
          })()}%)`,
          top: '24px',
        }}
      >
        {integer ? Math.round(normalizedValue).toString() : Number(normalizedValue).toFixed(1)}
      </div>
    </div>
  )
}

function SubBlockTimeField({
  blockId,
  subBlockId,
  disabled = false,
}: {
  blockId: string
  subBlockId: string
  disabled?: boolean
}) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const initialSkipRef = useRef(!storeValue)
  const dateValue = useMemo(() => parseStoredTimeValue(storeValue ?? undefined), [storeValue])

  useEffect(() => {
    initialSkipRef.current = !storeValue
  }, [storeValue])

  return (
    <SimpleTimePicker
      value={dateValue}
      onChange={(nextDate) => {
        if (disabled) return
        if (initialSkipRef.current) {
          initialSkipRef.current = false
          return
        }
        initialSkipRef.current = false
        setStoreValue(format(nextDate, 'HH:mm:ss'))
      }}
      use12HourFormat
      timePicker={{ hour: true, minute: true, second: false }}
      disabled={disabled}
    />
  )
}

function SubBlockDateTimeField({
  blockId,
  subBlockId,
  disabled = false,
  config,
}: {
  blockId: string
  subBlockId: string
  disabled?: boolean
  config?: SubBlockConfig
}) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const dateValue = useMemo(() => resolveStoredDateValue(storeValue), [storeValue])

  return (
    <DateTimePicker
      value={dateValue}
      onChange={(nextDate) => {
        if (disabled) return
        if (!nextDate) {
          setStoreValue('')
          return
        }
        setStoreValue(config?.hideTime ? formatUtcDate(nextDate) : formatUtcDateTime(nextDate))
      }}
      min={resolveStoredDateValue(config?.minDate)}
      max={resolveStoredDateValue(config?.maxDate)}
      timezone={config?.timezone}
      hideTime={config?.hideTime}
      use12HourFormat={config?.use12HourFormat}
      clearable={config?.clearable}
      timePicker={config?.timePicker}
      placeholder={config?.placeholder}
      disabled={disabled}
    />
  )
}

export const SubBlock = memo(
  function SubBlock({ blockId, config, isConnecting, disabled = false }: SubBlockProps) {
    const [isValidJson, setIsValidJson] = useState(true)

    const handleMouseDown = (e: React.MouseEvent) => {
      e.stopPropagation()
    }

    const handleValidationChange = (isValid: boolean) => {
      setIsValidJson(isValid)
    }

    const isFieldRequired = () => {
      if (typeof config.required === 'boolean') {
        return config.required
      }
      return Boolean(config.required)
    }

    if (config.hidden) {
      return null
    }

    const renderInput = () => {
      const isDisabled = disabled

      switch (config.type) {
        case 'short-input':
          return (
            <ShortInput
              blockId={blockId}
              subBlockId={config.id}
              placeholder={config.placeholder}
              password={config.password}
              isConnecting={isConnecting}
              config={config}
              disabled={isDisabled}
              readOnly={config.readOnly}
              showCopyButton={config.showCopyButton}
              useWebhookUrl={config.useWebhookUrl}
            />
          )
        case 'long-input':
          return (
            <LongInput
              blockId={blockId}
              subBlockId={config.id}
              placeholder={config.placeholder}
              isConnecting={isConnecting}
              rows={config.rows}
              config={config}
              disabled={isDisabled}
            />
          )
        case 'dropdown':
          return (
            <div onMouseDown={handleMouseDown}>
              <Dropdown
                blockId={blockId}
                subBlockId={config.id}
                options={config.options as { label: string; id: string }[]}
                defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
                placeholder={config.placeholder}
                enableSearch={config.enableSearch}
                searchPlaceholder={config.searchPlaceholder}
                disabled={isDisabled}
                config={config}
              />
            </div>
          )
        case 'combobox':
          return (
            <div onMouseDown={handleMouseDown}>
              <ComboBox
                blockId={blockId}
                subBlockId={config.id}
                options={config.options as { label: string; id: string }[]}
                defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
                placeholder={config.placeholder}
                disabled={isDisabled}
                isConnecting={isConnecting}
                config={config}
              />
            </div>
          )
        case 'slider':
          return (
            <SubBlockSliderField
              blockId={blockId}
              subBlockId={config.id}
              min={config.min}
              max={config.max}
              defaultValue={(config.min || 0) + ((config.max || 100) - (config.min || 0)) / 2}
              step={config.step}
              integer={config.integer}
              disabled={isDisabled}
            />
          )
        case 'table':
          return (
            <Table
              blockId={blockId}
              subBlockId={config.id}
              columns={config.columns ?? []}
              disabled={isDisabled}
            />
          )
        case 'code':
          return (
            <Code
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              placeholder={config.placeholder}
              language={config.language}
              generationType={config.generationType}
              value={typeof config.value === 'function' ? config.value({}) : undefined}
              disabled={isDisabled}
              onValidationChange={handleValidationChange}
              readOnly={config.readOnly}
              collapsible={config.collapsible}
              defaultCollapsed={config.defaultCollapsed}
              defaultValue={config.defaultValue}
              showCopyButton={config.showCopyButton}
              wandConfig={
                config.wandConfig || {
                  enabled: false,
                  prompt: '',
                  placeholder: '',
                }
              }
            />
          )
        case 'switch':
          return (
            <SubBlockSwitchField
              blockId={blockId}
              subBlockId={config.id}
              title={config.title ?? ''}
              disabled={isDisabled}
            />
          )
        case 'tool-input':
          return (
            <ToolInput
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              disabled={isDisabled}
            />
          )
        case 'skill-input':
          return <SkillInput blockId={blockId} subBlockId={config.id} disabled={isDisabled} />
        case 'market-selector':
          return (
            <ListingSelectorInput
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              config={config}
            />
          )
        case 'order-id-selector':
          return (
            <OrderIdSelectorInput
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              config={config}
            />
          )
        case 'checkbox-list':
          return (
            <CheckboxList
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              layout={config.layout}
              disabled={isDisabled}
            />
          )
        case 'grouped-checkbox-list':
          return (
            <GroupedCheckboxList
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string; group?: string }[]}
              disabled={isDisabled}
            />
          )
        case 'condition-input':
          return (
            <ConditionInput
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              disabled={isDisabled}
            />
          )
        case 'eval-input':
          return <EvalInput blockId={blockId} subBlockId={config.id} disabled={isDisabled} />
        case 'time-input':
          return (
            <SubBlockTimeField blockId={blockId} subBlockId={config.id} disabled={isDisabled} />
          )
        case 'datetime-input':
          return (
            <SubBlockDateTimeField
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              config={config}
            />
          )
        case 'file-upload':
          return (
            <FileUpload
              blockId={blockId}
              subBlockId={config.id}
              acceptedTypes={config.acceptedTypes || '*'}
              multiple={config.multiple === true}
              maxSize={config.maxSize}
              disabled={isDisabled}
            />
          )
        case 'webhook-config': {
          return (
            <WebhookConfig
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              disabled={isDisabled}
            />
          )
        }
        case 'schedule-config':
          return (
            <ScheduleConfig
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              disabled={isDisabled}
            />
          )
        case 'oauth-input':
          return <CredentialSelector blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'file-selector':
          return <FileSelectorInput blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'project-selector':
          return <ProjectSelectorInput blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'folder-selector':
          return <FolderSelectorInput blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'knowledge-base-selector':
          return <KnowledgeBaseSelector blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'knowledge-tag-filters':
          return (
            <KnowledgeTagFilters
              blockId={blockId}
              subBlock={config}
              disabled={isDisabled}
              isConnecting={isConnecting}
            />
          )

        case 'document-tag-entry':
          return (
            <DocumentTagEntry
              blockId={blockId}
              subBlock={config}
              disabled={isDisabled}
              isConnecting={isConnecting}
            />
          )
        case 'document-selector':
          return <DocumentSelector blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'input-format': {
          return (
            <InputFormat
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              isConnecting={isConnecting}
              config={config}
              showValue={true}
            />
          )
        }
        case 'input-mapping': {
          return (
            <InputMapping
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              isConnecting={isConnecting}
            />
          )
        }
        case 'variables-input': {
          return (
            <VariablesInput
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              isConnecting={isConnecting}
            />
          )
        }
        case 'response-format':
          return (
            <ResponseFormat
              blockId={blockId}
              subBlockId={config.id}
              isConnecting={isConnecting}
              config={config}
              disabled={isDisabled}
            />
          )
        case 'channel-selector':
          return <ChannelSelectorInput blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'mcp-server-selector':
          return <McpServerSelector blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'mcp-tool-selector':
          return <McpToolSelector blockId={blockId} subBlock={config} disabled={isDisabled} />
        case 'mcp-dynamic-args':
          return (
            <McpDynamicArgs
              blockId={blockId}
              subBlockId={config.id}
              disabled={isDisabled}
              isConnecting={isConnecting}
            />
          )
        case 'text':
          return (
            <Text
              blockId={blockId}
              subBlockId={config.id}
              content={
                typeof config.value === 'function'
                  ? config.value({})
                  : (config.defaultValue as string) || ''
              }
            />
          )
        case 'trigger-save':
          return (
            <TriggerSave
              blockId={blockId}
              subBlockId={config.id}
              triggerId={config.triggerId}
              disabled={isDisabled}
            />
          )
        default:
          return <div>Unknown input type: {config.type}</div>
      }
    }

    const required = isFieldRequired()

    const showLabel =
      Boolean(config.title) &&
      config.type !== 'switch' &&
      config.type !== 'market-selector' &&
      config.type !== 'order-id-selector' &&
      config.type !== 'trigger-save'

    return (
      <div className={cn('space-y-[6px] pt-[2px]')} onMouseDown={handleMouseDown}>
        {showLabel && (
          <Label className='flex items-center gap-1'>
            {config.title}
            {required && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='cursor-help text-red-500'>*</span>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  <p>This field is required</p>
                </TooltipContent>
              </Tooltip>
            )}
            {config.id === 'responseFormat' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle
                    className={cn(
                      'h-4 w-4 cursor-pointer text-destructive',
                      !isValidJson ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side='top'>
                  <p>Invalid JSON</p>
                </TooltipContent>
              </Tooltip>
            )}
            {(config.tooltip || config.description) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
                </TooltipTrigger>
                <TooltipContent
                  side='top'
                  className='max-w-[400px] select-text whitespace-pre-wrap'
                >
                  {(config.tooltip || config.description || '').split('\n').map((line, idx) => (
                    <p
                      key={idx}
                      className={idx === 0 ? 'mb-1 text-sm' : 'text-muted-foreground text-xs'}
                    >
                      {line}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            )}
          </Label>
        )}
        {renderInput()}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison to prevent unnecessary re-renders
    return (
      prevProps.blockId === nextProps.blockId &&
      prevProps.config === nextProps.config &&
      prevProps.isConnecting === nextProps.isConnecting &&
      prevProps.disabled === nextProps.disabled
    )
  }
)
