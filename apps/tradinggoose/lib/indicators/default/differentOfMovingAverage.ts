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
 * DMA
 */
const differentOfMovingAverage = createDefaultIndicator({
  id: 'DMA',
  name: 'Different of Moving Average',
  plots: [
    { key: 'dma', name: 'DMA', type: 'line', overlay: false },
    { key: 'ama', name: 'AMA', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const shortPeriod = 10
    const longPeriod = 50
    const amaPeriod = 10
    const len = dataList.length
    const dmaData = Array<number | null>(len).fill(null)
    const amaData = Array<number | null>(len).fill(null)

    const maxPeriod = Math.max(shortPeriod, longPeriod)
    let closeSum1 = 0
    let closeSum2 = 0
    let dmaSum = 0

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      closeSum1 += close
      closeSum2 += close
      let ma1 = 0
      let ma2 = 0
      if (i >= shortPeriod - 1) {
        ma1 = closeSum1 / shortPeriod
        closeSum1 -= dataList[i - (shortPeriod - 1)].close
      }
      if (i >= longPeriod - 1) {
        ma2 = closeSum2 / longPeriod
        closeSum2 -= dataList[i - (longPeriod - 1)].close
      }

      if (i >= maxPeriod - 1) {
        const dif = ma1 - ma2
        dmaData[i] = dif
        dmaSum += dif
        if (i >= maxPeriod + amaPeriod - 2) {
          amaData[i] = dmaSum / amaPeriod
          const removeValue = dmaData[i - (amaPeriod - 1)]
          if (typeof removeValue === 'number') {
            dmaSum -= removeValue
          }
        }
      }
    }

    return {
      plots: [
        { key: 'dma', name: 'DMA', data: dmaData, type: 'line', overlay: false },
        { key: 'ama', name: 'AMA', data: amaData, type: 'line', overlay: false },
      ],
    }
  },
})

export default differentOfMovingAverage
