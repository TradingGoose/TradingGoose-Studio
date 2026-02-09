import { CHEAT_SHEET_MEMBERS } from './pine-cheat-sheet-members'

const formatMembers = (key: keyof typeof CHEAT_SHEET_MEMBERS) =>
  CHEAT_SHEET_MEMBERS[key].join(', ')

export const CHEAT_SHEET_GROUPS = {
  data: {
    label: 'Data',
    items: [
      { key: 'open', description: 'Series of open prices.' },
      { key: 'high', description: 'Series of high prices.' },
      { key: 'low', description: 'Series of low prices.' },
      { key: 'close', description: 'Series of close prices.' },
      { key: 'volume', description: 'Series of volumes.' },
      { key: 'hl2', description: 'Average of high and low.' },
      { key: 'hlc3', description: 'Average of high, low, and close.' },
      { key: 'ohlc4', description: 'Average of open, high, low, and close.' },
      { key: 'openTime', description: 'Bar open timestamp (ms).' },
      { key: 'closeTime', description: 'Bar close timestamp (ms).' },
    ],
  },
  inputs: {
    label: 'Inputs',
    items: [
      {
        key: 'input',
        description: 'Define user-configurable inputs.',
        examples: ["input.int(14, 'Length')", "input.bool(true, 'Enabled')"],
        members: formatMembers('input'),
      },
    ],
  },
  analysis: {
    label: 'Analysis',
    items: [
      {
        key: 'ta',
        description: 'Technical analysis helpers.',
        examples: ['ta.sma(close, 20)', 'ta.rsi(close, 14)', 'ta.macd(close, 12, 26, 9)'],
        members: formatMembers('ta'),
      },
      {
        key: 'math',
        description: 'Math helpers.',
        examples: ['math.abs(close - open)', 'math.sqrt(x * x + y * y)'],
        members: formatMembers('math'),
      },
    ],
  },
  plotting: {
    label: 'Plotting',
    items: [
      {
        key: 'plot',
        description: 'Plot a series line/area/histogram.',
        examples: ["plot(ta.sma(close, 20), 'SMA 20')", "plot(hist, 'Histogram')"],
      },
      { key: 'plotshape', description: 'Plot shapes on bars.' },
      { key: 'plotchar', description: 'Plot characters on bars.' },
      { key: 'plotarrow', description: 'Plot arrow markers.' },
      { key: 'plotbar', description: 'Plot custom bars.' },
      { key: 'plotcandle', description: 'Plot custom candles.' },
      { key: 'hline', description: 'Draw a horizontal line.' },
      { key: 'fill', description: 'Fill area between plots/lines.' },
      { key: 'bgcolor', description: 'Set chart background color.' },
      { key: 'barcolor', description: 'Set bar/candle colors.' },
    ],
  },
  utilities: {
    label: 'Utilities',
    items: [
      {
        key: 'indicator',
        description: 'Set indicator-level options (overlay, precision, timeframe, limits).',
        examples: [
          'indicator({ overlay: true, precision: 2 })',
          "indicator({ timeframe: 'D', timeframe_gaps: true })",
          'indicator({ max_bars_back: 200, calc_bars_count: 200 })',
        ],
        members: formatMembers('indicator'),
      },
      { key: 'na', description: 'Missing value (not available).' },
      { key: 'nz', description: 'Replace missing value with fallback.' },
      { key: 'color', description: 'Color utilities/constructors.' },
      {
        key: 'request',
        description: 'Request data from other symbols/timeframes.',
        examples: [
          "request.security('BINANCE:BTCUSDT', '1h', close)",
          "request.security_lower_tf('BINANCE:BTCUSDT', '5m', close)",
        ],
        members: formatMembers('request'),
      },
      {
        key: 'array',
        description: 'Array helpers.',
        examples: ['array.new_float(0)', 'array.push(myArr, close)'],
        members: formatMembers('array'),
      },
      { key: 'map', description: 'Map helpers.', members: formatMembers('map') },
      { key: 'matrix', description: 'Matrix helpers.', members: formatMembers('matrix') },
      { key: 'str', description: 'String helpers.', members: formatMembers('str') },
      { key: 'log', description: 'Logging helpers.', members: formatMembers('log') },
      { key: 'barstate', description: 'Bar state flags.' },
      { key: 'bar_index', description: 'Current bar index.' },
      { key: 'last_bar_index', description: 'Index of last bar.' },
      { key: 'last_bar_time', description: 'Time of last bar.' },
      { key: 'syminfo', description: 'Symbol info.' },
      { key: 'timeframe', description: 'Timeframe helpers/constants.' },
      { key: 'order', description: 'Order enum.' },
      { key: 'currency', description: 'Currency enum.' },
      { key: 'display', description: 'Display enum.' },
      { key: 'shape', description: 'Shape enum.' },
      { key: 'location', description: 'Location enum.' },
      { key: 'size', description: 'Size enum.' },
      { key: 'format', description: 'Format enum.' },
      { key: 'dayofweek', description: 'Day-of-week enum.' },
    ],
  },
} as const

export type CheatSheetGroup = keyof typeof CHEAT_SHEET_GROUPS
