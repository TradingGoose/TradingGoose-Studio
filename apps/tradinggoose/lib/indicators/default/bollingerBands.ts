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
 * BOLL
 */
const bollingerBands = createDefaultIndicator({
  id: 'BOLL',
  name: 'Bollinger Bands',
  series: 'price',
  precision: 2,
  shouldOhlc: true,
  plots: [
    { key: 'up', name: 'UP', type: 'line', overlay: true },
    { key: 'mid', name: 'MID', type: 'line', overlay: true },
    { key: 'dn', name: 'DN', type: 'line', overlay: true },
  ],
  calc: (dataList) => {
    const period = 20
    const multiplier = 2
    const len = dataList.length
    const upData = Array<number | null>(len).fill(null)
    const midData = Array<number | null>(len).fill(null)
    const dnData = Array<number | null>(len).fill(null)

    const getBollMd = (list: typeof dataList, ma: number) => {
      const dataSize = list.length
      let sum = 0
      list.forEach((data) => {
        const closeMa = data.close - ma
        sum += closeMa * closeMa
      })
      sum = Math.abs(sum)
      return Math.sqrt(sum / dataSize)
    }

    const p = period - 1
    let closeSum = 0

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum += close
      if (i >= p) {
        const mid = closeSum / period
        const md = getBollMd(dataList.slice(i - p, i + 1), mid)
        midData[i] = mid
        upData[i] = mid + multiplier * md
        dnData[i] = mid - multiplier * md
        closeSum -= dataList[i - p].close
      }
    }

    return {
      plots: [
        { key: 'up', name: 'UP', data: upData, type: 'line', overlay: true },
        { key: 'mid', name: 'MID', data: midData, type: 'line', overlay: true },
        { key: 'dn', name: 'DN', data: dnData, type: 'line', overlay: true },
      ],
    }
  },
})

export default bollingerBands
