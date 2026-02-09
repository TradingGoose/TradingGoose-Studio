import { createDefaultIndicator } from '../create-default-indicator'

const chaikinOscillator = createDefaultIndicator({
  id: 'CHOSC',
  name: 'Chaikin Oscillator',
  pineCode: `
indicator('Chaikin Oscillator');

const fast = input.int(3, 'Fast Length');
const slow = input.int(10, 'Slow Length');
const ad = ta.accdist();
const fastEma = ta.ema(ad, fast);
const slowEma = ta.ema(ad, slow);
const osc = fastEma - slowEma;

plot(osc, 'Chaikin Osc');`,
})

export default chaikinOscillator
