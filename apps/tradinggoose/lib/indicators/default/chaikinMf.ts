import { createDefaultIndicator } from '../create-default-indicator'

const chaikinMf = createDefaultIndicator({
  id: 'CMF',
  name: 'Chaikin Money Flow',
  pineCode: `
indicator('Chaikin Money Flow');

const length = input.int(20, 'Length');
const range = high - low;
const mfm = range !== 0 ? ((close - low) - (high - close)) / range : 0;
const vol = volume ?? 0;
const mfv = mfm * vol;
const sumMfv = math.sum(mfv, length);
const sumVol = math.sum(vol, length);
const cmf = sumVol !== 0 ? sumMfv / sumVol : NaN;

plot(cmf, 'CMF');`,
})

export default chaikinMf
