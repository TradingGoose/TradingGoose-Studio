import { createDefaultIndicator } from '../create-default-indicator'

const rvi = createDefaultIndicator({
  id: 'RVGI',
  name: 'Relative Vigor Index',
  pineCode: `
indicator('Relative Vigor Index');

const length = input.int(10, 'Length');
const closeOpen = close - open;
const highLow = high - low;
const swmaCloseOpen = ta.swma(closeOpen);
const swmaHighLow = ta.swma(highLow);
const sumCloseOpen = math.sum(swmaCloseOpen, length);
const sumHighLow = math.sum(swmaHighLow, length);
const rviValue = sumHighLow !== 0 ? sumCloseOpen / sumHighLow : NaN;
const signal = ta.swma(rviValue);

plot(rviValue, 'RVGI');
plot(signal, 'Signal');`,
})

export default rvi
