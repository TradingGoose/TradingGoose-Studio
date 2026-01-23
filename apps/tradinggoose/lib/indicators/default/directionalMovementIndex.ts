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
 * DMI
 *
 * MTR:=EXPMEMA(MAX(MAX(HIGH-LOW,ABS(HIGH-REF(CLOSE,1))),ABS(REF(CLOSE,1)-LOW)),N)
 * HD :=HIGH-REF(HIGH,1);
 * LD :=REF(LOW,1)-LOW;
 * DMP:=EXPMEMA(IF(HD>0&&HD>LD,HD,0),N);
 * DMM:=EXPMEMA(IF(LD>0&&LD>HD,LD,0),N);
 *
 * PDI: DMP*100/MTR;
 * MDI: DMM*100/MTR;
 * ADX: EXPMEMA(ABS(MDI-PDI)/(MDI+PDI)*100,MM);
 * ADXR:EXPMEMA(ADX,MM);
 *
 */
const directionalMovementIndex = createDefaultIndicator({
  id: 'DMI',
  name: 'Directional Movement Index',
  plots: [
    { key: 'pdi', name: 'PDI', type: 'line', overlay: false },
    { key: 'mdi', name: 'MDI', type: 'line', overlay: false },
    { key: 'adx', name: 'ADX', type: 'line', overlay: false },
    { key: 'adxr', name: 'ADXR', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 14
    const adxPeriod = 6
    const len = dataList.length
    const pdiData = Array<number | null>(len).fill(null)
    const mdiData = Array<number | null>(len).fill(null)
    const adxData = Array<number | null>(len).fill(null)
    const adxrData = Array<number | null>(len).fill(null)

    let trSum = 0
    let hSum = 0
    let lSum = 0
    let mtr = 0
    let dmp = 0
    let dmm = 0
    let dxSum = 0
    let adx = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const prevKLineData = dataList[i - 1] ?? kLineData
      const preClose = prevKLineData.close
      const high = kLineData.high
      const low = kLineData.low
      const hl = high - low
      const hcy = Math.abs(high - preClose)
      const lcy = Math.abs(preClose - low)
      const hhy = high - prevKLineData.high
      const lyl = prevKLineData.low - low
      const tr = Math.max(Math.max(hl, hcy), lcy)
      const h = (hhy > 0 && hhy > lyl) ? hhy : 0
      const l = (lyl > 0 && lyl > hhy) ? lyl : 0
      trSum += tr
      hSum += h
      lSum += l
      if (i >= period - 1) {
        if (i > period - 1) {
          mtr = mtr - mtr / period + tr
          dmp = dmp - dmp / period + h
          dmm = dmm - dmm / period + l
        } else {
          mtr = trSum
          dmp = hSum
          dmm = lSum
        }
        let pdi = 0
        let mdi = 0
        if (mtr !== 0) {
          pdi = dmp * 100 / mtr
          mdi = dmm * 100 / mtr
        }
        pdiData[i] = pdi
        mdiData[i] = mdi
        let dx = 0
        if (mdi + pdi !== 0) {
          dx = Math.abs((mdi - pdi)) / (mdi + pdi) * 100
        }
        dxSum += dx
        if (i >= period * 2 - 2) {
          if (i > period * 2 - 2) {
            adx = (adx * (period - 1) + dx) / period
          } else {
            adx = dxSum / period
          }
          adxData[i] = adx
          if (i >= period * 2 + adxPeriod - 3) {
            const prevAdx = adxData[i - (adxPeriod - 1)] ?? 0
            adxrData[i] = (prevAdx + adx) / 2
          }
        }
      }
    }

    return {
      plots: [
        { key: 'pdi', name: 'PDI', data: pdiData, type: 'line', overlay: false },
        { key: 'mdi', name: 'MDI', data: mdiData, type: 'line', overlay: false },
        { key: 'adx', name: 'ADX', data: adxData, type: 'line', overlay: false },
        { key: 'adxr', name: 'ADXR', data: adxrData, type: 'line', overlay: false },
      ],
    }
  },
})

export default directionalMovementIndex
