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

import type { IndicatorTemplate } from 'klinecharts'

interface Vr {
  vr?: number
  maVr?: number
  [key: string]: number | undefined
}

/**
 * VR
 *
 */
const volumeRatio: IndicatorTemplate<Vr, number> = {
  name: 'Volume Ratio',
  shortName: 'VR',
  calcParams: [26, 6],
  figures: [
    { key: 'vr', title: 'VR: ', type: 'line' },
    { key: 'maVr', title: 'MAVR: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const params = indicator.calcParams
    let uvs = 0
    let dvs = 0
    let pvs = 0
    let vrSum = 0
    const result: Vr[] = []
    dataList.forEach((kLineData, i) => {
      const vr: Vr = {}
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
      if (i >= params[0] - 1) {
        const halfPvs = pvs / 2
        if (dvs + halfPvs === 0) {
          vr.vr = 0
        } else {
          vr.vr = (uvs + halfPvs) / (dvs + halfPvs) * 100
        }
        vrSum += vr.vr
        if (i >= params[0] + params[1] - 2) {
          vr.maVr = vrSum / params[1]
          vrSum -= (result[i - (params[1] - 1)].vr ?? 0)
        }

        const agoData = dataList[i - (params[0] - 1)]
        const agoPreData = dataList[i - params[0]] ?? agoData
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
      result.push(vr)
    })
    return result
  }
}

export default volumeRatio
