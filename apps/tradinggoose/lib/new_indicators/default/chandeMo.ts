import { createDefaultPineIndicator } from '../create-default-indicator'

const chandeMo = createDefaultPineIndicator({
  id: 'CMO',
  name: 'Chande Momentum Oscillator',
  pineCode: `
indicator('Chande Momentum Oscillator');

const length = input.int(14, 'Length');
const cmo = ta.cmo(close, length);

plot(cmo, 'CMO');`,
})

export default chandeMo
