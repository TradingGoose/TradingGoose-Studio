'use client'

import { useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import { toListingValue } from '@/lib/listing/identity'
import {
  getPortfolioConditionOperatorsForMetric,
  isPortfolioConditionValuelessOperator,
  PORTFOLIO_CONDITION_METRICS,
  type PortfolioConditionGroup,
  type PortfolioConditionMetric,
  type PortfolioConditionNode,
  type PortfolioConditionOperator,
  type PortfolioConditionRule,
  type PortfolioFireCondition,
  portfolioConditionRequiresListing,
} from '@/lib/monitors/portfolio-conditions'
import { cn } from '@/lib/utils'
import { useListingSelectorStore } from '@/stores/market/selector/store'

type PortfolioConditionBuilderProps = {
  condition: PortfolioFireCondition
  disabled?: boolean
  error?: string
  tradingProviderId?: string
  onChange: (condition: PortfolioFireCondition) => void
}

const METRIC_LABELS: Record<PortfolioConditionMetric, string> = {
  'summary.totalPortfolioValue': 'Total portfolio value',
  'summary.totalCashValue': 'Cash value',
  'summary.totalHoldingsValue': 'Holdings value',
  'summary.totalUnrealizedPnl': 'Unrealized P/L',
  'summary.buyingPower': 'Buying power',
  'summary.equity': 'Equity',
  'positions.count': 'Open position count',
  'positions.totalMarketValue': 'Positions market value',
  'positions.totalUnrealizedPnl': 'Positions unrealized P/L',
  'position.quantity': 'Position quantity',
  'position.marketValue': 'Position market value',
  'position.unrealizedPnl': 'Position unrealized P/L',
  'position.unrealizedPnlPercent': 'Position unrealized P/L %',
  'position.exists': 'Position exists',
}

const OPERATOR_LABELS: Record<PortfolioConditionOperator, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
  neq: '!=',
  crosses_above: 'Crosses above',
  crosses_below: 'Crosses below',
  changes_since_previous_by_abs: 'Changes since previous update',
  changes_since_previous_by_percent: 'Changes % since previous update',
  exists: 'Exists',
  not_exists: 'Does not exist',
}

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const createRule = (): PortfolioConditionRule => ({
  id: createId(),
  metric: 'summary.totalPortfolioValue',
  operator: 'gt',
  value: 0,
})

const createGroup = (): PortfolioConditionGroup => ({
  id: createId(),
  combinator: 'and',
  rules: [createRule()],
})

const isGroup = (node: PortfolioConditionNode): node is PortfolioConditionGroup =>
  Array.isArray((node as PortfolioConditionGroup).rules)

const normalizeRuleForMetric = (
  rule: PortfolioConditionRule,
  metric: PortfolioConditionMetric
): PortfolioConditionRule => {
  const operators = getPortfolioConditionOperatorsForMetric(metric)
  const operator = operators.includes(rule.operator) ? rule.operator : operators[0]!

  return {
    ...rule,
    metric,
    operator,
    ...(portfolioConditionRequiresListing(metric)
      ? { listing: rule.listing ?? null }
      : { listing: null }),
    ...(isPortfolioConditionValuelessOperator(operator)
      ? { value: null }
      : { value: rule.value ?? 0 }),
  }
}

const updateNodeAtPath = (
  group: PortfolioConditionGroup,
  path: number[],
  updater: (node: PortfolioConditionNode) => PortfolioConditionNode
): PortfolioConditionGroup => {
  if (path.length === 0) return updater(group) as PortfolioConditionGroup
  const [index, ...rest] = path

  return {
    ...group,
    rules: group.rules.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node
      if (rest.length === 0) return updater(node)
      return isGroup(node) ? updateNodeAtPath(node, rest, updater) : node
    }),
  }
}

const removeNodeAtPath = (
  group: PortfolioConditionGroup,
  path: number[]
): PortfolioConditionGroup => {
  const [index, ...rest] = path
  if (index === undefined) return group

  if (rest.length === 0) {
    const nextRules = group.rules.filter((_, nodeIndex) => nodeIndex !== index)
    return { ...group, rules: nextRules.length > 0 ? nextRules : [createRule()] }
  }

  return {
    ...group,
    rules: group.rules.map((node, nodeIndex) =>
      nodeIndex === index && isGroup(node) ? removeNodeAtPath(node, rest) : node
    ),
  }
}

export function PortfolioConditionBuilder({
  condition,
  disabled = false,
  error,
  tradingProviderId,
  onChange,
}: PortfolioConditionBuilderProps) {
  const root = condition.root?.rules?.length ? condition.root : createGroup()
  const updateRoot = (nextRoot: PortfolioConditionGroup) => onChange({ root: nextRoot })

  return (
    <div className='space-y-2'>
      <Label className='text-muted-foreground text-xs'>Fire conditions</Label>
      <ConditionGroupEditor
        group={root}
        path={[]}
        disabled={disabled}
        tradingProviderId={tradingProviderId}
        onUpdate={(path, updater) => updateRoot(updateNodeAtPath(root, path, updater))}
        onRemove={(path) => updateRoot(removeNodeAtPath(root, path))}
      />
      {error ? <p className='text-[11px] text-destructive'>{error}</p> : null}
    </div>
  )
}

