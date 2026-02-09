import { createDefaultIndicator } from '../create-default-indicator'

const envelope = createDefaultIndicator({
  id: 'ENV',
  name: 'Envelope',
  pineCode: `
indicator('Envelope', { overlay: true });

const length = input.int(20, 'Length');
const percent = input.float(10, 'Percent');
const exponential = input.bool(false, 'Exponential');
const basis = exponential ? ta.ema(close, length) : ta.sma(close, length);
const k = percent / 100;
const upper = basis * (1 + k);
const lower = basis * (1 - k);

plot(basis, 'Basis');
plot(upper, 'Upper');
plot(lower, 'Lower');`,
})

export default envelope
