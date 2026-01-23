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
 * PSY
 */
const psychologicalLine = createDefaultIndicator({
  id: 'PSY',
  name: 'Psychological Line',
  plots: [
    { key: 'psy', name: 'PSY', type: 'line', overlay: false },
    { key: 'ma_psy', name: 'MAPSY', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 12
    const maPeriod = 6
    const len = dataList.length
    const psyData = Array<number | null>(len).fill(null)
    const maData = Array<number | null>(len).fill(null)

    let upCount = 0
    let psySum = 0
    const upFlags: number[] = []

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i]?.close
      const prevClose = i > 0 ? dataList[i - 1].close : close
      const upFlag = close > prevClose ? 1 : 0

      upFlags.push(upFlag)
      upCount += upFlag

      if (i >= period - 1) {
        const psy = (upCount / period) * 100
        psyData[i] = psy
        psySum += psy

        if (i >= period + maPeriod - 2) {
          maData[i] = psySum / maPeriod
          const removeIndex = i - (maPeriod - 1)
          const removeValue = psyData[removeIndex]
          if (typeof removeValue === 'number') {
            psySum -= removeValue
          }
        }

        upCount -= upFlags[i - (period - 1)]
      }
    }

    return {
      plots: [
        { key: 'psy', name: 'PSY', data: psyData, type: 'line', overlay: false },
        { key: 'ma_psy', name: 'MAPSY', data: maData, type: 'line', overlay: false },
      ],
    }
  },
})

export default psychologicalLine
