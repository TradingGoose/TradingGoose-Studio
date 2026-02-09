import { createDefaultIndicator } from '../create-default-indicator'

const aroon = createDefaultIndicator({
  id: 'AROON',
  name: 'Aroon',
  pineCode: `
indicator('Aroon');

const length = input.int(14, 'Length');
const highestBars = ta.highestbars(high, length);
const lowestBars = ta.lowestbars(low, length);
const aroonUp = (length + highestBars) / length * 100;
const aroonDown = (length + lowestBars) / length * 100;

plot(aroonUp, 'Aroon Up');
plot(aroonDown, 'Aroon Down');`,
})

export default aroon
