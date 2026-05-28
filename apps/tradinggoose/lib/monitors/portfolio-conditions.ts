import {
  areListingIdentitiesEqual,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'

export const PORTFOLIO_CONDITION_METRICS = [
  'summary.totalPortfolioValue',
  'summary.totalCashValue',
  'summary.totalHoldingsValue',
  'summary.totalUnrealizedPnl',
  'summary.buyingPower',
  'summary.equity',
  'positions.count',
  'positions.totalMarketValue',
  'positions.totalUnrealizedPnl',
  'position.quantity',
  'position.marketValue',
  'position.unrealizedPnl',
  'position.unrealizedPnlPercent',
  'position.exists',
] as const

export const PORTFOLIO_CONDITION_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'crosses_above',
  'crosses_below',
  'changes_by_abs',
  'changes_by_percent',
  'exists',
  'not_exists',
] as const

export type PortfolioConditionMetric = (typeof PORTFOLIO_CONDITION_METRICS)[number]
export type PortfolioConditionOperator = (typeof PORTFOLIO_CONDITION_OPERATORS)[number]

export type PortfolioConditionRule = {
  id?: string
  metric: PortfolioConditionMetric
  operator: PortfolioConditionOperator
  value?: number | string | boolean | null
  listing?: ListingIdentity | null
}

export type PortfolioConditionGroup = {
  id?: string
  combinator: 'and' | 'or'
  rules: PortfolioConditionNode[]
}

export type PortfolioConditionNode = PortfolioConditionRule | PortfolioConditionGroup

export type PortfolioFireCondition = {
  root: PortfolioConditionGroup
}

type EvaluationContext = {
  current: PortfolioDetail
  previous?: PortfolioDetail | null
}

const isGroup = (node: PortfolioConditionNode): node is PortfolioConditionGroup =>
  Array.isArray((node as PortfolioConditionGroup).rules)

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const toTargetNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const portfolioConditionRequiresListing = (metric: PortfolioConditionMetric) =>
  metric.startsWith('position.')

export const isPortfolioConditionValuelessOperator = (operator: PortfolioConditionOperator) =>
  operator === 'exists' || operator === 'not_exists'

export const isPortfolioConditionOperatorCompatible = (
  metric: PortfolioConditionMetric,
  operator: PortfolioConditionOperator
) => isPortfolioConditionValuelessOperator(operator) === (metric === 'position.exists')

export const getPortfolioConditionOperatorsForMetric = (metric: PortfolioConditionMetric) =>
  PORTFOLIO_CONDITION_OPERATORS.filter((operator) =>
    isPortfolioConditionOperatorCompatible(metric, operator)
  )

const findPosition = (portfolio: PortfolioDetail, listingInput: unknown) => {
  const listing = toListingValueObject(listingInput)
  if (!listing) return null
  return (
    portfolio.positions.find((position) => {
      const positionListing = toListingValueObject(position.listingIdentity)
      return areListingIdentitiesEqual(positionListing, listing)
    }) ?? null
  )
}

const getMetricValue = (
  portfolio: PortfolioDetail | null | undefined,
  rule: PortfolioConditionRule
): number | boolean | null => {
  if (!portfolio) return null

  switch (rule.metric) {
    case 'summary.totalPortfolioValue':
      return toFiniteNumber(portfolio.summary.totalPortfolioValue)
    case 'summary.totalCashValue':
      return toFiniteNumber(portfolio.summary.totalCashValue)
    case 'summary.totalHoldingsValue':
      return toFiniteNumber(portfolio.summary.totalHoldingsValue)
    case 'summary.totalUnrealizedPnl':
      return toFiniteNumber(portfolio.summary.totalUnrealizedPnl)
    case 'summary.buyingPower':
      return toFiniteNumber(portfolio.summary.buyingPower)
    case 'summary.equity':
      return toFiniteNumber(portfolio.summary.equity)
    case 'positions.count':
      return portfolio.positions.length
    case 'positions.totalMarketValue':
      return portfolio.positions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0)
    case 'positions.totalUnrealizedPnl':
      return portfolio.positions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0)
    case 'position.quantity':
      return toFiniteNumber(findPosition(portfolio, rule.listing)?.quantity)
    case 'position.marketValue':
      return toFiniteNumber(findPosition(portfolio, rule.listing)?.marketValue)
    case 'position.unrealizedPnl':
      return toFiniteNumber(findPosition(portfolio, rule.listing)?.unrealizedPnl)
    case 'position.unrealizedPnlPercent':
      return toFiniteNumber(findPosition(portfolio, rule.listing)?.unrealizedPnlPercent)
    case 'position.exists':
      return Boolean(findPosition(portfolio, rule.listing))
  }
}

const evaluateRule = (rule: PortfolioConditionRule, context: EvaluationContext) => {
  if (!isPortfolioConditionOperatorCompatible(rule.metric, rule.operator)) return false
  if (portfolioConditionRequiresListing(rule.metric) && !toListingValueObject(rule.listing)) {
    return false
  }

  const currentValue = getMetricValue(context.current, rule)
  const previousValue = getMetricValue(context.previous, rule)

  if (rule.operator === 'exists') return currentValue === true
  if (rule.operator === 'not_exists') return currentValue === false

  const currentNumber = toFiniteNumber(currentValue)
  const previousNumber = toFiniteNumber(previousValue)
  const target = toTargetNumber(rule.value)

  if (currentNumber === null || target === null) return false

  switch (rule.operator) {
    case 'gt':
      return currentNumber > target
    case 'gte':
      return currentNumber >= target
    case 'lt':
      return currentNumber < target
    case 'lte':
      return currentNumber <= target
    case 'eq':
      return currentNumber === target
    case 'neq':
      return currentNumber !== target
    case 'crosses_above':
      return previousNumber !== null && previousNumber <= target && currentNumber > target
    case 'crosses_below':
      return previousNumber !== null && previousNumber >= target && currentNumber < target
    case 'changes_by_abs':
      return previousNumber !== null && Math.abs(currentNumber - previousNumber) >= Math.abs(target)
    case 'changes_by_percent':
      return (
        previousNumber !== null &&
        previousNumber !== 0 &&
        Math.abs(((currentNumber - previousNumber) / previousNumber) * 100) >= Math.abs(target)
      )
    default:
      return false
  }
}

const evaluateNode = (node: PortfolioConditionNode, context: EvaluationContext): boolean => {
  if (!isGroup(node)) return evaluateRule(node, context)
  if (node.rules.length === 0) return false

  return node.combinator === 'or'
    ? node.rules.some((rule) => evaluateNode(rule, context))
    : node.rules.every((rule) => evaluateNode(rule, context))
}

export const evaluatePortfolioFireCondition = ({
  condition,
  current,
  previous,
}: {
  condition: PortfolioFireCondition
  current: PortfolioDetail
  previous?: PortfolioDetail | null
}) => evaluateNode(condition.root, { current, previous })
