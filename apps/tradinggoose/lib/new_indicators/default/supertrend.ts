import { createDefaultPineIndicator } from '../create-default-indicator'

const supertrend = createDefaultPineIndicator({
  id: 'ST',
  name: 'Supertrend',
  pineCode: `
indicator('Supertrend', { overlay: true });

const atrPeriod = input.int(10, 'ATR Length');
const factor = input.float(3, 'Factor');
const [supertrendValue, direction] = ta.supertrend(factor, atrPeriod);
const upTrend = direction < 0 ? supertrendValue : NaN;
const downTrend = direction >= 0 ? supertrendValue : NaN;

plot(upTrend, 'Up Trend');
plot(downTrend, 'Down Trend');`,
})

export default supertrend
