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

interface Brar {
  br?: number
  ar?: number
  [key: string]: number | undefined
}

/**
 * BRAR
 *
 */
const brar: IndicatorTemplate<Brar, number> = {
  name: 'Brar',
  shortName: 'BRAR',
  calcParams: [26],
  figures: [
    { key: 'br', title: 'BR: ', type: 'line' },
    { key: 'ar', title: 'AR: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const params = indicator.calcParams
    let hcy = 0
    let cyl = 0
    let ho = 0
    let ol = 0
    return dataList.map((kLineData, i) => {
      const brar: Brar = {}
      const high = kLineData.high
      const low = kLineData.low
      const open = kLineData.open
      const prevClose = (dataList[i - 1] ?? kLineData).close
      ho += (high - open)
      ol += (open - low)
      hcy += (high - prevClose)
      cyl += (prevClose - low)
      if (i >= params[0] - 1) {
        if (ol !== 0) {
          brar.ar = ho / ol * 100
        } else {
          brar.ar = 0
        }
        if (cyl !== 0) {
          brar.br = hcy / cyl * 100
        } else {
          brar.br = 0
        }
        const agoKLineData = dataList[i - (params[0] - 1)]
        const agoHigh = agoKLineData.high
        const agoLow = agoKLineData.low
        const agoOpen = agoKLineData.open
        const agoPreClose = (dataList[i - params[0]] ?? dataList[i - (params[0] - 1)]).close
        hcy -= (agoHigh - agoPreClose)
        cyl -= (agoPreClose - agoLow)
        ho -= (agoHigh - agoOpen)
        ol -= (agoOpen - agoLow)
      }
      return brar
    })
  }
}

export default brar
