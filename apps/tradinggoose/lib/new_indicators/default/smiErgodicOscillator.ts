import { createDefaultPineIndicator } from '../create-default-indicator'

const smiErgodicOscillator = createDefaultPineIndicator({
  id: 'SMIO',
  name: 'SMI Ergodic Oscillator',
  pineCode: `
indicator('SMI Ergodic Oscillator');

const longLength = input.int(20, 'Long Length');
const shortLength = input.int(5, 'Short Length');
const signalLength = input.int(5, 'Signal Length');
const pc = ta.change(close, 1);
const absPc = math.abs(pc);
const pcSmooth = ta.ema(ta.ema(pc, shortLength), longLength);
const absSmooth = ta.ema(ta.ema(absPc, shortLength), longLength);
const smi = absSmooth !== 0 ? pcSmooth / absSmooth * 100 : NaN;
const signal = ta.ema(smi, signalLength);
const osc = smi - signal;

plot(osc, 'Oscillator');`,
})

export default smiErgodicOscillator
