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

import { createDefaultIndicator } from './create-default-indicator'

/**
 */
const exponentialMovingAverage = createDefaultIndicator({
  id: 'EMA',
  name: 'Exponential Moving Average',
  series: 'price',
  precision: 2,
  shouldOhlc: true,
  plots: [
    { key: 'ema1', name: 'EMA6', type: 'line', overlay: true },
    { key: 'ema2', name: 'EMA12', type: 'line', overlay: true },
    { key: 'ema3', name: 'EMA20', type: 'line', overlay: true },
  ],
  calc: (dataList) => {
    const params = [6, 12, 20]
    const len = dataList.length
    const emaData = params.map(() => Array<number | null>(len).fill(null))
    const emaValues: number[] = []
    let closeSum = 0

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum += close
      for (let index = 0; index < params.length; index += 1) {
        const p = params[index]
        if (i >= p - 1) {
          if (i > p - 1) {
            emaValues[index] = (2 * close + (p - 1) * emaValues[index]) / (p + 1)
          } else {
            emaValues[index] = closeSum / p
          }
          emaData[index][i] = emaValues[index]
        }
      }
    }

    return {
      plots: [
        { key: 'ema1', name: 'EMA6', data: emaData[0], type: 'line', overlay: true },
        { key: 'ema2', name: 'EMA12', data: emaData[1], type: 'line', overlay: true },
        { key: 'ema3', name: 'EMA20', data: emaData[2], type: 'line', overlay: true },
      ],
    }
  },
})

export default exponentialMovingAverage
