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
 * WR
 */
const williamsR = createDefaultIndicator({
  id: 'WR',
  name: 'Williams %R',
  plots: [
    { key: 'wr1', name: 'WR1', type: 'line', overlay: false },
    { key: 'wr2', name: 'WR2', type: 'line', overlay: false },
    { key: 'wr3', name: 'WR3', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const params = [6, 10, 14]
    const len = dataList.length
    const wrData = params.map(() => Array<number | null>(len).fill(null))

    const getMaxMin = (list: typeof dataList) => {
      let max = Number.NEGATIVE_INFINITY
      let min = Number.POSITIVE_INFINITY
      list.forEach((item) => {
        if (item.high > max) max = item.high
        if (item.low < min) min = item.low
      })
      return [max, min]
    }

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      for (let index = 0; index < params.length; index += 1) {
        const p = params[index] - 1
        if (i >= p) {
          const hln = getMaxMin(dataList.slice(i - p, i + 1))
          const hn = hln[0]
          const ln = hln[1]
          const hnSubLn = hn - ln
          wrData[index][i] = hnSubLn === 0 ? 0 : (close - hn) / hnSubLn * 100
        }
      }
    }

    return {
      plots: [
        { key: 'wr1', name: 'WR1', data: wrData[0], type: 'line', overlay: false },
        { key: 'wr2', name: 'WR2', data: wrData[1], type: 'line', overlay: false },
        { key: 'wr3', name: 'WR3', data: wrData[2], type: 'line', overlay: false },
      ],
    }
  },
})

export default williamsR
