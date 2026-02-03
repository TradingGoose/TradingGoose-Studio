import { createDefaultPineIndicator } from './create-default-indicator'

const onBalanceVolume = createDefaultPineIndicator({
  id: 'OBV',
  name: 'On Balance Volume',
  pineCode: `const { indicator, input, plot, ta } = $.pine;

indicator('On Balance Volume');

const obv = ta.obv();
const maLength = input.int(30, 'MA Length');
const maObv = ta.sma(obv, maLength);

plot(obv, 'OBV');
plot(maObv, 'MAOBV');`,
})

export default onBalanceVolume
