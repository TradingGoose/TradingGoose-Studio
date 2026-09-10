import { KronosSignalPolicy, type SignalPolicyConfig, type SignalPolicyInput } from './signal-policy'

export interface PaperRiskConfig {
  /** Maximum number of units to hold per symbol. */
  maxQuantityPerSymbol: number
  /** Maximum gross exposure (sum of abs(quantity) across symbols). */
  maxGrossExposure: number
  /** Maximum net exposure (sum of signed quantities). */
  maxNetExposure: number
  /** Maximum number of orders per hour. */
  maxOrdersPerHour: number
  /** Cooldown in ms after an order or rejected signal. */
  cooldownMs: number
  /** Daily loss limit as a fraction of starting capital. */
  dailyLossLimitFraction: number
  /** Starting capital for the paper account. */
  startingCapital: number
}

export const DEFAULT_PAPER_RISK_CONFIG: PaperRiskConfig = {
  maxQuantityPerSymbol: 100,
  maxGrossExposure: 300,
  maxNetExposure: 150,
  maxOrdersPerHour: 6,
  cooldownMs: 5 * 60_000,
  dailyLossLimitFraction: 0.02,
  startingCapital: 100_000,
}

export interface RiskCheckInput {
  action: 'buy' | 'sell'
  quantity: number
  symbol: string
  currentPositions: Map<string, number>
  orderHistory: Array<{ timestamp: number; side: 'buy' | 'sell'; quantity: number }>
  lastSignalAt: number | null
  dailyPnL: number
}

export interface RiskCheckResult {
  approved: boolean
  reason: string
  adjustedQuantity?: number
}

export class PaperRiskManager {
  private config: PaperRiskConfig

  constructor(config: Partial<PaperRiskConfig> = {}) {
    this.config = { ...DEFAULT_PAPER_RISK_CONFIG, ...config }
  }

  check(input: RiskCheckInput): RiskCheckResult {
    const {
      action,
      quantity,
      symbol,
      currentPositions,
      orderHistory,
      lastSignalAt,
      dailyPnL,
    } = input

    const {
      maxQuantityPerSymbol,
      maxGrossExposure,
      maxNetExposure,
      maxOrdersPerHour,
      cooldownMs,
      dailyLossLimitFraction,
      startingCapital,
    } = this.config

    // Daily loss limit
    if (dailyPnL < -startingCapital * dailyLossLimitFraction) {
      return {
        approved: false,
        reason: `Daily loss limit reached: ${dailyPnL.toFixed(2)} < ${(
          -startingCapital * dailyLossLimitFraction
        ).toFixed(2)}`,
      }
    }

    // Cooldown
    if (lastSignalAt !== null && Date.now() - lastSignalAt < cooldownMs) {
      return {
        approved: false,
        reason: `Cooldown active: ${Math.ceil(
          (cooldownMs - (Date.now() - lastSignalAt)) / 1000
        )}s remaining`,
      }
    }

    // Orders per hour
    const oneHourAgo = Date.now() - 3_600_000
    const recentOrders = orderHistory.filter((o) => o.timestamp > oneHourAgo).length
    if (recentOrders >= maxOrdersPerHour) {
      return {
        approved: false,
        reason: `Orders per hour limit reached: ${recentOrders} >= ${maxOrdersPerHour}`,
      }
    }

    // Calculate new position for the symbol
    const currentSymbolQty = currentPositions.get(symbol) ?? 0
    const delta = action === 'buy' ? quantity : -quantity
    const newSymbolQty = currentSymbolQty + delta

    // Per-symbol quantity check
    if (Math.abs(newSymbolQty) > maxQuantityPerSymbol) {
      const room = maxQuantityPerSymbol - Math.abs(currentSymbolQty)
      if (room <= 0) {
        return {
          approved: false,
          reason: `Per-symbol limit reached: ${symbol} at ${currentSymbolQty}`,
        }
      }
      if (Math.abs(delta) > room) {
        return {
          approved: true,
          reason: `Quantity adjusted to ${room} due to per-symbol limit`,
          adjustedQuantity: room,
        }
      }
    }

    // Build the new positions map
    const newPositions = new Map(currentPositions)
    newPositions.set(symbol, newSymbolQty)

    // Gross exposure check
    let grossExposure = 0
    for (const qty of newPositions.values()) {
      grossExposure += Math.abs(qty)
    }
    if (grossExposure > maxGrossExposure) {
      return {
        approved: false,
        reason: `Gross exposure limit reached: ${grossExposure} > ${maxGrossExposure}`,
      }
    }

    // Net exposure check
    let netExposure = 0
    for (const qty of newPositions.values()) {
      netExposure += qty
    }
    if (Math.abs(netExposure) > maxNetExposure) {
      return {
        approved: false,
        reason: `Net exposure limit reached: ${netExposure} > ${maxNetExposure}`,
      }
    }

    return { approved: true, reason: 'Risk checks passed' }
  }
}

export function deriveForecastSignalInput(args: {
  lastClose: number
  predictedClose: number
  predictedPath: Array<{ high: number; low: number }>
  realizedVolatilityAnnualized: number
  currentPositionSide: 'long' | 'short' | 'flat'
  currentPositionQuantity: number
}): SignalPolicyInput {
  const {
    lastClose,
    predictedClose,
    predictedPath,
    realizedVolatilityAnnualized,
    currentPositionSide,
    currentPositionQuantity,
  } = args
  const terminalReturn = lastClose > 0 ? (predictedClose - lastClose) / lastClose : 0

  let maxDrawdown = 0
  for (const bar of predictedPath) {
    if (lastClose > 0) {
      const drawdown = (lastClose - bar.low) / lastClose
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }
  }

  return {
    forecastTerminalReturn: terminalReturn,
    predictedPathDrawdown: maxDrawdown,
    realizedVolatilityAnnualized,
    currentPositionSide,
    currentPositionQuantity,
  }
}

export type { SignalPolicyConfig, SignalPolicyInput }
