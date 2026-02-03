import { createDefaultPineIndicator } from './create-default-indicator'

const bullAndBearIndex = createDefaultPineIndicator({
  id: 'BBI',
  name: 'Bull and Bear Index',
  pineCode: `const { close } = $.data;
const { indicator, input, plot, ta } = $.pine;

indicator('Bull and Bear Index', { overlay: true });

const length1 = input.int(3, 'Length 1');
const length2 = input.int(6, 'Length 2');
const length3 = input.int(12, 'Length 3');
const length4 = input.int(24, 'Length 4');
const ma3 = ta.sma(close, length1);
const ma6 = ta.sma(close, length2);
const ma12 = ta.sma(close, length3);
const ma24 = ta.sma(close, length4);
const bbi = (ma3 + ma6 + ma12 + ma24) / 4;

plot(bbi, 'BBI');`,
})

export default bullAndBearIndex
