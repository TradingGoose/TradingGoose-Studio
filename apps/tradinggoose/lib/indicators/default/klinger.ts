import { createDefaultIndicator } from '../create-default-indicator'

const klinger = createDefaultIndicator({
  id: 'KVO',
  name: 'Klinger Oscillator',
  pineCode: `
indicator('Klinger Oscillator');

const fastLength = input.int(34, 'Fast Length');
const slowLength = input.int(55, 'Slow Length');
const signalLength = input.int(13, 'Signal Length');
const hlc3 = (high + low + close) / 3;
const changeHlc3 = ta.change(hlc3, 1);
const vol = volume ?? 0;
const signedVolume = na(changeHlc3) ? vol : changeHlc3 >= 0 ? vol : -vol;
const fastEma = ta.ema(signedVolume, fastLength);
const slowEma = ta.ema(signedVolume, slowLength);
const kvo = fastEma - slowEma;
const signal = ta.ema(kvo, signalLength);

plot(kvo, 'Klinger Oscillator');
plot(signal, 'Signal');`,
})

export default klinger
