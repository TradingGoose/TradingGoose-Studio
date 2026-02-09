import { createDefaultIndicator } from '../create-default-indicator'

const smiErgodic = createDefaultIndicator({
  id: 'SMII',
  name: 'SMI Ergodic Indicator',
  pineCode: `
indicator('SMI Ergodic Indicator');

const longLength = input.int(20, 'Long Length');
const shortLength = input.int(5, 'Short Length');
const signalLength = input.int(5, 'Signal Length');
const pc = ta.change(close, 1);
const absPc = math.abs(pc);
const pcSmooth = ta.ema(ta.ema(pc, shortLength), longLength);
const absSmooth = ta.ema(ta.ema(absPc, shortLength), longLength);
const smi = absSmooth !== 0 ? pcSmooth / absSmooth * 100 : NaN;
const signal = ta.ema(smi, signalLength);

plot(smi, 'SMI');
plot(signal, 'Signal');`,
})

export default smiErgodic
