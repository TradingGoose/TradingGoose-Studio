import { createDefaultIndicator } from '../create-default-indicator'

const ichimoku = createDefaultIndicator({
  id: 'ICHIMOKU',
  name: 'Ichimoku Cloud',
  pineCode: `
indicator('Ichimoku Cloud', { overlay: true });

const conversionPeriods = input.int(9, 'Conversion Line Length');
const basePeriods = input.int(26, 'Base Line Length');
const laggingSpan2Periods = input.int(52, 'Leading Span B Length');
const displacement = input.int(26, 'Displacement');

const conversionLine = (ta.highest(high, conversionPeriods) + ta.lowest(low, conversionPeriods)) / 2;
const baseLine = (ta.highest(high, basePeriods) + ta.lowest(low, basePeriods)) / 2;
const leadingSpanA = (conversionLine + baseLine) / 2;
const leadingSpanB = (ta.highest(high, laggingSpan2Periods) + ta.lowest(low, laggingSpan2Periods)) / 2;

plot(conversionLine, 'Conversion Line');
plot(baseLine, 'Base Line');
plot(close, 'Lagging Span', { offset: -displacement + 1 });
plot(leadingSpanA, 'Leading Span A', { offset: displacement - 1 });
plot(leadingSpanB, 'Leading Span B', { offset: displacement - 1 });`,
})

export default ichimoku
