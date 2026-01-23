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
 * VR
 *
 */
const volumeRatio = createDefaultIndicator({
  id: 'VR',
  name: 'Volume Ratio',
  plots: [
    { key: 'vr', name: 'VR', type: 'line', overlay: false },
    { key: 'maVr', name: 'MAVR', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 26
    const maPeriod = 6
    const len = dataList.length
    const vrData = Array<number | null>(len).fill(null)
    const maVrData = Array<number | null>(len).fill(null)

    let uvs = 0
    let dvs = 0
    let pvs = 0
    let vrSum = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const close = kLineData.close
      const preClose = (dataList[i - 1] ?? kLineData).close
      const volume = kLineData.volume ?? 0
      if (close > preClose) {
        uvs += volume
      } else if (close < preClose) {
        dvs += volume
      } else {
        pvs += volume
      }
      if (i >= period - 1) {
        const halfPvs = pvs / 2
        const vrValue = (dvs + halfPvs === 0)
          ? 0
          : (uvs + halfPvs) / (dvs + halfPvs) * 100
        vrData[i] = vrValue
        vrSum += vrValue
        if (i >= period + maPeriod - 2) {
          maVrData[i] = vrSum / maPeriod
          const removeValue = vrData[i - (maPeriod - 1)]
          if (typeof removeValue === 'number') {
            vrSum -= removeValue
          }
        }

        const agoData = dataList[i - (period - 1)]
        const agoPreData = dataList[i - period] ?? agoData
        const agoClose = agoData.close
        const agoVolume = agoData.volume ?? 0
        if (agoClose > agoPreData.close) {
          uvs -= agoVolume
        } else if (agoClose < agoPreData.close) {
          dvs -= agoVolume
        } else {
          pvs -= agoVolume
        }
      }
    }

    return {
      plots: [
        { key: 'vr', name: 'VR', data: vrData, type: 'line', overlay: false },
        { key: 'maVr', name: 'MAVR', data: maVrData, type: 'line', overlay: false },
      ],
    }
  },
})

export default volumeRatio
