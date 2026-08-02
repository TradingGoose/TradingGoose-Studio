'use client'

import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  getListingDisplaySymbol,
  ListingDisplayRow,
} from '@/components/listing-selector/listing/row'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  buildListingDisplayOption,
  getListingIdentityKey,
  type ListingOption,
  toListingValueObject,
} from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'
import {
  buildPreviewSummaryRows,
  formatSubBlockSummaryValue,
  type PreviewSummaryJsonRow,
  type PreviewSummaryRowData,
  type PreviewSummaryConditionRow as SubBlockSummaryConditionRow,
} from './preview-summary'

export type { SubBlockSummaryConditionRow }

interface SubBlockSummaryRowsProps {
  blockId: string
  blockType?: string
  subBlocks: SubBlockConfig[]
  stateToUse: Record<string, any>
  conditionRows?: SubBlockSummaryConditionRow[]
  showErrorRow?: boolean
  availableTriggerIds?: string[]
  labelClassName?: string
  valueClassName?: string
}

function SummaryTooltip({ content, children }: { content?: string; children: ReactElement }) {
  const tooltipContent = content?.trim()

  if (!tooltipContent) {
    return children
  }

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side='top'>
        <span className='block max-w-[320px] whitespace-normal break-words text-left'>
          {tooltipContent}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function SummaryRow({
  title,
  value,
  valueTitle,
  labelClassName,
  valueClassName,
}: {
  title: string
  value: ReactNode
  valueTitle?: string
  labelClassName?: string
  valueClassName?: string
}) {
  const isTextValue = typeof value === 'string'

  return (
    <div className='flex items-center gap-8'>
      <SummaryTooltip content={title}>
        <p className={cn('min-w-0 truncate text-muted-foreground capitalize', labelClassName)}>
          {title}
        </p>
      </SummaryTooltip>
      <SummaryTooltip content={valueTitle ?? (isTextValue ? value : undefined)}>
        <div className={cn('min-w-0 flex-1', isTextValue && 'truncate text-right', valueClassName)}>
          {value}
        </div>
      </SummaryTooltip>
    </div>
  )
}

function SummaryJsonRow({
  row,
  labelClassName,
  valueClassName,
}: {
  row: PreviewSummaryJsonRow
  labelClassName?: string
  valueClassName?: string
}) {
  return (
    <div className='flex flex-col gap-1'>
      <SummaryTooltip content={row.title}>
        <p className={cn('min-w-0 truncate text-muted-foreground capitalize', labelClassName)}>
          {row.title}
        </p>
      </SummaryTooltip>
      <div className='ml-3 overflow-hidden rounded-md border border-border bg-background'>
        {row.rows.map((jsonRow, index) => (
          <div
            key={`${row.id}-json-row-${index}`}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5',
              index > 0 && 'border-border border-t'
            )}
          >
            <SummaryTooltip content={jsonRow.title}>
              <p className={cn('min-w-0 truncate text-muted-foreground', labelClassName)}>
                {jsonRow.title}
              </p>
            </SummaryTooltip>
            <SummaryTooltip content={jsonRow.value}>
              <p className={cn('min-w-0 flex-1 truncate text-right', valueClassName)}>
                {jsonRow.value}
              </p>
            </SummaryTooltip>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryListingRow({
  title,
  value,
  objectItemLabel,
  labelClassName,
  valueClassName,
}: {
  title: string
  value: unknown
  objectItemLabel: string
  labelClassName?: string
  valueClassName?: string
}) {
  const identity = useMemo(() => toListingValueObject(value), [value])
  const valueListing =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as ListingOption) : null
  const [resolvedListing, setResolvedListing] = useState<ListingOption | null>(null)

  useEffect(() => {
    setResolvedListing(null)
    if (!identity) return

    let cancelled = false
    requestListingResolution(identity)
      .then((resolved) => {
        if (cancelled) return
        setResolvedListing(resolved ? buildListingDisplayOption(identity, resolved) : null)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [identity])

  if (!identity) {
    return (
      <SummaryRow
        title={title}
        value={formatSubBlockSummaryValue(value, objectItemLabel)}
        labelClassName={labelClassName}
        valueClassName={valueClassName}
      />
    )
  }

  const displayListing = buildListingDisplayOption(identity, resolvedListing ?? valueListing)
  const displayTitle = getListingDisplaySymbol(displayListing)

  return (
    <SummaryRow
      title={title}
      value={<ListingDisplayRow listing={displayListing} className='justify-end' />}
      valueTitle={displayTitle || getListingIdentityKey(identity)}
      labelClassName={labelClassName}
      valueClassName={valueClassName}
    />
  )
}

export function PrecomputedSubBlockSummaryRows({
  rows,
  objectItemLabel,
  labelClassName,
  valueClassName,
}: {
  rows: PreviewSummaryRowData[]
  objectItemLabel: string
  labelClassName?: string
  valueClassName?: string
}) {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'json') {
          return (
            <SummaryJsonRow
              key={row.id}
              row={row}
              labelClassName={labelClassName}
              valueClassName={valueClassName}
            />
          )
        }

        if (row.kind === 'listing') {
          return (
            <SummaryListingRow
              key={row.id}
              title={row.title}
              value={row.rawValue}
              objectItemLabel={objectItemLabel}
              labelClassName={labelClassName}
              valueClassName={valueClassName}
            />
          )
        }

        return (
          <SummaryRow
            key={row.id}
            title={row.title}
            value={row.value}
            labelClassName={labelClassName}
            valueClassName={valueClassName}
          />
        )
      })}
    </>
  )
}

export function SubBlockSummaryRows({
  blockId,
  blockType,
  subBlocks,
  stateToUse,
  conditionRows,
  showErrorRow = false,
  availableTriggerIds,
  labelClassName,
  valueClassName,
}: SubBlockSummaryRowsProps) {
  const {
    workflowEditorCopy,
    workflowLabelsCopy: labels,
    localizeWorkflowSubBlockConfig,
    resolveWorkflowDisplayValue,
  } = useWorkflowI18n()
  const objectItemLabel = workflowEditorCopy.summary.objectItem
  const additionalCountTemplate = workflowEditorCopy.summary.additionalCount
  const rows = buildPreviewSummaryRows({
    blockId,
    subBlocks: subBlocks.map((subBlock) => localizeWorkflowSubBlockConfig(subBlock, blockType)),
    stateToUse,
    conditionRows,
    showErrorRow,
    availableTriggerIds,
    labels,
    objectItemLabel,
    additionalCountTemplate,
    blockType,
    resolveDisplayValue: resolveWorkflowDisplayValue,
  })

  return (
    <PrecomputedSubBlockSummaryRows
      rows={rows}
      objectItemLabel={objectItemLabel}
      labelClassName={labelClassName}
      valueClassName={valueClassName}
    />
  )
}
