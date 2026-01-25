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
 *
 *
 */
const easeOfMovementValue = createDefaultIndicator({
  id: 'EMV',
  name: 'Ease of Movement Value',
  plots: [
    { key: 'emv', name: 'EMV', type: 'line', overlay: false },
    { key: 'maEmv', name: 'MAEMV', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 14
    const len = dataList.length
    const emvData = Array<number | null>(len).fill(null)
    const maEmvData = Array<number | null>(len).fill(null)

    let emvValueSum = 0
    const emvValueList: number[] = []

    for (let i = 0; i < len; i += 1) {
      if (i > 0) {
        const kLineData = dataList[i]
        const prevKLineData = dataList[i - 1]
        const high = kLineData.high
        const low = kLineData.low
        const volume = kLineData.volume ?? 0
        const distanceMoved = (high + low) / 2 - (prevKLineData.high + prevKLineData.low) / 2

        let emvValue = 0
        if (volume !== 0 && high - low !== 0) {
          const ratio = volume / 100000000 / (high - low)
          emvValue = distanceMoved / ratio
        }
        emvData[i] = emvValue
        emvValueSum += emvValue
        emvValueList.push(emvValue)
        if (i >= period) {
          maEmvData[i] = emvValueSum / period
          emvValueSum -= emvValueList[i - period]
        }
      }
    }

    return {
      plots: [
        { key: 'emv', name: 'EMV', data: emvData, type: 'line', overlay: false },
        { key: 'maEmv', name: 'MAEMV', data: maEmvData, type: 'line', overlay: false },
      ],
    }
  },
})

export default easeOfMovementValue
