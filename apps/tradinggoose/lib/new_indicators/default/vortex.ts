import { createDefaultPineIndicator } from '../create-default-indicator'

const vortex = createDefaultPineIndicator({
  id: 'VI',
  name: 'Vortex Indicator',
  pineCode: `
indicator('Vortex Indicator');

const length = input.int(14, 'Length');
const vmPlus = math.abs(high - low[1]);
const vmMinus = math.abs(low - high[1]);
const tr = ta.tr(true);
const sumTr = math.sum(tr, length);
const viPlus = sumTr !== 0 ? math.sum(vmPlus, length) / sumTr : NaN;
const viMinus = sumTr !== 0 ? math.sum(vmMinus, length) / sumTr : NaN;

plot(viPlus, 'VI +');
plot(viMinus, 'VI -');`,
})

export default vortex
