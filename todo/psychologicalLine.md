what gets saved in tradinggoose indicator editor
```[
    {
        "id": "1283b432-d37c-41b0-b7e7-f50d91fc1f03",
        "workspace_id": "7c75b01e-237e-4c7d-b570-2b982ab8b8e3",
        "user_id": "77ojwbZdPQA66RDpaVdDpSyxSmwSbq6p",
        "name": "psychologicalLine",
        "series": "normal",
        "precision": 2,
        "calc_params": [
            12,
            6
        ],
        "figures": [
            {
                "key": "a9671ecb-8a08-46f1-a563-1c1a75aa603c",
                "type": "line",
                "title": "PSY"
            },
            {
                "key": "da977d6e-dd08-4f00-908d-c9d8802fcb25",
                "type": "line",
                "title": "MAPSY"
            }
        ],
        "calc_code": "var psyKey = figureKey(figures[0])
var  maKey = figureKey(figures[1])

var upCount = 0
var psySum = 0
var upList = []
var result = []

for (var i = 0; i < dataList.length; i += 1) {
  var kLineData = dataList[i]
  var row = {}

  var prev = i > 0 ? dataList[i - 1] : kLineData
  var upFlag = kLineData.close - prev.close > 0 ? 1 : 0
  upList.push(upFlag)
  upCount += upFlag

  if (i >= calcParams[0] - 1) {
    if (psyKey) {
      row[psyKey] = (upCount / calcParams[0]) * 100
      psySum += row[psyKey]
    }

    if (i >= calcParams[0] + calcParams[1] - 2) {
      if (maKey) row[maKey] = psySum / calcParams[1]
      var prevRow = result[i - (calcParams[1] - 1)]
      if (psyKey && prevRow && prevRow[psyKey] != null) {
        psySum -= prevRow[psyKey]
      }
    }

    upCount -= upList[i - (calcParams[0] - 1)]
  }

  result.push(row)
}

return result",
        "draw_code": null,
        "tooltip_code": null,
        "regenerate_figures_code": null,
        "created_at": "2026-01-19 00:03:23.197",
        "updated_at": "2026-01-21 18:19:42.677"
    },
    {
        "id": "48f32502-d717-415b-b3b6-b8d3abb3e82d",
        "workspace_id": "7c75b01e-237e-4c7d-b570-2b982ab8b8e3",
        "user_id": "77ojwbZdPQA66RDpaVdDpSyxSmwSbq6p",
        "name": "New Indicator",
        "series": "normal",
        "precision": 2,
        "calc_params": [],
        "figures": [],
        "calc_code": "",
        "draw_code": null,
        "tooltip_code": null,
        "regenerate_figures_code": null,
        "created_at": "2026-01-19 00:11:46.623",
        "updated_at": "2026-01-19 00:11:46.623"
    }
]
```

what klinechart expect to compile:

```
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

import type { IndicatorTemplate } from '../../component/Indicator'

interface Psy {
  psy?: number
  maPsy?: number
}

/**
 * PSY
 * 公式：PSY=N日内的上涨天数/N×100%。
 */
const psychologicalLine: IndicatorTemplate<Psy, number> = {
  name: 'PSY',
  shortName: 'PSY',
  calcParams: [12, 6],
  figures: [
    { key: 'psy', title: 'PSY: ', type: 'line' },
    { key: 'maPsy', title: 'MAPSY: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const params = indicator.calcParams
    let upCount = 0
    let psySum = 0
    const upList: number[] = []
    const result: Psy[] = []
    dataList.forEach((kLineData, i) => {
      const psy: Psy = {}
      const prevClose = (dataList[i - 1] ?? kLineData).close
      const upFlag = kLineData.close - prevClose > 0 ? 1 : 0
      upList.push(upFlag)
      upCount += upFlag
      if (i >= params[0] - 1) {
        psy.psy = upCount / params[0] * 100
        psySum += psy.psy
        if (i >= params[0] + params[1] - 2) {
          psy.maPsy = psySum / params[1]
          psySum -= (result[i - (params[1] - 1)].psy ?? 0)
        }
        upCount -= upList[i - (params[0] - 1)]
      }
      result.push(psy)
    })
    return result
  }
}

export default psychologicalLine

```

error: calc: Invalid or unexpected token
