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
const movingAverage = createDefaultIndicator({
  id: 'MA',
  name: 'Moving Average',
  series: 'price',
  precision: 2,
  shouldOhlc: true,
  plots: [
    { key: 'ma1', name: 'MA5', type: 'line', overlay: true },
    { key: 'ma2', name: 'MA10', type: 'line', overlay: true },
    { key: 'ma3', name: 'MA30', type: 'line', overlay: true },
    { key: 'ma4', name: 'MA60', type: 'line', overlay: true },
  ],
  calc: (dataList) => {
    const params = [5, 10, 30, 60]
    const len = dataList.length
    const maData = params.map(() => Array<number | null>(len).fill(null))
    const closeSums: number[] = []

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      for (let index = 0; index < params.length; index += 1) {
        const p = params[index]
        closeSums[index] = (closeSums[index] ?? 0) + close
        if (i >= p - 1) {
          maData[index][i] = closeSums[index] / p
          closeSums[index] -= dataList[i - (p - 1)].close
        }
      }
    }

    return {
      plots: [
        { key: 'ma1', name: 'MA5', data: maData[0], type: 'line', overlay: true },
        { key: 'ma2', name: 'MA10', data: maData[1], type: 'line', overlay: true },
        { key: 'ma3', name: 'MA30', data: maData[2], type: 'line', overlay: true },
        { key: 'ma4', name: 'MA60', data: maData[3], type: 'line', overlay: true },
      ],
    }
  },
})

export default movingAverage
