import { createDefaultIndicator } from '../create-default-indicator'

const easeOfMovementValue = createDefaultIndicator({
  id: 'EMV',
  name: 'Ease of Movement',
  pineCode: `
indicator('Ease of Movement');

const length = input.int(14, 'Length');
const divisor = input.int(10000, 'Divisor');
const hl2 = (high + low) / 2;
const hl2Change = ta.change(hl2, 1);
const vol = volume ?? 0;
const boxRatio = vol !== 0 ? (high - low) / (vol / divisor) : NaN;
const eomRaw = hl2Change * boxRatio;
const eom = ta.sma(eomRaw, length);

plot(eom, 'EOM');`,
})

export default easeOfMovementValue
