import { createDefaultIndicator } from '../create-default-indicator'

const fisherTransform = createDefaultIndicator({
  id: 'FISHER',
  name: 'Fisher Transform',
  pineCode: `
indicator('Fisher Transform');

const length = input.int(9, 'Length');
const hl2 = (high + low) / 2;
const highestHl2 = ta.highest(hl2, length);
const lowestHl2 = ta.lowest(hl2, length);
const range = highestHl2 - lowestHl2;
const normalized = range !== 0 ? (hl2 - lowestHl2) / range - 0.5 : 0;

let value = 0;
let fisher = 0;

value = 0.66 * normalized + 0.67 * value[1];
value = value > 0.99 ? 0.999 : value < -0.99 ? -0.999 : value;

fisher = 0.5 * math.log((1 + value) / (1 - value)) + 0.5 * fisher[1];
const trigger = fisher[1];

plot(fisher, 'Fisher');
plot(trigger, 'Trigger');`,
})

export default fisherTransform
