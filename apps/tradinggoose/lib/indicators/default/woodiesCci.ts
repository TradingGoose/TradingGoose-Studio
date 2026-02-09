import { createDefaultIndicator } from '../create-default-indicator'

const woodiesCci = createDefaultIndicator({
  id: 'WCCI',
  name: 'Woodies CCI',
  pineCode: `
indicator('Woodies CCI');

const turboLength = input.int(6, 'Turbo CCI Length');
const cciLength = input.int(14, 'CCI Length');
const cciTurbo = ta.cci(close, turboLength);
const cciBase = ta.cci(close, cciLength);

plot(cciBase, 'CCI Turbo Histogram', { style: plot.style_histogram });
plot(cciTurbo, 'CCI Turbo');
plot(cciBase, 'CCI 14');`,
})

export default woodiesCci
