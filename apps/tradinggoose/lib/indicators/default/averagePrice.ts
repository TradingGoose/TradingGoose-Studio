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
 * average price
 */
const averagePrice = createDefaultIndicator({
  id: 'AVP',
  name: 'Average Price',
  series: 'price',
  precision: 2,
  plots: [
    { key: 'avp', name: 'AVP', type: 'line', overlay: true },
  ],
  calc: (dataList) => {
    const len = dataList.length
    const avpData = Array<number | null>(len).fill(null)

    let totalTurnover = 0
    let totalVolume = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const turnover = kLineData?.turnover ?? 0
      const volume = kLineData?.volume ?? 0
      totalTurnover += turnover
      totalVolume += volume
      if (totalVolume !== 0) {
        avpData[i] = totalTurnover / totalVolume
      }
    }

    return {
      plots: [
        { key: 'avp', name: 'AVP', data: avpData, type: 'line', overlay: true },
      ],
    }
  },
})

export default averagePrice
