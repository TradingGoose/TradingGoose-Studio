import { createDefaultPineIndicator } from '../create-default-indicator'

const relativeVolumeAtTime = createDefaultPineIndicator({
  id: 'RELVOL',
  name: 'Relative Volume at Time',
  pineCode: `
indicator('Relative Volume at Time');

const anchorTimeframe = input.string('1D', 'Anchor Timeframe');
const length = input.int(10, 'Length');
const calculationMode = input.string('Cumulative', 'Calculation Mode');
const adjustRealtime = input.bool(true, 'Adjust Unconfirmed');
const isCumulative = calculationMode === 'Cumulative';

const parseTimeframe = (tf) => {
  const match = String(tf ?? '').match(/^(\d+)?([SMHDWM])$/i);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = match[1] ? Number.parseInt(match[1], 10) : 1;
  const unit = match[2].toUpperCase();
  if (unit === 'S') return value * 1000;
  if (unit === 'M') return value * 60 * 1000;
  if (unit === 'H') return value * 60 * 60 * 1000;
  if (unit === 'D') return value * 24 * 60 * 60 * 1000;
  if (unit === 'W') return value * 7 * 24 * 60 * 60 * 1000;
  return value * 30 * 24 * 60 * 60 * 1000;
};

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

const binarySearchLeftmost = (times, target) => {
  let left = 0;
  let right = times.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (times[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
};

const calcAverageByTime = (historicalData, timeOffset) => {
  if (!historicalData.length) return NaN;
  let sum = 0;
  for (let i = 0; i < historicalData.length; i += 1) {
    const period = historicalData[i];
    const targetTime = period.startTime + timeOffset;
    const index = binarySearchLeftmost(period.times, targetTime);
    const value = index >= period.data.length ? period.data[period.data.length - 1] : period.data[index];
    sum += value;
  }
  return sum / historicalData.length;
};

let historicalData = [];
let currentTimes = [];
let currentData = [];
let currentStart = NaN;
let cumulativeSum = 0;
let lastAnchorTime = NaN;

const barTime = openTime;
const periodStart = getStartOfPeriod(barTime, anchorTimeframe);
const isAnchor = na(currentStart) || periodStart !== currentStart;

if (isAnchor) {
  if (currentData.length > 0) {
    historicalData.push({ data: currentData, times: currentTimes, startTime: currentStart });
    if (historicalData.length > length) {
      historicalData.shift();
    }
  }
  currentStart = periodStart;
  currentTimes = [];
  currentData = [];
  cumulativeSum = 0;
  lastAnchorTime = barTime;
}

const vol = volume ?? 0;
let currentValue = isCumulative ? cumulativeSum + vol : vol;
if (isCumulative) {
  cumulativeSum = currentValue;
}

if (isCumulative && adjustRealtime && barstate.islast && !na(lastAnchorTime)) {
  const timePassed = barTime - lastAnchorTime;
  const timeTotal = parseTimeframe(anchorTimeframe);
  if (timePassed > 0 && timeTotal > 0) {
    currentValue = cumulativeSum / timePassed * timeTotal;
  }
}

currentTimes.push(barTime);
currentData.push(currentValue);

const timeOffset = barTime - currentStart;
const pastVolume = calcAverageByTime(historicalData, timeOffset);
const ratio = pastVolume && pastVolume !== 0 ? currentValue / pastVolume : NaN;

plot(ratio, 'Relative Volume Ratio');`,
})

export default relativeVolumeAtTime
