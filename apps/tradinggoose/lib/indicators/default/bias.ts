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
 * BIAS
 */
const bias = createDefaultIndicator({
  id: 'BIAS',
  name: 'Bias',
  plots: [
    { key: 'bias1', name: 'BIAS6', type: 'line', overlay: false },
    { key: 'bias2', name: 'BIAS12', type: 'line', overlay: false },
    { key: 'bias3', name: 'BIAS24', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const params = [6, 12, 24]
    const len = dataList.length
    const biasData = params.map(() => Array<number | null>(len).fill(null))
    const closeSums: number[] = []

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      for (let index = 0; index < params.length; index += 1) {
        const p = params[index]
        closeSums[index] = (closeSums[index] ?? 0) + close
        if (i >= p - 1) {
          const mean = closeSums[index] / p
          biasData[index][i] = (close - mean) / mean * 100
          closeSums[index] -= dataList[i - (p - 1)].close
        }
      }
    }

    return {
      plots: [
        { key: 'bias1', name: 'BIAS6', data: biasData[0], type: 'line', overlay: false },
        { key: 'bias2', name: 'BIAS12', data: biasData[1], type: 'line', overlay: false },
        { key: 'bias3', name: 'BIAS24', data: biasData[2], type: 'line', overlay: false },
      ],
    }
  },
})

export default bias
