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

export function getMaxMin<D>(dataList: D[], maxKey: keyof D, minKey: keyof D): number[] {
  const maxMin = [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  const dataLength = dataList.length
  let index = 0
  while (index < dataLength) {
    const data = dataList[index]
    maxMin[0] = Math.max((data[maxKey] ?? Number.MIN_SAFE_INTEGER) as number, maxMin[0])
    maxMin[1] = Math.min((data[minKey] ?? Number.MAX_SAFE_INTEGER) as number, maxMin[1])
    index += 1
  }
  return maxMin
}
