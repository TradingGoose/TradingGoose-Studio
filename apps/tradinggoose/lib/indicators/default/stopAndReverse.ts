/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { formatValue } from './utils/format'
import { createDefaultIndicator } from './create-default-indicator'

const stopAndReverse = createDefaultIndicator({
  id: 'SAR',
  name: 'Stop and Reverse',
  series: 'price',
  precision: 2,
  shouldOhlc: true,
  plots: [
    {
      key: 'sar',
      name: 'SAR',
      type: 'circle',
      overlay: true,
      figure: {
        styles: ({ data, indicator, defaultStyles }) => {
          const { current } = data
          const sar = current?.sar ?? Number.MIN_SAFE_INTEGER
          const halfHL = ((current?.high ?? 0) + (current?.low ?? 0)) / 2
          const color = sar < halfHL
            ? formatValue(indicator.styles, 'circles[0].upColor', (defaultStyles!.circles)[0].upColor) as string
            : formatValue(indicator.styles, 'circles[0].downColor', (defaultStyles!.circles)[0].downColor) as string
          return { color }
        },
      },
    },
  ],
  calc: (dataList) => {
    const startAfParam = 2
    const stepParam = 2
    const maxAfParam = 20
    const len = dataList.length
    const sarData = Array<number | null>(len).fill(null)
    const highData = Array<number | null>(len).fill(null)
    const lowData = Array<number | null>(len).fill(null)

    const startAf = startAfParam / 100
    const step = stepParam / 100
    const maxAf = maxAfParam / 100

    let af = startAf
    let ep = -100
    let isIncreasing = false
    let sar = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const preSar = sar
      const high = kLineData.high
      const low = kLineData.low
      highData[i] = high
      lowData[i] = low
      if (isIncreasing) {
        if (ep === -100 || ep < high) {
          ep = high
          af = Math.min(af + step, maxAf)
        }
        sar = preSar + af * (ep - preSar)
        const lowMin = Math.min(dataList[Math.max(1, i) - 1].low, low)
        if (sar > kLineData.low) {
          sar = ep
          af = startAf
          ep = -100
          isIncreasing = !isIncreasing
        } else if (sar > lowMin) {
          sar = lowMin
        }
      } else {
        if (ep === -100 || ep > low) {
          ep = low
          af = Math.min(af + step, maxAf)
        }
        sar = preSar + af * (ep - preSar)
        const highMax = Math.max(dataList[Math.max(1, i) - 1].high, high)
        if (sar < kLineData.high) {
          sar = ep
          af = 0
          ep = -100
          isIncreasing = !isIncreasing
        } else if (sar < highMax) {
          sar = highMax
        }
      }
      sarData[i] = sar
    }

    return {
      plots: [
        { key: 'sar', name: 'SAR', data: sarData, type: 'circle', overlay: true },
        { key: 'high', data: highData },
        { key: 'low', data: lowData },
      ],
    }
  },
})

export default stopAndReverse
