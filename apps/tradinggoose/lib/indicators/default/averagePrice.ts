import { createDefaultIndicator } from '../create-default-indicator'

const averagePrice = createDefaultIndicator({
  id: 'AVP',
  name: 'Average Price',
  pineCode: `
indicator('Average Price', { overlay: true });

const vol = volume ?? 0;
const turnover = turnover ?? close * vol;
const totalTurnover = ta.cum(turnover);
const totalVolume = ta.cum(vol);
const avp = totalVolume !== 0 ? totalTurnover / totalVolume : NaN;

plot(avp, 'AVP');`,
})

export default averagePrice
