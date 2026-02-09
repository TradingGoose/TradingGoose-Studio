import { createDefaultIndicator } from '../create-default-indicator'

const coppockCurve = createDefaultIndicator({
  id: 'COPPOCK',
  name: 'Coppock Curve',
  pineCode: `
indicator('Coppock Curve');

const wmaLength = input.int(10, 'WMA Length');
const longRocLength = input.int(14, 'Long RoC Length');
const shortRocLength = input.int(11, 'Short RoC Length');
const longRoc = ta.roc(close, longRocLength);
const shortRoc = ta.roc(close, shortRocLength);
const rocSum = longRoc + shortRoc;
const curve = ta.wma(rocSum, wmaLength);

plot(curve, 'Coppock Curve');`,
})

export default coppockCurve
