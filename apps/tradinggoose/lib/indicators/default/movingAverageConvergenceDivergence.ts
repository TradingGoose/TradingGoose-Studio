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

/**
 */
const movingAverageConvergenceDivergence = createDefaultIndicator({
  id: 'MACD',
  name: 'Moving Average Convergence Divergence',
  plots: [
    { key: 'dif', name: 'DIF', type: 'line', overlay: false },
    { key: 'dea', name: 'DEA', type: 'line', overlay: false },
    {
      key: 'macd',
      name: 'MACD',
      type: 'bar',
      overlay: false,
      figure: {
        baseValue: 0,
        styles: ({ data, indicator, defaultStyles }) => {
          const { prev, current } = data
          const prevMacd = prev?.macd ?? Number.MIN_SAFE_INTEGER
          const currentMacd = current?.macd ?? Number.MIN_SAFE_INTEGER
          let color = ''
          if (currentMacd > 0) {
            color = formatValue(indicator.styles, 'bars[0].upColor', (defaultStyles!.bars)[0].upColor) as string
          } else if (currentMacd < 0) {
            color = formatValue(indicator.styles, 'bars[0].downColor', (defaultStyles!.bars)[0].downColor) as string
          } else {
            color = formatValue(indicator.styles, 'bars[0].noChangeColor', (defaultStyles!.bars)[0].noChangeColor) as string
          }
          const style = prevMacd < currentMacd ? 'stroke' : 'fill'
          return { style, color, borderColor: color }
        },
      },
    },
  ],
  calc: (dataList) => {
    const shortPeriod = 12
    const longPeriod = 26
    const signalPeriod = 9
    const len = dataList.length
    const difData = Array<number | null>(len).fill(null)
    const deaData = Array<number | null>(len).fill(null)
    const macdData = Array<number | null>(len).fill(null)

    let closeSum = 0
    let emaShort = 0
    let emaLong = 0
    let dif = 0
    let difSum = 0
    let dea = 0
    const maxPeriod = Math.max(shortPeriod, longPeriod)

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum += close
      if (i >= shortPeriod - 1) {
        if (i > shortPeriod - 1) {
          emaShort = (2 * close + (shortPeriod - 1) * emaShort) / (shortPeriod + 1)
        } else {
          emaShort = closeSum / shortPeriod
        }
      }
      if (i >= longPeriod - 1) {
        if (i > longPeriod - 1) {
          emaLong = (2 * close + (longPeriod - 1) * emaLong) / (longPeriod + 1)
        } else {
          emaLong = closeSum / longPeriod
        }
      }
      if (i >= maxPeriod - 1) {
        dif = emaShort - emaLong
        difData[i] = dif
        difSum += dif
        if (i >= maxPeriod + signalPeriod - 2) {
          if (i > maxPeriod + signalPeriod - 2) {
            dea = (dif * 2 + dea * (signalPeriod - 1)) / (signalPeriod + 1)
          } else {
            dea = difSum / signalPeriod
          }
          deaData[i] = dea
          macdData[i] = (dif - dea) * 2
        }
      }
    }

    return {
      plots: [
        { key: 'dif', name: 'DIF', data: difData, type: 'line', overlay: false },
        { key: 'dea', name: 'DEA', data: deaData, type: 'line', overlay: false },
        { key: 'macd', name: 'MACD', data: macdData, type: 'bar', overlay: false },
      ],
    }
  },
})

export default movingAverageConvergenceDivergence
