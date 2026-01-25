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

import { formatValue } from './utils/format'
import { createDefaultIndicator } from './create-default-indicator'

const awesomeOscillator = createDefaultIndicator({
  id: 'AO',
  name: 'Awesome Oscillator',
  plots: [
    {
      key: 'ao',
      name: 'AO',
      type: 'bar',
      overlay: false,
      figure: {
        baseValue: 0,
        styles: ({ data, indicator, defaultStyles }) => {
          const { prev, current } = data
          const prevAo = prev?.ao ?? Number.MIN_SAFE_INTEGER
          const currentAo = current?.ao ?? Number.MIN_SAFE_INTEGER
          let color = ''
          if (currentAo > prevAo) {
            color = formatValue(indicator.styles, 'bars[0].upColor', (defaultStyles!.bars)[0].upColor) as string
          } else {
            color = formatValue(indicator.styles, 'bars[0].downColor', (defaultStyles!.bars)[0].downColor) as string
          }
          const style = currentAo > prevAo ? 'stroke' : 'fill'
          return { color, style, borderColor: color }
        },
      },
    },
  ],
  calc: (dataList) => {
    const shortPeriod = 5
    const longPeriod = 34

    const len = dataList.length
    const aoData = Array<number | null>(len).fill(null)

    const maxPeriod = Math.max(shortPeriod, longPeriod)
    let shortSum = 0
    let longSum = 0
    let short = 0
    let long = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const middle = (kLineData.low + kLineData.high) / 2
      shortSum += middle
      longSum += middle
      if (i >= shortPeriod - 1) {
        short = shortSum / shortPeriod
        const agoKLineData = dataList[i - (shortPeriod - 1)]
        shortSum -= ((agoKLineData.low + agoKLineData.high) / 2)
      }
      if (i >= longPeriod - 1) {
        long = longSum / longPeriod
        const agoKLineData = dataList[i - (longPeriod - 1)]
        longSum -= ((agoKLineData.low + agoKLineData.high) / 2)
      }
      if (i >= maxPeriod - 1) {
        aoData[i] = short - long
      }
    }

    return {
      plots: [
        { key: 'ao', name: 'AO', data: aoData, type: 'bar', overlay: false },
      ],
    }
  },
})

export default awesomeOscillator
