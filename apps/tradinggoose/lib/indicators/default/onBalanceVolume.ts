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
 * OBV
 * OBV = REF(OBV) + sign * V
 */
const onBalanceVolume = createDefaultIndicator({
  id: 'OBV',
  name: 'On Balance Volume',
  plots: [
    { key: 'obv', name: 'OBV', type: 'line', overlay: false },
    { key: 'maObv', name: 'MAOBV', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 30
    const len = dataList.length
    const obvData = Array<number | null>(len).fill(null)
    const maObvData = Array<number | null>(len).fill(null)

    let obvSum = 0
    let oldObv = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const prevKLineData = dataList[i - 1] ?? kLineData
      if (kLineData.close < prevKLineData.close) {
        oldObv -= (kLineData.volume ?? 0)
      } else if (kLineData.close > prevKLineData.close) {
        oldObv += (kLineData.volume ?? 0)
      }
      obvData[i] = oldObv
      obvSum += oldObv
      if (i >= period - 1) {
        maObvData[i] = obvSum / period
        const removeValue = obvData[i - (period - 1)]
        if (typeof removeValue === 'number') {
          obvSum -= removeValue
        }
      }
    }

    return {
      plots: [
        { key: 'obv', name: 'OBV', data: obvData, type: 'line', overlay: false },
        { key: 'maObv', name: 'MAOBV', data: maObvData, type: 'line', overlay: false },
      ],
    }
  },
})

export default onBalanceVolume
