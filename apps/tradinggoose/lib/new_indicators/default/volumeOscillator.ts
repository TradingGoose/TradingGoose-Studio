import { createDefaultPineIndicator } from '../create-default-indicator'

const volumeOscillator = createDefaultPineIndicator({
  id: 'VO',
  name: 'Volume Oscillator',
  pineCode: `
indicator('Volume Oscillator');

const shortLength = input.int(5, 'Short Length');
const longLength = input.int(10, 'Long Length');
const vol = volume ?? 0;
const shortEma = ta.ema(vol, shortLength);
const longEma = ta.ema(vol, longLength);
const osc = longEma !== 0 ? 100 * (shortEma - longEma) / longEma : NaN;

plot(osc, 'Volume Osc');`,
})

export default volumeOscillator
