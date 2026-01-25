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
 * RSI
 */
const relativeStrengthIndex = createDefaultIndicator({
  id: 'RSI',
  name: 'Relative Strength Index',
  plots: [
    { key: 'rsi1', name: 'RSI1', type: 'line', overlay: false },
    { key: 'rsi2', name: 'RSI2', type: 'line', overlay: false },
    { key: 'rsi3', name: 'RSI3', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const params = [6, 12, 24]
    const len = dataList.length
    const rsiData = params.map(() => Array<number | null>(len).fill(null))
    const sumCloseAs: number[] = []
    const sumCloseBs: number[] = []

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const prevClose = (dataList[i - 1] ?? kLineData).close
      const tmp = kLineData.close - prevClose
      for (let index = 0; index < params.length; index += 1) {
        const p = params[index]
        if (tmp > 0) {
          sumCloseAs[index] = (sumCloseAs[index] ?? 0) + tmp
        } else {
          sumCloseBs[index] = (sumCloseBs[index] ?? 0) + Math.abs(tmp)
        }
        if (i >= p - 1) {
          if (sumCloseBs[index] !== 0) {
            rsiData[index][i] = 100 - (100.0 / (1 + sumCloseAs[index] / sumCloseBs[index]))
          } else {
            rsiData[index][i] = 0
          }
          const agoData = dataList[i - (p - 1)]
          const agoPreData = dataList[i - p] ?? agoData
          const agoTmp = agoData.close - agoPreData.close
          if (agoTmp > 0) {
            sumCloseAs[index] -= agoTmp
          } else {
            sumCloseBs[index] -= Math.abs(agoTmp)
          }
        }
      }
    }

    return {
      plots: [
        { key: 'rsi1', name: 'RSI1', data: rsiData[0], type: 'line', overlay: false },
        { key: 'rsi2', name: 'RSI2', data: rsiData[1], type: 'line', overlay: false },
        { key: 'rsi3', name: 'RSI3', data: rsiData[2], type: 'line', overlay: false },
      ],
    }
  },
})

export default relativeStrengthIndex
