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
 * trix
 *
 * TRIX:(MTR-REF(MTR,1))/REF(MTR,1)*100;
 * TRMA:MA(TRIX,M)
 *
 */
const tripleExponentiallySmoothedAverage = createDefaultIndicator({
  id: 'TRIX',
  name: 'Triple Exponentially Smoothed Average',
  plots: [
    { key: 'trix', name: 'TRIX', type: 'line', overlay: false },
    { key: 'maTrix', name: 'MATRIX', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 12
    const maPeriod = 9
    const len = dataList.length
    const trixData = Array<number | null>(len).fill(null)
    const maTrixData = Array<number | null>(len).fill(null)

    let closeSum = 0
    let ema1 = 0
    let ema2 = 0
    let oldTr = 0
    let ema1Sum = 0
    let ema2Sum = 0
    let trixSum = 0

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum += close
      if (i >= period - 1) {
        if (i > period - 1) {
          ema1 = (2 * close + (period - 1) * ema1) / (period + 1)
        } else {
          ema1 = closeSum / period
        }
        ema1Sum += ema1
        if (i >= period * 2 - 2) {
          if (i > period * 2 - 2) {
            ema2 = (2 * ema1 + (period - 1) * ema2) / (period + 1)
          } else {
            ema2 = ema1Sum / period
          }
          ema2Sum += ema2
          if (i >= period * 3 - 3) {
            let tr = 0
            let trixValue = 0
            if (i > period * 3 - 3) {
              tr = (2 * ema2 + (period - 1) * oldTr) / (period + 1)
              trixValue = (tr - oldTr) / oldTr * 100
            } else {
              tr = ema2Sum / period
            }
            oldTr = tr
            trixData[i] = trixValue
            trixSum += trixValue
            if (i >= period * 3 + maPeriod - 4) {
              maTrixData[i] = trixSum / maPeriod
              const removeValue = trixData[i - (maPeriod - 1)]
              if (typeof removeValue === 'number') {
                trixSum -= removeValue
              }
            }
          }
        }
      }
    }

    return {
      plots: [
        { key: 'trix', name: 'TRIX', data: trixData, type: 'line', overlay: false },
        { key: 'maTrix', name: 'MATRIX', data: maTrixData, type: 'line', overlay: false },
      ],
    }
  },
})

export default tripleExponentiallySmoothedAverage
