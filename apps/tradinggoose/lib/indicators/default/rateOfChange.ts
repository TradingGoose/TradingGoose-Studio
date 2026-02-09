import { createDefaultIndicator } from '../create-default-indicator'

const rateOfChange = createDefaultIndicator({
  id: 'ROC',
  name: 'Rate of Change',
  pineCode: `
indicator('Rate of Change');

const length = input.int(9, 'Length');
const roc = ta.roc(close, length);

plot(roc, 'ROC');`,
})

export default rateOfChange
