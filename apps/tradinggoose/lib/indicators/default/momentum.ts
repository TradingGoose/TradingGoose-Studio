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
 * mtm
 */
const momentum = createDefaultIndicator({
  id: 'MTM',
  name: 'Momentum',
  plots: [
    { key: 'mtm', name: 'MTM', type: 'line', overlay: false },
    { key: 'maMtm', name: 'MAMTM', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 12
    const maPeriod = 6
    const len = dataList.length
    const mtmData = Array<number | null>(len).fill(null)
    const maMtmData = Array<number | null>(len).fill(null)

    let mtmSum = 0

    for (let i = 0; i < len; i += 1) {
      if (i >= period) {
        const close = dataList[i].close
        const agoClose = dataList[i - period].close
        const mtmValue = close - agoClose
        mtmData[i] = mtmValue
        mtmSum += mtmValue
        if (i >= period + maPeriod - 1) {
          maMtmData[i] = mtmSum / maPeriod
          const removeValue = mtmData[i - (maPeriod - 1)]
          if (typeof removeValue === 'number') {
            mtmSum -= removeValue
          }
        }
      }
    }

    return {
      plots: [
        { key: 'mtm', name: 'MTM', data: mtmData, type: 'line', overlay: false },
        { key: 'maMtm', name: 'MAMTM', data: maMtmData, type: 'line', overlay: false },
      ],
    }
  },
})

export default momentum
