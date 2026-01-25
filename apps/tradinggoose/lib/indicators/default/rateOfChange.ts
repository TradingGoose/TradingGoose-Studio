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
const rateOfChange = createDefaultIndicator({
  id: 'ROC',
  name: 'Rate of Change',
  plots: [
    { key: 'roc', name: 'ROC', type: 'line', overlay: false },
    { key: 'maRoc', name: 'MAROC', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 12
    const maPeriod = 6
    const len = dataList.length
    const rocData = Array<number | null>(len).fill(null)
    const maRocData = Array<number | null>(len).fill(null)

    let rocSum = 0

    for (let i = 0; i < len; i += 1) {
      if (i >= period - 1) {
        const close = dataList[i].close
        const agoClose = (dataList[i - period] ?? dataList[i - (period - 1)]).close
        const rocValue = agoClose !== 0 ? (close - agoClose) / agoClose * 100 : 0
        rocData[i] = rocValue
        rocSum += rocValue
        if (i >= period - 1 + maPeriod - 1) {
          maRocData[i] = rocSum / maPeriod
          const removeValue = rocData[i - (maPeriod - 1)]
          if (typeof removeValue === 'number') {
            rocSum -= removeValue
          }
        }
      }
    }

    return {
      plots: [
        { key: 'roc', name: 'ROC', data: rocData, type: 'line', overlay: false },
        { key: 'maRoc', name: 'MAROC', data: maRocData, type: 'line', overlay: false },
      ],
    }
  },
})

export default rateOfChange
