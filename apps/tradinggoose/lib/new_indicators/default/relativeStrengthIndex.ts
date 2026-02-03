import { createDefaultPineIndicator } from './create-default-indicator'

const relativeStrengthIndex = createDefaultPineIndicator({
  id: 'RSI',
  name: 'Relative Strength Index',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Relative Strength Index');

const length1 = input.int(6, 'Length 1');
const length2 = input.int(12, 'Length 2');
const length3 = input.int(24, 'Length 3');

plot(ta.rsi(close, length1), 'RSI1');
plot(ta.rsi(close, length2), 'RSI2');
plot(ta.rsi(close, length3), 'RSI3');`,
})

export default relativeStrengthIndex
