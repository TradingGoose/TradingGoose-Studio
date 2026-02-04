import { createDefaultPineIndicator } from '../create-default-indicator'

const dpo = createDefaultPineIndicator({
  id: 'DPO',
  name: 'Detrended Price Oscillator',
  pineCode: `
indicator('Detrended Price Oscillator');

const length = input.int(21, 'Length');
const centered = input.bool(false, 'Centered');
const barsBack = math.floor(length / 2) + 1;
const ma = ta.sma(close, length);
const dpoValue = centered ? close[barsBack] - ma : close - ma[barsBack];

plot(dpoValue, 'DPO');`,
})

export default dpo
