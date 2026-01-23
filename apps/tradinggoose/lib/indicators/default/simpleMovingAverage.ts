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
 * sma
 */
const simpleMovingAverage = createDefaultIndicator({
  id: 'SMA',
  name: 'Simple Moving Average',
  series: 'price',
  precision: 2,
  plots: [
    { key: 'sma', name: 'SMA', type: 'line', overlay: true },
  ],
  shouldOhlc: true,
  calc: (dataList) => {
    const period = 12
    const factor = 2
    const len = dataList.length
    const smaData = Array<number | null>(len).fill(null)

    let closeSum = 0
    let smaValue = 0

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum += close
      if (i >= period - 1) {
        if (i > period - 1) {
          smaValue = (close * factor + smaValue * (period - factor + 1)) / (period + 1)
        } else {
          smaValue = closeSum / period
        }
        smaData[i] = smaValue
      }
    }

    return {
      plots: [
        { key: 'sma', name: 'SMA', data: smaData, type: 'line', overlay: true },
      ],
    }
  },
})

export default simpleMovingAverage
