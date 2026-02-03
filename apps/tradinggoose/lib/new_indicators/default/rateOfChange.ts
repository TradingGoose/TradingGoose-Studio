import { createDefaultPineIndicator } from './create-default-indicator'

const rateOfChange = createDefaultPineIndicator({
  id: 'ROC',
  name: 'Rate of Change',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Rate of Change');

const length = input.int(12, 'Length');
const maLength = input.int(6, 'MA Length');
const roc = ta.roc(close, length);
const maRoc = ta.sma(roc, maLength);

plot(roc, 'ROC');
plot(maRoc, 'MAROC');`,
})

export default rateOfChange
