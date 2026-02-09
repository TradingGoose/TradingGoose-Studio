import { createDefaultIndicator } from '../create-default-indicator'

const onBalanceVolume = createDefaultIndicator({
  id: 'OBV',
  name: 'On Balance Volume',
  pineCode: `
indicator('On Balance Volume');

const obv = ta.obv();

plot(obv, 'OBV');`,
})

export default onBalanceVolume
