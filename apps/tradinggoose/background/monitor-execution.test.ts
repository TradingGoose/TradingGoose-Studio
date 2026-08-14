/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { isMonitorExecutionPayload } from './monitor-execution'

describe('isMonitorExecutionPayload', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects inherited source %s', (source) => {
    expect(isMonitorExecutionPayload({ source })).toBe(false)
  })
})
