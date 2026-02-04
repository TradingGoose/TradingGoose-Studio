import { createDefaultPineIndicator } from '../create-default-indicator'

const maRibbon = createDefaultPineIndicator({
  id: 'MARIBBON',
  name: 'Moving Average Ribbon',
  pineCode: `
indicator('Moving Average Ribbon', { overlay: true });

const showMa1 = input.bool(true, 'Show MA 1');
const ma1Type = input.string('SMA', 'MA 1 Type');
const ma1Length = input.int(20, 'MA 1 Length');
const showMa2 = input.bool(true, 'Show MA 2');
const ma2Type = input.string('SMA', 'MA 2 Type');
const ma2Length = input.int(50, 'MA 2 Length');
const showMa3 = input.bool(true, 'Show MA 3');
const ma3Type = input.string('SMA', 'MA 3 Type');
const ma3Length = input.int(100, 'MA 3 Length');
const showMa4 = input.bool(true, 'Show MA 4');
const ma4Type = input.string('SMA', 'MA 4 Type');
const ma4Length = input.int(200, 'MA 4 Length');

const resolveMa = (maType, length) => {
  if (maType === 'EMA') return ta.ema(close, length);
  if (maType === 'SMMA (RMA)') return ta.rma(close, length);
  if (maType === 'WMA') return ta.wma(close, length);
  if (maType === 'VWMA') return ta.vwma(close, length);
  return ta.sma(close, length);
};

const ma1 = resolveMa(ma1Type, ma1Length);
const ma2 = resolveMa(ma2Type, ma2Length);
const ma3 = resolveMa(ma3Type, ma3Length);
const ma4 = resolveMa(ma4Type, ma4Length);

plot(showMa1 ? ma1 : NaN, 'MA 1');
plot(showMa2 ? ma2 : NaN, 'MA 2');
plot(showMa3 ? ma3 : NaN, 'MA 3');
plot(showMa4 ? ma4 : NaN, 'MA 4');`,
})

export default maRibbon
