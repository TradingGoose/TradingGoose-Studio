import { createDefaultPineIndicator } from './create-default-indicator'

const averagePrice = createDefaultPineIndicator({
  id: 'AVP',
  name: 'Average Price',
  pineCode: `const { close, volume } = $.data;
const { indicator, plot, ta } = $.pine;

indicator('Average Price', { overlay: true });

const vol = volume ?? 0;
const turnover = $.data.turnover ?? close * vol;
const totalTurnover = ta.cum(turnover);
const totalVolume = ta.cum(vol);
const avp = totalVolume !== 0 ? totalTurnover / totalVolume : NaN;

plot(avp, 'AVP');`,
})

export default averagePrice
