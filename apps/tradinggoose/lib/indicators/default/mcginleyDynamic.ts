import { createDefaultIndicator } from '../create-default-indicator'

const mcginleyDynamic = createDefaultIndicator({
  id: 'MD',
  name: 'McGinley Dynamic',
  pineCode: `
indicator('McGinley Dynamic', { overlay: true });

const length = input.int(14, 'Length');

let md = close;

if (md[1] === 0 || na(md[1])) {
  md = close;
} else {
  const ratio = close / md[1];
  const k = length * math.pow(ratio, 4);
  md = md[1] + (close - md[1]) / k;
}

plot(md, 'MD');`,
})

export default mcginleyDynamic
