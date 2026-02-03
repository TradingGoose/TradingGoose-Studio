import { createDefaultPineIndicator } from './create-default-indicator'

const differentOfMovingAverage = createDefaultPineIndicator({
  id: 'DMA',
  name: 'Different of Moving Average',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Different of Moving Average');

const shortLength = input.int(10, 'Short Length');
const longLength = input.int(50, 'Long Length');
const amaLength = input.int(10, 'AMA Length');
const dma = ta.sma(close, shortLength) - ta.sma(close, longLength);
const ama = ta.sma(dma, amaLength);

plot(dma, 'DMA');
plot(ama, 'AMA');`,
})

export default differentOfMovingAverage
