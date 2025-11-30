const LOG_LEVEL = (process.env.COPILOT_LOG_LEVEL || 'debug').toLowerCase()

const shouldLog = (level: 'debug' | 'info' | 'warn' | 'error') => {
  const order = ['debug', 'info', 'warn', 'error']
  return order.indexOf(level) >= order.indexOf(LOG_LEVEL)
}

export const log = {
  debug: (...args: any[]) => shouldLog('debug') && console.debug('[copilot]', ...args),
  info: (...args: any[]) => shouldLog('info') && console.info('[copilot]', ...args),
  warn: (...args: any[]) => shouldLog('warn') && console.warn('[copilot]', ...args),
  error: (...args: any[]) => shouldLog('error') && console.error('[copilot]', ...args),
}

export { LOG_LEVEL }
