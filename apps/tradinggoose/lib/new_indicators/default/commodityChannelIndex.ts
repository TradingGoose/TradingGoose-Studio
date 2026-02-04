import { createDefaultPineIndicator } from '../create-default-indicator'

const commodityChannelIndex = createDefaultPineIndicator({
  id: 'CCI',
  name: 'Commodity Channel Index',
  pineCode: `
indicator('Commodity Channel Index');

const tp = (high + low + close) / 3;
const length = input.int(20, 'Length');
const cci = ta.cci(tp, length);

plot(cci, 'CCI');`,
})

export default commodityChannelIndex
