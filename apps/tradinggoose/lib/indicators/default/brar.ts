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
 * BRAR
 *
 */
const brar = createDefaultIndicator({
  id: 'BRAR',
  name: 'Brar',
  plots: [
    { key: 'br', name: 'BR', type: 'line', overlay: false },
    { key: 'ar', name: 'AR', type: 'line', overlay: false },
  ],
  calc: (dataList) => {
    const period = 26
    const len = dataList.length
    const brData = Array<number | null>(len).fill(null)
    const arData = Array<number | null>(len).fill(null)

    let hcy = 0
    let cyl = 0
    let ho = 0
    let ol = 0

    for (let i = 0; i < len; i += 1) {
      const kLineData = dataList[i]
      const high = kLineData.high
      const low = kLineData.low
      const open = kLineData.open
      const prevClose = (dataList[i - 1] ?? kLineData).close
      ho += (high - open)
      ol += (open - low)
      hcy += (high - prevClose)
      cyl += (prevClose - low)
      if (i >= period - 1) {
        arData[i] = ol !== 0 ? ho / ol * 100 : 0
        brData[i] = cyl !== 0 ? hcy / cyl * 100 : 0
        const agoKLineData = dataList[i - (period - 1)]
        const agoHigh = agoKLineData.high
        const agoLow = agoKLineData.low
        const agoOpen = agoKLineData.open
        const agoPreClose = (dataList[i - period] ?? dataList[i - (period - 1)]).close
        hcy -= (agoHigh - agoPreClose)
        cyl -= (agoPreClose - agoLow)
        ho -= (agoHigh - agoOpen)
        ol -= (agoOpen - agoLow)
      }
    }

    return {
      plots: [
        { key: 'br', name: 'BR', data: brData, type: 'line', overlay: false },
        { key: 'ar', name: 'AR', data: arData, type: 'line', overlay: false },
      ],
    }
  },
})

export default brar
