/** @vitest-environment node */

import { afterEach, expect, it, vi } from 'vitest'
import { resolveMarketHours, resolveMarketHoursRange } from './market-hours-api'
import { resolveMarketSessionsForRange } from './sessions'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/market/client', () => ({ marketClient: { makeRequest: request } }))
afterEach(() => request.mockReset())

it.each([
  ['2026-07-06', '-04:00', '16:00', false, '2026-07-06T20:00:00.000Z'],
  ['2026-11-27', '-05:00', '13:00', false, '2026-11-27T18:00:00.000Z'],
  ['2026-07-03', '-04:00', '16:00', true, null],
] as const)(
  'reads canonical Market hours for %s',
  async (date, utcOffset, end, isHoliday, close) => {
    const raw = {
      isHoliday,
      timeZone: { name: 'America/New_York', utcOffset },
      marketHors: {
        premarket: null,
        market: isHoliday ? null : { start: '09:30', end },
        postmarket: null,
      },
    }
    const normalized = { isHoliday, timeZone: raw.timeZone, marketHours: raw.marketHors }
    request.mockResolvedValueOnce({ success: true, data: { data: raw } })
    expect(await resolveMarketHours('AAPL', 'default', new Date(date))).toEqual(normalized)
    request.mockResolvedValue({ success: true, data: { data: { [date]: raw } } })
    expect(
      await resolveMarketHoursRange('AAPL', 'default', new Date(date), new Date(date))
    ).toEqual(new Map([[date, normalized]]))
    const sessions = await resolveMarketSessionsForRange(
      'AAPL',
      'default',
      Date.parse(date),
      Date.parse(date) + 86_400_000
    )
    expect(sessions).toEqual(close ? [expect.objectContaining({ type: 'market', end: close })] : [])
  }
)

it.each([false, true])(
  'distinguishes empty Market results from failures (success=%s)',
  async (success) => {
    request.mockResolvedValue({ success, data: { data: {} } })
    const date = new Date('2026-07-06')
    expect(await resolveMarketHours('AAPL', 'default', date)).toBeNull()
    expect(await resolveMarketHoursRange('AAPL', 'default', date, date)).toEqual(
      success ? new Map() : null
    )
  }
)
