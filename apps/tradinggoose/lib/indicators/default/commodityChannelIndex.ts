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
 * CCI
 *
 */
const commodityChannelIndex = createDefaultIndicator({
  id: 'CCI',
  name: 'Commodity Channel Index',
  plots: [
    { key: 'cci', name: 'CCI', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 20
    const len = dataList.length
    const cciData = Array<number | null>(len).fill(null)

    const p = period - 1
    let tpSum = 0
    const tpList: number[] = []

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const tp = (kLineData.high + kLineData.low + kLineData.close) / 3
      tpSum += tp
      tpList.push(tp)
      if (i >= p) {
        const maTp = tpSum / period
        const sliceTpList = tpList.slice(i - p, i + 1)
        let sum = 0
        sliceTpList.forEach((value) => {
          sum += Math.abs(value - maTp)
        })
        const md = sum / period
        cciData[i] = md !== 0 ? (tp - maTp) / md / 0.015 : 0
        const agoTp = (dataList[i - p].high + dataList[i - p].low + dataList[i - p].close) / 3
        tpSum -= agoTp
      }
    }

    return {
      plots: [
        { key: 'cci', name: 'CCI', data: cciData, type: 'line', overlay: false },
      ],
    }
  },
})

export default commodityChannelIndex
