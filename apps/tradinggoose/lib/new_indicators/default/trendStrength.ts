import { createDefaultPineIndicator } from '../create-default-indicator'

const trendStrength = createDefaultPineIndicator({
  id: 'TSI_TREND',
  name: 'Trend Strength Index',
  pineCode: `
indicator('Trend Strength Index');

const length = input.int(14, 'Length');

const corr = (() => {
  if (na(close[length - 1])) return na;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  const n = length;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = close[length - 1 - i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (denominator === 0) return 0;
  return numerator / denominator;
})();

plot(corr, 'Trend Strength Index');`,
})

export default trendStrength
