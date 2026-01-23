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
 * X = (CLOSE - REF(CLOSE, 1)) / REF(CLOSE, 1) * VOLUME
 * PVT = SUM(X)
 *
 */
const priceAndVolumeTrend = createDefaultIndicator({
  id: 'PVT',
  name: 'Price and Volume Trend',
  plots: [
    { key: 'pvt', name: 'PVT', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const len = dataList.length
    const pvtData = Array<number | null>(len).fill(null)

    let sum = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const close = kLineData.close
      const volume = kLineData.volume ?? 1
      const prevClose = (dataList[i - 1] ?? kLineData).close
      let x = 0
      const total = prevClose * volume
      if (total !== 0) {
        x = (close - prevClose) / total
      }
      sum += x
      pvtData[i] = sum
    }

    return {
      plots: [
        { key: 'pvt', name: 'PVT', data: pvtData, type: 'line', overlay: false },
      ],
    }
  },
})

export default priceAndVolumeTrend
