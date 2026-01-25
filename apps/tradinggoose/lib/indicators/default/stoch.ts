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
 * KDJ
 *
 */
const stoch = createDefaultIndicator({
  id: 'STOCH',
  name: 'Stochastic',
  plots: [
    { key: 'k', name: 'K', type: 'line', overlay: false },
    { key: 'd', name: 'D', type: 'line', overlay: false },
    { key: 'j', name: 'J', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 9
    const kPeriod = 3
    const dPeriod = 3
    const len = dataList.length
    const kData = Array<number | null>(len).fill(null)
    const dData = Array<number | null>(len).fill(null)
    const jData = Array<number | null>(len).fill(null)

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
      const kLineData = dataList[i]
      const close = kLineData.close
      if (i >= period - 1) {
        const lhn = getMaxMin(dataList.slice(i - (period - 1), i + 1))
        const hn = lhn[0]
        const ln = lhn[1]
        const hnSubLn = hn - ln
        const rsv = (close - ln) / (hnSubLn === 0 ? 1 : hnSubLn) * 100
        const prevK = kData[i - 1] ?? 50
        const kValue = ((kPeriod - 1) * prevK + rsv) / kPeriod
        const prevD = dData[i - 1] ?? 50
        const dValue = ((dPeriod - 1) * prevD + kValue) / dPeriod
        const jValue = 3.0 * kValue - 2.0 * dValue
        kData[i] = kValue
        dData[i] = dValue
        jData[i] = jValue
      }
    }

    return {
      plots: [
        { key: 'k', name: 'K', data: kData, type: 'line', overlay: false },
        { key: 'd', name: 'D', data: dData, type: 'line', overlay: false },
        { key: 'j', name: 'J', data: jData, type: 'line', overlay: false },
      ],
    }
  },
})

export default stoch
