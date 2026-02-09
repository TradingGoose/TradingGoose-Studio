import { createDefaultIndicator } from '../create-default-indicator'

const rciRibbon = createDefaultIndicator({
  id: 'RCIRIBBON',
  name: 'RCI Ribbon',
  pineCode: `
indicator('RCI Ribbon');

const shortLength = input.int(10, 'Short RCI Length');
const middleLength = input.int(30, 'Middle RCI Length');
const longLength = input.int(50, 'Long RCI Length');

const computeRci = (source, length) => {
  if (na(source[length - 1])) return na;
  const window = [];
  for (let i = 0; i < length; i += 1) {
    window.push(source[length - 1 - i]);
  }

  const indexed = window.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(length).fill(0);
  let i = 0;
  while (i < length) {
    let j = i;
    while (j < length - 1 && indexed[j].value === indexed[j + 1].value) {
      j += 1;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      ranks[indexed[k].index] = avgRank;
    }
    i = j + 1;
  }

  let sumD2 = 0;
  for (let idx = 0; idx < length; idx += 1) {
    const timeRank = idx + 1;
    const d = ranks[idx] - timeRank;
    sumD2 += d * d;
  }

  const n = length;
  return (1 - (6 * sumD2) / (n * (n * n - 1))) * 100;
};

const shortRci = computeRci(close, shortLength);
const middleRci = computeRci(close, middleLength);
const longRci = computeRci(close, longLength);

plot(shortRci, 'Short RCI');
plot(middleRci, 'Middle RCI');
plot(longRci, 'Long RCI');`,
})

export default rciRibbon
