import { createDefaultIndicator } from '../create-default-indicator'

const mfi = createDefaultIndicator({
  id: 'MFI',
  name: 'Money Flow Index',
  pineCode: `
indicator('Money Flow Index');

const length = input.int(14, 'Length');
const hlc3 = (high + low + close) / 3;
const mfiValue = ta.mfi(hlc3, length);

plot(mfiValue, 'MFI');`,
})

export default mfi
