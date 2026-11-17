import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { normalizeIndicatorCode } from '@/lib/indicators/normalize-indicator-code'
import type { BarMs } from '@/lib/indicators/types'
import { buildPineTSE2BSingleIndicatorScript } from './e2b-script-builder'

it('isolates triggers and warnings across evaluations in one warm E2B process', () => {
  const bars: BarMs[] = [
    { openTime: 1_000, closeTime: 2_000, open: 1, high: 2, low: 1, close: 2, volume: 100 },
    { openTime: 2_000, closeTime: 3_000, open: 2, high: 3, low: 2, close: 3, volume: 120 },
  ]
  const cases = [
    { event: 'first', bars },
    { event: 'first', bars },
    {
      event: 'second',
      bars: bars.map((bar) => ({
        ...bar,
        openTime: bar.openTime + 10_000,
        closeTime: bar.closeTime + 10_000,
      })),
    },
    { event: 'inactive', bars, condition: 'close < open' },
    { event: 'invalid', bars, input: '   ' },
    { event: 'parallel_first', bars },
    { event: 'parallel_second', bars },
  ]
  const scripts = cases.map(({ event, bars, condition = 'close > open', input = event }) => {
    const normalized = normalizeIndicatorCode(
      `trigger('${event}', { condition: ${condition}, signal: 'long', input: '${input}' });`
    )
    expect(normalized.error).toBeUndefined()
    return buildPineTSE2BSingleIndicatorScript({
      normalizedCode: normalized.code,
      barsMs: bars,
      inputsMap: {},
    })
  })

  // Keep native ESM imports and PineTS's prototype alive between all evaluations.
  const stdout = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs';
       import net from 'node:net';
       net.Socket.prototype.connect = () => { throw new Error('Unexpected network access'); };
       globalThis.fetch = async () => { throw new Error('Unexpected fetch'); };
       const [sequential, parallel] = JSON.parse(fs.readFileSync(0, 'utf8'));
       for (const code of sequential) await eval(code);
       await Promise.all(parallel.map((code) => eval(code)));`,
    ],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      input: JSON.stringify([scripts.slice(0, 5), scripts.slice(5)]),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
      timeout: 10_000,
    }
  )
  const results = stdout
    .split('\n')
    .filter((line) => line.startsWith('__TG_RESULT__='))
    .map((line) => JSON.parse(line.slice('__TG_RESULT__='.length)))

  expect(results).toHaveLength(cases.length)
  for (const [index, event, times] of [
    [0, 'first', [1, 2]],
    [1, 'first', [1, 2]],
    [2, 'second', [11, 12]],
  ] as const) {
    expect(results[index].triggerSignals).toEqual(
      times.map((time) => expect.objectContaining({ event, input: event, time }))
    )
    expect(results[index].triggerWarnings).toEqual([])
  }
  expect(results[3]).toMatchObject({ triggerSignals: [], triggerWarnings: [] })
  expect(results[4].triggerSignals).toEqual([])
  expect(results[4].triggerWarnings).toEqual([
    expect.objectContaining({ code: 'indicator_trigger_invalid_input' }),
    expect.objectContaining({ code: 'indicator_trigger_invalid_input' }),
  ])
  expect(results.slice(5)).toEqual(
    expect.arrayContaining(
      ['parallel_first', 'parallel_second'].map((event) =>
        expect.objectContaining({
          triggerSignals: [1, 2].map((time) =>
            expect.objectContaining({ event, input: event, time })
          ),
          triggerWarnings: [],
        })
      )
    )
  )
})
