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

import type { IndicatorTemplate, IndicatorFigure } from 'klinecharts'

interface Vol {
  open: number
  close: number
  volume?: number
  [key: string]: number | undefined
}

function getVolumeFigure(): IndicatorFigure<Vol> {
  return {
    key: 'volume',
    title: 'VOLUME: ',
    type: 'bar',
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
    }
  }
}

const volume: IndicatorTemplate<Vol, number> = {
  name: 'Volume',
  shortName: 'VOL',
  series: 'normal',
  shouldFormatBigNumber: true,
  precision: 0,
  minValue: 0,
  figures: [
    getVolumeFigure()
  ],
  calc: (dataList) => {
    return dataList.map((kLineData) => {
      const volume = kLineData.volume ?? 0
      const vol: Vol = { volume, open: kLineData.open, close: kLineData.close }
      return vol
    })
  }
}

export default volume
