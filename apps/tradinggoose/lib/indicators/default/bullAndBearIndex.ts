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
 */
const bullAndBearIndex = createDefaultIndicator({
  id: 'BBI',
  name: 'Bull and Bear Index',
  series: 'price',
  precision: 2,
  shouldOhlc: true,
  plots: [
    { key: 'bbi', name: 'BBI', type: 'line', overlay: true },
  ],
  calc: (dataList) => {
    const params = [3, 6, 12, 24]
    const len = dataList.length
    const bbiData = Array<number | null>(len).fill(null)

    const maxPeriod = Math.max(...params)
    const closeSums: number[] = []
    const mas: number[] = []

    for (let i = 0; i < len; i += 1) {
      const close = dataList[i].close
      params.forEach((p, index) => {
        closeSums[index] = (closeSums[index] ?? 0) + close
        if (i >= p - 1) {
          mas[index] = closeSums[index] / p
          closeSums[index] -= dataList[i - (p - 1)].close
        }
      })
      if (i >= maxPeriod - 1) {
        let maSum = 0
        mas.forEach((ma) => {
          maSum += ma
        })
        bbiData[i] = maSum / 4
      }
    }

    return {
      plots: [
        { key: 'bbi', name: 'BBI', data: bbiData, type: 'line', overlay: true },
      ],
    }
  },
})

export default bullAndBearIndex
