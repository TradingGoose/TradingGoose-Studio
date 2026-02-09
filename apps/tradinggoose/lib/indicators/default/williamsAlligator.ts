import { createDefaultIndicator } from '../create-default-indicator'

const williamsAlligator = createDefaultIndicator({
  id: 'ALLIGATOR',
  name: 'Williams Alligator',
  pineCode: `
indicator('Williams Alligator', { overlay: true });

const jawLength = input.int(13, 'Jaw Length');
const jawOffset = input.int(8, 'Jaw Offset');
const teethLength = input.int(8, 'Teeth Length');
const teethOffset = input.int(5, 'Teeth Offset');
const lipsLength = input.int(5, 'Lips Length');
const lipsOffset = input.int(3, 'Lips Offset');

const hl2 = (high + low) / 2;
const jaw = ta.rma(hl2, jawLength);
const teeth = ta.rma(hl2, teethLength);
const lips = ta.rma(hl2, lipsLength);

plot(jaw, 'Jaw', { offset: jawOffset });
plot(teeth, 'Teeth', { offset: teethOffset });
plot(lips, 'Lips', { offset: lipsOffset });`,
})

export default williamsAlligator
