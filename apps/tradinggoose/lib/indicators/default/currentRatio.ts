/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http:*www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createDefaultIndicator } from './create-default-indicator'

/**
 * MID:=REF(HIGH+LOW,1)/2;
 * CR:SUM(MAX(0,HIGH-MID),N)/SUM(MAX(0,MID-LOW),N)*100;
 * MA1:REF(MA(CR,M1),M1/2.5+1);
 * MA2:REF(MA(CR,M2),M2/2.5+1);
 * MA3:REF(MA(CR,M3),M3/2.5+1);
 * MA4:REF(MA(CR,M4),M4/2.5+1);
 *
 */
const currentRatio = createDefaultIndicator({
  id: 'CR',
  name: 'Current Ratio',
  plots: [
    { key: 'cr', name: 'CR', type: 'line', overlay: false },
    { key: 'ma1', name: 'MA1', type: 'line', overlay: false },
    { key: 'ma2', name: 'MA2', type: 'line', overlay: false },
    { key: 'ma3', name: 'MA3', type: 'line', overlay: false },
    { key: 'ma4', name: 'MA4', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const params = [26, 10, 20, 40, 60]
    const len = dataList.length
    const crData = Array<number | null>(len).fill(null)
    const ma1Data = Array<number | null>(len).fill(null)
    const ma2Data = Array<number | null>(len).fill(null)
    const ma3Data = Array<number | null>(len).fill(null)
    const ma4Data = Array<number | null>(len).fill(null)

    const ma1ForwardPeriod = Math.ceil(params[1] / 2.5 + 1)
    const ma2ForwardPeriod = Math.ceil(params[2] / 2.5 + 1)
    const ma3ForwardPeriod = Math.ceil(params[3] / 2.5 + 1)
    const ma4ForwardPeriod = Math.ceil(params[4] / 2.5 + 1)

    let ma1Sum = 0
    const ma1List: number[] = []
    let ma2Sum = 0
    const ma2List: number[] = []
    let ma3Sum = 0
    const ma3List: number[] = []
    let ma4Sum = 0
    const ma4List: number[] = []

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const prevData = dataList[i - 1] ?? kLineData
      const prevMid = (prevData.high + prevData.close + prevData.low + prevData.open) / 4

      const highSubPreMid = Math.max(0, kLineData.high - prevMid)
      const preMidSubLow = Math.max(0, prevMid - kLineData.low)

      if (i >= params[0] - 1) {
        const crValue = preMidSubLow !== 0 ? highSubPreMid / preMidSubLow * 100 : 0
        crData[i] = crValue
        ma1Sum += crValue
        ma2Sum += crValue
        ma3Sum += crValue
        ma4Sum += crValue

        if (i >= params[0] + params[1] - 2) {
          ma1List.push(ma1Sum / params[1])
          if (i >= params[0] + params[1] + ma1ForwardPeriod - 3) {
            ma1Data[i] = ma1List[ma1List.length - 1 - ma1ForwardPeriod]
          }
          const removeValue = crData[i - (params[1] - 1)]
          if (typeof removeValue === 'number') {
            ma1Sum -= removeValue
          }
        }
        if (i >= params[0] + params[2] - 2) {
          ma2List.push(ma2Sum / params[2])
          if (i >= params[0] + params[2] + ma2ForwardPeriod - 3) {
            ma2Data[i] = ma2List[ma2List.length - 1 - ma2ForwardPeriod]
          }
          const removeValue = crData[i - (params[2] - 1)]
          if (typeof removeValue === 'number') {
            ma2Sum -= removeValue
          }
        }
        if (i >= params[0] + params[3] - 2) {
          ma3List.push(ma3Sum / params[3])
          if (i >= params[0] + params[3] + ma3ForwardPeriod - 3) {
            ma3Data[i] = ma3List[ma3List.length - 1 - ma3ForwardPeriod]
          }
          const removeValue = crData[i - (params[3] - 1)]
          if (typeof removeValue === 'number') {
            ma3Sum -= removeValue
          }
        }
        if (i >= params[0] + params[4] - 2) {
          ma4List.push(ma4Sum / params[4])
          if (i >= params[0] + params[4] + ma4ForwardPeriod - 3) {
            ma4Data[i] = ma4List[ma4List.length - 1 - ma4ForwardPeriod]
          }
          const removeValue = crData[i - (params[4] - 1)]
          if (typeof removeValue === 'number') {
            ma4Sum -= removeValue
          }
        }
      }
    }

    return {
      plots: [
        { key: 'cr', name: 'CR', data: crData, type: 'line', overlay: false },
        { key: 'ma1', name: 'MA1', data: ma1Data, type: 'line', overlay: false },
        { key: 'ma2', name: 'MA2', data: ma2Data, type: 'line', overlay: false },
        { key: 'ma3', name: 'MA3', data: ma3Data, type: 'line', overlay: false },
        { key: 'ma4', name: 'MA4', data: ma4Data, type: 'line', overlay: false },
      ],
    }
  },
})

export default currentRatio