function ConditionGroupEditor({
  group,
  path,
  disabled,
  tradingProviderId,
  onUpdate,
  onRemove,
}: {
  group: PortfolioConditionGroup
  path: number[]
  disabled: boolean
  tradingProviderId?: string
  onUpdate: (
    path: number[],
    updater: (node: PortfolioConditionNode) => PortfolioConditionNode
  ) => void
  onRemove: (path: number[]) => void
}) {
  const addRule = () =>
    onUpdate(path, (node) =>
      isGroup(node) ? { ...node, rules: node.rules.concat(createRule()) } : node
    )
  const addGroup = () =>
    onUpdate(path, (node) =>
      isGroup(node) ? { ...node, rules: node.rules.concat(createGroup()) } : node
    )

  return (
    <div className={cn('space-y-2 rounded-md border p-2', path.length > 0 && 'bg-muted/20')}>
      <div className='flex items-center justify-between gap-2'>
        <Select
          value={group.combinator}
          disabled={disabled}
          onValueChange={(combinator: 'and' | 'or') =>
            onUpdate(path, (node) => (isGroup(node) ? { ...node, combinator } : node))
          }
        >
          <SelectTrigger className='h-8 w-24'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='and'>All</SelectItem>
            <SelectItem value='or'>Any</SelectItem>
          </SelectContent>
        </Select>

        <div className='flex items-center gap-1'>
          <Button type='button' variant='outline' size='sm' disabled={disabled} onClick={addRule}>
            <Plus className='mr-1 h-3.5 w-3.5' />
            Rule
          </Button>
          <Button type='button' variant='outline' size='sm' disabled={disabled} onClick={addGroup}>
            <Plus className='mr-1 h-3.5 w-3.5' />
            Group
          </Button>
          {path.length > 0 ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='h-8 w-8'
              disabled={disabled}
              onClick={() => onRemove(path)}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          ) : null}
        </div>
      </div>

      <div className='space-y-2'>
        {group.rules.map((node, index) =>
          isGroup(node) ? (
            <ConditionGroupEditor
              key={node.id ?? index}
              group={node}
              path={path.concat(index)}
              disabled={disabled}
              tradingProviderId={tradingProviderId}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ) : (
            <ConditionRuleEditor
              key={node.id ?? index}
              rule={node}
              path={path.concat(index)}
              disabled={disabled}
              tradingProviderId={tradingProviderId}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          )
        )}
      </div>
    </div>
  )
}

function ConditionRuleEditor({
  rule,
  path,
  disabled,
  tradingProviderId,
  onUpdate,
  onRemove,
}: {
  rule: PortfolioConditionRule
  path: number[]
  disabled: boolean
  tradingProviderId?: string
  onUpdate: (
    path: number[],
    updater: (node: PortfolioConditionNode) => PortfolioConditionNode
  ) => void
  onRemove: (path: number[]) => void
}) {
  const operators = getPortfolioConditionOperatorsForMetric(rule.metric)
  const showListing = portfolioConditionRequiresListing(rule.metric)
  const showValue = !isPortfolioConditionValuelessOperator(rule.operator)
  const ruleListingInstanceId = showListing
    ? `monitor-portfolio-condition-${rule.id ?? path.join('-')}`
    : null
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  useEffect(() => {
    if (!ruleListingInstanceId) return
    updateListingSelectorInstance(ruleListingInstanceId, {
      selectedListingValue: rule.listing ?? null,
      selectedListing: rule.listing as any,
      query: '',
      results: [],
      error: undefined,
    })
  }, [rule.listing, ruleListingInstanceId, updateListingSelectorInstance])

  return (
    <div
      className={cn(
        'grid gap-2 rounded-md border bg-background p-2',
        showListing && showValue
          ? 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,1.6fr)_minmax(0,0.6fr)_auto]'
          : 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto]'
      )}
    >
      <Select
        value={rule.metric}
        disabled={disabled}
        onValueChange={(metric: PortfolioConditionMetric) =>
          onUpdate(path, (node) => (isGroup(node) ? node : normalizeRuleForMetric(node, metric)))
        }
      >
        <SelectTrigger className='h-8'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PORTFOLIO_CONDITION_METRICS.map((metric) => (
            <SelectItem key={metric} value={metric}>
              {METRIC_LABELS[metric]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={rule.operator}
        disabled={disabled}
        onValueChange={(operator: PortfolioConditionOperator) =>
          onUpdate(path, (node) =>
            isGroup(node)
              ? node
              : {
                  ...node,
                  operator,
                  value: isPortfolioConditionValuelessOperator(operator) ? null : (node.value ?? 0),
                }
          )
        }
      >
        <SelectTrigger className='h-8'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showListing && ruleListingInstanceId ? (
        <ListingSearchInput
          instanceId={ruleListingInstanceId}
          providerType='trading'
          tradingProviderId={tradingProviderId}
          disabled={disabled}
          compact
          onListingChange={(listing) =>
            onUpdate(path, (node) =>
              isGroup(node) ? node : { ...node, listing: toListingValue(listing) }
            )
          }
          onListingValueChange={() =>
            onUpdate(path, (node) => (isGroup(node) ? node : { ...node, listing: null }))
          }
        />
      ) : null}
      {showValue ? (
        <Input
          value={typeof rule.value === 'number' || typeof rule.value === 'string' ? rule.value : ''}
          type='number'
          className='h-8'
          disabled={disabled}
          onChange={(event) =>
            onUpdate(path, (node) =>
              isGroup(node) ? node : { ...node, value: Number(event.target.value) }
            )
          }
        />
      ) : null}

      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8'
        disabled={disabled}
        onClick={() => onRemove(path)}
      >
        <Trash2 className='h-4 w-4' />
      </Button>
    </div>
  )
}
