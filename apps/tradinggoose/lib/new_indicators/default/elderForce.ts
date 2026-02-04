import { createDefaultPineIndicator } from '../create-default-indicator'

const elderForce = createDefaultPineIndicator({
  id: 'EFI',
  name: 'Elder Force Index',
  pineCode: `
indicator('Elder Force Index');

const length = input.int(13, 'Length');
const vol = volume ?? 0;
const force = ta.change(close, 1) * vol;
const efi = ta.ema(force, length);

plot(efi, 'Elder Force Index');`,
})

export default elderForce
