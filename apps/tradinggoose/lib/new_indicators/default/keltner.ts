import { createDefaultPineIndicator } from '../create-default-indicator'

const keltner = createDefaultPineIndicator({
  id: 'KC',
  name: 'Keltner Channels',
  pineCode: `
indicator('Keltner Channels', { overlay: true });

const length = input.int(20, 'Length');
const mult = input.float(2, 'Multiplier');
const atrLength = input.int(10, 'ATR Length');
const useEma = input.bool(true, 'Use Exponential MA');
const basis = useEma ? ta.ema(close, length) : ta.sma(close, length);
const range = ta.atr(atrLength);
const upper = basis + range * mult;
const lower = basis - range * mult;

plot(upper, 'Upper');
plot(basis, 'Basis');
plot(lower, 'Lower');`,
})

export default keltner
