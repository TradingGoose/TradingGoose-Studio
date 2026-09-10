export type SignalAction = 'buy' | 'sell' | 'no_trade'

export interface SignalPolicyConfig {
  /** Minimum forecast terminal return (fraction, e.g. 0.005 = 0.5%) to trigger a trade. */
  minTerminalReturn: number
  /** Maximum predicted path drawdown (fraction) beyond which we stand aside. */
  maxPredictedDrawdown: number
  /** Realized annualized volatility above which we stand aside. */
  maxRealizedVolatility: number
  /** When true, reduce position when already holding the same side. */
  allowFlip: boolean
}

export interface SignalPolicyInput {
  forecastTerminalReturn: number
  predictedPathDrawdown: number
  realizedVolatilityAnnualized: number
  currentPositionSide: 'long' | 'short' | 'flat'
  currentPositionQuantity: number
}

export interface SignalPolicyResult {
  action: SignalAction
  reason: string
  expiresAt: string
  metadata: {
    terminalReturn: number
    predictedDrawdown: number
    realizedVolatility: number
    score: number
  }
}

export const DEFAULT_SIGNAL_POLICY_CONFIG: SignalPolicyConfig = {
  minTerminalReturn: 0.005,
  maxPredictedDrawdown: 0.02,
  maxRealizedVolatility: 0.6,
  allowFlip: true,
}

export class KronosSignalPolicy {
  private config: SignalPolicyConfig

  constructor(config: Partial<SignalPolicyConfig> = {}) {
    this.config = { ...DEFAULT_SIGNAL_POLICY_CONFIG, ...config }
  }

  evaluate(input: SignalPolicyInput): SignalPolicyResult {
    const {
      forecastTerminalReturn,
      predictedPathDrawdown,
      realizedVolatilityAnnualized,
      currentPositionSide,
      currentPositionQuantity,
    } = input

    const { minTerminalReturn, maxPredictedDrawdown, maxRealizedVolatility, allowFlip } =
      this.config

    const absReturn = Math.abs(forecastTerminalReturn)
    const direction: SignalAction =
      forecastTerminalReturn > 0 ? 'buy' : forecastTerminalReturn < 0 ? 'sell' : 'no_trade'

    let score = absReturn
    const reasons: string[] = []

    // Volatility gate
    if (realizedVolatilityAnnualized > maxRealizedVolatility) {
      return this.noTrade(
        input,
        score,
        `Realized volatility ${realizedVolatilityAnnualized.toFixed(3)} exceeds limit ${maxRealizedVolatility}`
      )
    }

    // Predicted drawdown gate
    if (predictedPathDrawdown > maxPredictedDrawdown) {
      return this.noTrade(
        input,
        score,
        `Predicted drawdown ${predictedPathDrawdown.toFixed(4)} exceeds limit ${maxPredictedDrawdown}`
      )
    }

    // Minimum return threshold
    if (absReturn < minTerminalReturn) {
      return this.noTrade(
        input,
        score,
        `Forecast terminal return ${absReturn.toFixed(4)} below threshold ${minTerminalReturn}`
      )
    }

    // Already holding the same side
    if (
      currentPositionSide !== 'flat' &&
      ((direction === 'buy' && currentPositionSide === 'long') ||
        (direction === 'sell' && currentPositionSide === 'short'))
    ) {
      return this.noTrade(input, score, `Already ${currentPositionSide} ${direction === 'buy' ? 'long' : 'short'}`)
    }

    // Flip check
    if (
      !allowFlip &&
      currentPositionSide !== 'flat' &&
      ((direction === 'buy' && currentPositionSide === 'short') ||
        (direction === 'sell' && currentPositionSide === 'long'))
    ) {
      return this.noTrade(input, score, `Flip from ${currentPositionSide} to ${direction} not allowed`)
    }

    reasons.push(`terminal_return=${absReturn.toFixed(4)}`)
    reasons.push(`predicted_drawdown=${predictedPathDrawdown.toFixed(4)}`)
    reasons.push(`realized_vol=${realizedVolatilityAnnualized.toFixed(3)}`)

    return {
      action: direction,
      reason: reasons.join(' '),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      metadata: {
        terminalReturn: forecastTerminalReturn,
        predictedDrawdown: predictedPathDrawdown,
        realizedVolatility: realizedVolatilityAnnualized,
        score,
      },
    }
  }

  private noTrade(
    input: SignalPolicyInput,
    score: number,
    reason: string
  ): SignalPolicyResult {
    return {
      action: 'no_trade',
      reason,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {
        terminalReturn: input.forecastTerminalReturn,
        predictedDrawdown: input.predictedPathDrawdown,
        realizedVolatility: input.realizedVolatilityAnnualized,
        score,
      },
    }
  }
}
