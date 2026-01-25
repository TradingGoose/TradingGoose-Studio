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
import { isValid } from './utils/type-checks'

import { createDefaultIndicator } from './create-default-indicator'

const volume = createDefaultIndicator({
  id: 'VOL',
  name: 'Volume',
  series: 'normal',
  shouldFormatBigNumber: true,
  precision: 0,
  minValue: 0,
  plots: [
    {
      key: 'volume',
      name: 'VOLUME',
      type: 'bar',
      overlay: false,
      figure: {
        baseValue: 0,
        styles: ({ data, indicator, defaultStyles }) => {
          const current = data.current
          let color = formatValue(indicator.styles, 'bars[0].noChangeColor', (defaultStyles!.bars)[0].noChangeColor)
          if (isValid(current)) {
            if (current.close > current.open) {
              color = formatValue(indicator.styles, 'bars[0].upColor', (defaultStyles!.bars)[0].upColor)
            } else if (current.close < current.open) {
              color = formatValue(indicator.styles, 'bars[0].downColor', (defaultStyles!.bars)[0].downColor)
            }
          }
          return { color: color as string }
        },
      },
    },
  ],
  calc: (dataList) => {
    const len = dataList.length
    const volumeData = Array<number | null>(len).fill(null)
    const openData = Array<number | null>(len).fill(null)
    const closeData = Array<number | null>(len).fill(null)

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      volumeData[i] = kLineData.volume ?? 0
      openData[i] = kLineData.open
      closeData[i] = kLineData.close
    }

    return {
      plots: [
        { key: 'volume', name: 'VOLUME', data: volumeData, type: 'bar', overlay: false },
        { key: 'open', data: openData },
        { key: 'close', data: closeData },
      ],
    }
  },
})

export default volume
