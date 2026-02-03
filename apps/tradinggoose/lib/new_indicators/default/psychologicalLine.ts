import { createDefaultPineIndicator } from './create-default-indicator'

const psychologicalLine = createDefaultPineIndicator({
  id: 'PSY',
  name: 'Psychological Line',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Psychological Line');

const up = close > close[1] ? 1 : 0;
const length = input.int(12, 'Length');
const maLength = input.int(6, 'MA Length');
const psy = ta.sma(up, length) * 100;
const maPsy = ta.sma(psy, maLength);

plot(psy, 'PSY');
plot(maPsy, 'MAPSY');`,
})

export default psychologicalLine
