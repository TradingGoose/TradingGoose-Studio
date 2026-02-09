import { createDefaultIndicator } from '../create-default-indicator'

const cumulativeVolumeDelta = createDefaultIndicator({
  id: 'CVD',
  name: 'Cumulative Volume Delta',
  pineCode: `
indicator('Cumulative Volume Delta');

const anchorTimeframe = input.string('1D', 'Anchor Period');

const getStartOfPeriod = (timestamp, timeframe) => {
  const tf = String(timeframe ?? '').toUpperCase();
  const date = new Date(timestamp);

  if (tf === '1W' || tf === 'W') {
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    date.setUTCHours(0, 0, 0, 0);
  } else if (tf === '1M' || tf === 'M') {
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }

  return date.getTime();
};

let periodStart = NaN;
let cumDelta = 0;
let periodOpen = 0;
let periodMax = 0;
let periodMin = 0;

const barTime = openTime;
const start = getStartOfPeriod(barTime, anchorTimeframe);
const isNew = na(periodStart) || start !== periodStart;

if (isNew) {
  periodStart = start;
  cumDelta = 0;
  periodOpen = 0;
  periodMax = 0;
  periodMin = 0;
}

const vol = volume ?? 0;
const delta = close > open ? vol : close < open ? -vol : 0;

if (isNew) {
  periodOpen = cumDelta;
}

cumDelta = cumDelta + delta;
periodMax = math.max(periodMax, cumDelta);
periodMin = math.min(periodMin, cumDelta);

plot(periodOpen, 'Open Volume');
plot(periodMax, 'Max Volume');
plot(periodMin, 'Min Volume');
plot(cumDelta, 'Close Volume');`,
})

export default cumulativeVolumeDelta
